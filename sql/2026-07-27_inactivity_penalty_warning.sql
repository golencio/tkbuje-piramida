alter table public.teams
  add column if not exists inactivity_penalty_warning_sent_at timestamptz;

comment on column public.teams.inactivity_penalty_warning_sent_at is
  'Vrijeme slanja upozorenja nakon 12 dana neaktivnosti; null nakon nove aktivnosti.';
