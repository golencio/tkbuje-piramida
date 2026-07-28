-- Atomically returns a match winner from the penalty zone without moving any
-- other team or consulting penalty_rebalance_log.
create or replace function public.return_from_penalty_after_win(
  p_team_id uuid,
  p_last_match_at timestamptz,
  p_removed_by text
)
returns jsonb
language plpgsql
as $$
declare
  v_event_id uuid;
  v_position integer;
  v_restored_at timestamptz := now();
  v_updated_count integer;
begin
  -- Serialize returns to step 5 so simultaneous confirmations cannot choose
  -- the same free position.
  perform pg_advisory_xact_lock(hashtext('return_from_penalty_after_win_step_5'));

  select id
    into v_event_id
    from public.penalty_events
   where team_id = p_team_id
     and is_active = true
   order by penalty_started_at desc
   limit 1
   for update;

  if v_event_id is null then
    raise exception 'Nema aktivnog penalty_events zapisa za tim %.', p_team_id;
  end if;

  select candidate
    into v_position
    from generate_series(
      1,
      coalesce((
        select max(position)
          from public.teams
         where step = 5
           and penalty = false
           and id <> p_team_id
      ), 0) + 1
    ) as positions(candidate)
   where not exists (
     select 1
       from public.teams
      where step = 5
        and penalty = false
        and id <> p_team_id
        and position = candidate
   )
   order by candidate
   limit 1;

  update public.teams
     set penalty = false,
         step = 5,
         position = v_position,
         original_step = null,
         last_match_at = coalesce(p_last_match_at, v_restored_at),
         inactivity_penalty_warning_sent_at = null
   where id = p_team_id
     and penalty = true;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Tim % nije pronađen ili više nije u kaznenoj zoni.', p_team_id;
  end if;

  update public.penalty_events
     set is_active = false,
         penalty_removed_at = v_restored_at,
         removed_by = p_removed_by
   where id = v_event_id
     and is_active = true;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Aktivni penalty_events zapis % nije zatvoren.', v_event_id;
  end if;

  return jsonb_build_object(
    'team_id', p_team_id,
    'step', 5,
    'position', v_position,
    'penalty_event_id', v_event_id,
    'restored_at', v_restored_at
  );
end;
$$;

revoke all on function public.return_from_penalty_after_win(uuid, timestamptz, text) from anon;
grant execute on function public.return_from_penalty_after_win(uuid, timestamptz, text) to authenticated;
