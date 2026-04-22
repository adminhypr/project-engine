-- ─────────────────────────────────────────────
-- 042 · Access hardening (security audit follow-up)
--
-- Closes two pre-existing CRITICAL gaps surfaced by the Agentboard
-- access audit (both exist independent of the Agentboard feature) and
-- tightens several Important/Minor policies.
--
-- Critical:
--   C1 — self-privilege escalation: any auth'd user could
--        `update profiles set role='Admin' where id=auth.uid()` because
--        the "Users can update own profile" UPDATE policy had USING but
--        NO WITH CHECK. Fixed with a BEFORE UPDATE trigger that blocks
--        self-changes to sensitive columns (role, team_id, reports_to,
--        email). Admin / Manager updates on *other* profiles are
--        unaffected.
--
--   C2 — anon profile read: a stray `"Profiles select open"` policy
--        with `USING (true)` let even unauthenticated clients list all
--        profiles (email, role, full_name). Not tracked in any
--        migration file — added manually via Supabase Studio. Dropped
--        here; the `Profiles are viewable by authenticated users`
--        policy keeps the legitimate signed-in path working.
--
-- Important:
--   I1 — externals could `select *` from `profile_teams` and `teams`
--        enumerating org structure. Scoped down to self / member teams.
--   I3 — `get_or_create_team_group(tid)` had no caller check. Now
--        requires the caller to be a member of the target team (or
--        Admin).
--   I4 — `conversations` UPDATE had no WITH CHECK. Externals could
--        flip `kind`/`team_id` on their team group. Locked down.
--   I5 — `conversation_participants` UPDATE had no WITH CHECK. Users
--        could reassign their participant row to somebody else. Locked
--        down.
--
-- Minor (folded in for defense-in-depth):
--   M1 — `task_assignees` INSERT now excludes externals.
--   M2 — `tasks` INSERT now excludes externals.
-- ─────────────────────────────────────────────

----------------------------------------------------------------
-- C1: BEFORE UPDATE trigger blocking self-changes to sensitive cols
----------------------------------------------------------------
create or replace function public.guard_profile_self_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  -- Only act on a user editing their own row. Admin/Manager updates
  -- on other profiles go through this trigger too but pass cleanly
  -- because `me != new.id`.
  if me is null or me <> new.id then
    return new;
  end if;

  if new.role         is distinct from old.role
     or new.team_id    is distinct from old.team_id
     or new.reports_to is distinct from old.reports_to
     or new.email      is distinct from old.email
  then
    raise exception 'cannot change your own role, team, manager, or email via self-update';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_self_updates on public.profiles;
create trigger trg_guard_profile_self_updates
before update on public.profiles
for each row execute function public.guard_profile_self_updates();

----------------------------------------------------------------
-- C2: drop the anon-readable profiles SELECT policy
----------------------------------------------------------------
drop policy if exists "Profiles select open" on public.profiles;

----------------------------------------------------------------
-- I1a: profile_teams SELECT scoped for externals
----------------------------------------------------------------
drop policy if exists "Profile teams viewable by authenticated users" on public.profile_teams;
create policy "profile_teams_select" on public.profile_teams
  for select
  using (
    not public.is_external_user(auth.uid())
    or profile_id = auth.uid()
  );

----------------------------------------------------------------
-- I1b: teams SELECT scoped for externals
----------------------------------------------------------------
drop policy if exists "Teams viewable by authenticated users" on public.teams;
create policy "teams_select" on public.teams
  for select
  using (
    not public.is_external_user(auth.uid())
    or exists (
      select 1 from public.profile_teams pt
      where pt.team_id = teams.id and pt.profile_id = auth.uid()
    )
  );

----------------------------------------------------------------
-- I3: get_or_create_team_group — require caller to be a team member
----------------------------------------------------------------
create or replace function public.get_or_create_team_group(tid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
  new_id   uuid;
  tname    text;
  me       uuid := auth.uid();
begin
  if tid is null then raise exception 'team id required'; end if;
  if me is null then raise exception 'not authenticated'; end if;

  -- Only a member of the team (or a global Admin) may touch the team group.
  -- This blocks Agents from pinging arbitrary team ids to inflate DB state.
  if not exists (select 1 from public.profile_teams
                 where profile_id = me and team_id = tid)
     and not exists (select 1 from public.profiles
                     where id = me and role = 'Admin')
  then
    raise exception 'not a member of this team';
  end if;

  select id into existing
  from public.conversations
  where kind = 'group' and team_id = tid
  limit 1;
  if existing is not null then return existing; end if;

  select name into tname from public.teams where id = tid;
  insert into public.conversations (kind, team_id, title, created_by)
    values ('group', tid, coalesce(tname, 'Team'), null)
    returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.get_or_create_team_group(uuid) to authenticated;

----------------------------------------------------------------
-- I4: conversations UPDATE — add WITH CHECK that externals cannot
-- flip kind/team_id on their team group
----------------------------------------------------------------
drop policy if exists "conversations_update_participant" on public.conversations;
create policy "conversations_update_participant" on public.conversations
  for update
  using (public.is_conversation_participant(id))
  with check (
    public.is_conversation_participant(id)
    and (
      not public.is_external_user(auth.uid())
      or (kind = 'group' and team_id is not null)
    )
  );

----------------------------------------------------------------
-- I5: conversation_participants UPDATE — forbid moving ownership
----------------------------------------------------------------
drop policy if exists "conv_participants_update_own" on public.conversation_participants;
create policy "conv_participants_update_own" on public.conversation_participants
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

----------------------------------------------------------------
-- M2: tasks INSERT — externals blocked (defense-in-depth; they already
-- cannot SELECT to discover ids, but let's not rely on that alone)
----------------------------------------------------------------
drop policy if exists "Anyone can create tasks" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert
  with check (
    auth.role() = 'authenticated'
    and not public.is_external_user(auth.uid())
  );

----------------------------------------------------------------
-- M1: task_assignees INSERT — externals blocked (symmetry with M2)
----------------------------------------------------------------
drop policy if exists "task_assignees_insert" on public.task_assignees;
create policy "task_assignees_insert" on public.task_assignees
  for insert
  with check (
    auth.role() = 'authenticated'
    and not public.is_external_user(auth.uid())
  );
