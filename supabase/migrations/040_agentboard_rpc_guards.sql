-- 040_agentboard_rpc_guards.sql
--
-- Follow-up to migration 039 (agentboard RLS). The RPCs below are
-- SECURITY DEFINER and therefore bypass RLS, which let external users
-- create DMs and custom groups even though 039 blocks those operations
-- at the table level. This migration adds an early external-user guard
-- to each affected RPC (get_or_create_team_group is intentionally left
-- unguarded because externals legitimately need it).
--
-- It also hardens the dm_messages SELECT policy so external users can
-- only read messages from team-group conversations, matching the
-- INSERT-side predicate introduced in 039.

------------------------------------------------------------
-- RPC: get_or_create_dm (original: migration 027)
------------------------------------------------------------
create or replace function public.get_or_create_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  new_id uuid;
begin
  if public.is_external_user(auth.uid()) then
    raise exception 'external users may not perform this action';
  end if;
  if me is null then
    raise exception 'not authenticated';
  end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'invalid other user';
  end if;

  select c.id into existing
  from public.conversations c
  where c.kind = 'dm'
    and exists (select 1 from public.conversation_participants cp
                 where cp.conversation_id = c.id and cp.user_id = me)
    and exists (select 1 from public.conversation_participants cp
                 where cp.conversation_id = c.id and cp.user_id = other_user_id)
    and (select count(*) from public.conversation_participants cp
          where cp.conversation_id = c.id) = 2
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.conversations (kind, created_by)
    values ('dm', me) returning id into new_id;
  insert into public.conversation_participants (conversation_id, user_id)
    values (new_id, me), (new_id, other_user_id);
  return new_id;
end;
$$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

------------------------------------------------------------
-- RPC: create_custom_group (original: migration 033)
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
  if public.is_external_user(auth.uid()) then
    raise exception 'external users may not perform this action';
  end if;
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
-- RPC: add_group_member (original: migration 033)
------------------------------------------------------------
create or replace function public.add_group_member(cid uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_external_user(auth.uid()) then
    raise exception 'external users may not perform this action';
  end if;
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
-- Harden dm_messages SELECT so externals only see team-group messages
-- (original policy: migration 027). Mirrors the INSERT predicate from
-- migration 039.
------------------------------------------------------------
drop policy if exists "dm_messages_select_participant" on public.dm_messages;
create policy "dm_messages_select_participant" on public.dm_messages
  for select using (
    public.is_conversation_participant(conversation_id)
    and (
      not public.is_external_user(auth.uid())
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and c.kind = 'group' and c.team_id is not null
      )
    )
  );
