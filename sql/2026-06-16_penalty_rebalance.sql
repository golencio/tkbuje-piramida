-- Tracks a penalty as a single event so every automatic rebalance can be
-- tied back to the exact team removal that caused it.
create table if not exists penalty_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  old_step integer,
  old_position integer,
  penalty_started_at timestamptz not null default now(),
  penalty_removed_at timestamptz null,
  removed_by text null,
  is_active boolean not null default true
);

create table if not exists penalty_rebalance_log (
  id uuid primary key default gen_random_uuid(),
  penalty_event_id uuid references penalty_events(id) on delete cascade,
  penalty_team_id uuid not null references teams(id) on delete cascade,
  moved_team_id uuid not null references teams(id) on delete cascade,
  old_step integer,
  old_position integer,
  new_step integer,
  new_position integer,
  reason text not null default 'penalty_rebalance',
  created_at timestamptz not null default now(),
  restored_at timestamptz null,
  restored_by text null,
  is_restored boolean not null default false
);

create index if not exists idx_penalty_events_team_active
  on penalty_events(team_id, is_active);

create index if not exists idx_penalty_rebalance_penalty_team_unrestored
  on penalty_rebalance_log(penalty_team_id, is_restored);

create index if not exists idx_penalty_rebalance_event
  on penalty_rebalance_log(penalty_event_id);

-- One-time compatibility backfill from the previous movement log, if it exists.
-- This lets currently active penalties be restored through the new guarded flow.
do $$
begin
  if to_regclass('public.pyramid_movement_log') is not null then
    insert into penalty_events (
      team_id,
      old_step,
      old_position,
      penalty_started_at
    )
    select
      t.id,
      coalesce(t.original_step, t.step),
      t.position,
      coalesce(min(pml.created_at), now())
    from teams t
    left join pyramid_movement_log pml
      on pml.affected_team_id = t.id
      and pml.reason = 'penalty_zone_rebalance'
    where t.penalty = true
      and not exists (
        select 1
        from penalty_events pe
        where pe.team_id = t.id
          and pe.is_active = true
      )
    group by t.id, t.original_step, t.step, t.position;

    insert into penalty_rebalance_log (
      penalty_event_id,
      penalty_team_id,
      moved_team_id,
      old_step,
      old_position,
      new_step,
      new_position,
      reason,
      created_at
    )
    select
      pe.id,
      pml.affected_team_id,
      pml.moved_team_id,
      pml.old_step,
      pml.old_position,
      pml.new_step,
      pml.new_position,
      'penalty_rebalance',
      pml.created_at
    from pyramid_movement_log pml
    join penalty_events pe
      on pe.team_id = pml.affected_team_id
      and pe.is_active = true
    where pml.reason = 'penalty_zone_rebalance'
      and not exists (
        select 1
        from penalty_rebalance_log prl
        where prl.penalty_event_id = pe.id
          and prl.penalty_team_id = pml.affected_team_id
          and prl.moved_team_id = pml.moved_team_id
          and prl.old_step is not distinct from pml.old_step
          and prl.new_step is not distinct from pml.new_step
          and prl.created_at is not distinct from pml.created_at
      );
  end if;
end $$;
