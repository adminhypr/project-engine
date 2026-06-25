-- ---------------------------------------------
-- 111 - Dev Projects audit fixes (post-ship review)
--
-- (1) guard_project_last_owner (106) ABORTED project deletion: deleting a
--     project cascades to project_members, which fires the BEFORE DELETE guard
--     on the (sole) owner row -> counts 0 remaining owners -> raises -> the
--     whole DELETE fails. So no sole-owner project (i.e. every fresh project)
--     could ever be deleted. Make the guard skip when the parent project is
--     already gone (cascade teardown), mirroring migration 092's
--     "skip audit when the parent no longer exists" fix.
-- (2) project_id_from_storage_name (110) was the only function in the project
--     set without `set search_path` (051 hardening) - add it.
-- (3) Block externals (Agent/Client) from project membership. Externals are out
--     of scope for the dev board (design + the InternalOnly nav already exclude
--     them); the Members add-picker was leaking them. DB defense in depth.
-- Idempotent: all create-or-replace / drop-if-exists.
-- ---------------------------------------------

-- (1) cascade-safe last-owner guard
create or replace function public.guard_project_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners int;
begin
  -- During a project DELETE the FK cascade removes member rows AFTER the project
  -- row is gone; don't block that teardown. Only guard user-initiated removal of
  -- an owner while the project still exists.
  if tg_op = 'DELETE' and not exists (select 1 from public.projects where id = old.project_id) then
    return old;
  end if;

  if tg_op = 'DELETE' then
    if old.role <> 'owner' then return old; end if;
  elsif tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then return new; end if;
  end if;

  select count(*) into remaining_owners
    from public.project_members
   where project_id = old.project_id
     and role = 'owner'
     and profile_id <> old.profile_id;

  if remaining_owners = 0 then
    raise exception 'guard_project_last_owner: a project must keep at least one owner'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
-- trigger definition unchanged (still BEFORE UPDATE OR DELETE from 106).

-- (2) search_path on the storage-path helper
create or replace function public.project_id_from_storage_name(p_name text)
returns uuid
language sql
stable
set search_path = public, storage
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(p_name))[1])::uuid
    else null
  end
$$;

-- (3) block external profiles from project membership (wraps the existing
-- admin / global-admin / creator-self-insert branches). The creator is always
-- internal (projects_insert blocks externals from creating), so the creator
-- path is unaffected.
drop policy if exists "project_members_insert" on public.project_members;
create policy "project_members_insert" on public.project_members
  for insert with check (
    not public.is_external_user(project_members.profile_id)
    and (
      public.is_project_admin(project_id)
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
      or (
        project_members.profile_id = auth.uid()
        and project_members.role = 'owner'
        and not public.project_has_members(project_members.project_id)
      )
    )
  );
