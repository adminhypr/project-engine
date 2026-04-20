-- ─────────────────────────────────────────────
-- 033 · Group conversations + team-scoped default groups
-- conversations.kind='group' already exists from 027. This migration adds:
--   · team_id column on conversations (nullable) for per-team default groups
--   · auto-enrollment trigger on profile_teams → join the team's group
--   · RPCs: get_or_create_team_group, create_custom_group,
--           add_group_member, leave_group
--   · backfill for existing teams + members
-- RLS: existing dm_messages / conversation_participants policies use
-- is_conversation_participant(cid), which already works for kind='group'.
-- ─────────────────────────────────────────────

alter table public.conversations
  add column if not exists team_id uuid references public.teams(id) on delete cascade;

-- One canonical group per team.
create unique index if not exists conversations_team_group_uniq
  on public.conversations(team_id)
  where kind = 'group' and team_id is not null;

------------------------------------------------------------
-- RPC: get or create the team-scoped group conversation
------------------------------------------------------------
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
begin
  if tid is null then raise exception 'team id required'; end if;

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

------------------------------------------------------------
-- Trigger: auto-enroll new profile_teams rows into the team group
------------------------------------------------------------
create or replace function public.sync_team_group_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  conv_id := public.get_or_create_team_group(new.team_id);
  insert into public.conversation_participants (conversation_id, user_id)
    values (conv_id, new.profile_id)
    on conflict (conversation_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profile_teams_join_group on public.profile_teams;
create trigger profile_teams_join_group
  after insert on public.profile_teams
  for each row execute function public.sync_team_group_membership();

------------------------------------------------------------
-- RPC: create a custom (non-team) group conversation
------------------------------------------------------------
create or replace function public.create_custom_group(title text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  new_id uuid;
  mid    uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if member_ids is null or array_length(member_ids, 1) is null then
    raise exception 'members required';
  end if;

  insert into public.conversations (kind, title, created_by)
    values ('group', coalesce(nullif(trim(title), ''), 'Group'), me)
    returning id into new_id;

  insert into public.conversation_participants (conversation_id, user_id)
    values (new_id, me)
    on conflict do nothing;

  foreach mid in array member_ids loop
    if mid is not null and mid <> me then
      insert into public.conversation_participants (conversation_id, user_id)
        values (new_id, mid)
        on conflict do nothing;
    end if;
  end loop;

  return new_id;
end;
$$;
grant execute on function public.create_custom_group(text, uuid[]) to authenticated;

------------------------------------------------------------
-- RPC: add a member to an existing group (caller must be a member)
------------------------------------------------------------
create or replace function public.add_group_member(cid uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_conversation_participant(cid) then
    raise exception 'not a participant';
  end if;
  if not exists (
    select 1 from public.conversations where id = cid and kind = 'group'
  ) then
    raise exception 'not a group conversation';
  end if;
  insert into public.conversation_participants (conversation_id, user_id)
    values (cid, uid)
    on conflict do nothing;
end;
$$;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;

------------------------------------------------------------
-- RPC: leave a group (delete own participant row)
-- Security definer so no DELETE RLS policy is needed on the table.
------------------------------------------------------------
create or replace function public.leave_group(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.conversation_participants
    where conversation_id = cid and user_id = auth.uid();
end;
$$;
grant execute on function public.leave_group(uuid) to authenticated;

------------------------------------------------------------
-- Backfill: create team groups for all existing teams and enroll
-- every current profile_teams member.
------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select id from public.teams loop
    perform public.get_or_create_team_group(t.id);
  end loop;

  insert into public.conversation_participants (conversation_id, user_id)
    select c.id, pt.profile_id
    from public.conversations c
    join public.profile_teams pt on pt.team_id = c.team_id
    where c.kind = 'group' and c.team_id is not null
    on conflict do nothing;
end $$;
