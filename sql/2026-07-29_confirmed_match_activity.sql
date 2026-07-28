-- Reliably resets inactivity after an administrator confirms a match.
-- SECURITY DEFINER is required because direct team updates can be silently
-- filtered by teams RLS; authorization is checked explicitly below.
create or replace function public.set_confirmed_match_activity(
  p_team_ids uuid[],
  p_confirmed_at timestamptz
)
returns table(team_id uuid, last_match_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
      from public.players
     where email = auth.jwt() ->> 'email'
       and is_admin = true
       and active = true
  ) then
    raise exception 'Samo aktivni administrator može potvrditi aktivnost meča.';
  end if;

  return query
  update public.teams
     set last_match_at = coalesce(p_confirmed_at, now()),
         inactivity_penalty_warning_sent_at = null
   where id = any(p_team_ids)
  returning id, teams.last_match_at;
end;
$$;

revoke all on function public.set_confirmed_match_activity(uuid[], timestamptz) from public;
grant execute on function public.set_confirmed_match_activity(uuid[], timestamptz) to authenticated;
