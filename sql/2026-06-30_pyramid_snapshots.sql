create table if not exists public.pyramid_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reason text not null,
  created_by text,
  related_challenge_id uuid null references public.challenges(id) on delete set null,
  related_match_id uuid null,
  snapshot jsonb not null
);

create index if not exists idx_pyramid_snapshots_created_at
  on public.pyramid_snapshots(created_at desc);

create index if not exists idx_pyramid_snapshots_related_challenge
  on public.pyramid_snapshots(related_challenge_id);

create index if not exists idx_pyramid_snapshots_snapshot_gin
  on public.pyramid_snapshots using gin(snapshot);

alter table public.pyramid_snapshots enable row level security;

drop policy if exists "Admins can read pyramid snapshots" on public.pyramid_snapshots;
create policy "Admins can read pyramid snapshots"
  on public.pyramid_snapshots
  for select
  using (
    exists (
      select 1
      from public.players p
      where p.email = auth.jwt() ->> 'email'
        and p.is_admin = true
    )
  );

drop policy if exists "Authenticated users can create pyramid snapshots" on public.pyramid_snapshots;
create policy "Authenticated users can create pyramid snapshots"
  on public.pyramid_snapshots
  for insert
  with check (auth.role() = 'authenticated');
