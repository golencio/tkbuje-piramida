alter table public.challenges
  add column if not exists response_reminder_sent_at timestamptz;

comment on column public.challenges.response_reminder_sent_at is
  'Vrijeme slanja email podsjetnika za odgovor na izazov; resetira se pri novom pending roku.';
