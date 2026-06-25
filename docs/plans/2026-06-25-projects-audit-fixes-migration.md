# Dev Projects Audit Fixes — Migration 111 (apply to Supabase)

**What:** Three DB-layer fixes from the post-ship audit:
1. **`guard_project_last_owner` cascade fix** — deleting a project cascades to `project_members`, firing the BEFORE DELETE owner guard which (seeing 0 remaining owners) aborts the whole delete. So **no sole-owner project could ever be deleted**. Now the guard skips during project teardown.
2. **`project_id_from_storage_name` gets `search_path`** (consistency with the 051 hardening; the only project function missing it).
3. **Block externals (Agent/Client) from project membership** — DB defense-in-depth behind the frontend fix (the Members picker was leaking externals).

**When:** Apply alongside the frontend fix branch. Items 2–3 are pure hardening; item 1 only matters once a "delete project" path exists (none is wired yet) — but it's a latent landmine worth closing now. The frontend audit fixes work without it.

**How:** Paste into the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql/new) and **Run**. Idempotent (`create or replace`, `drop policy if exists`). Depends on `is_external_user` (038), `is_project_admin`/`project_has_members` (106), `project_id_from_storage_name` (110) — all live.

```sql
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
  if tg_op = 'DELETE' and not exists (select 1 from public.projects where id = old.project_id) then
    return old;  -- project itself is being deleted; don't block cascade teardown
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

-- (3) block externals from project membership
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
```

## Optional verification (item 1)
There's no delete-project button in the UI yet, so this is hard to smoke via the app. If you want to confirm the cascade fix, run a throwaway test in SQL:
```sql
-- as a normal authenticated session, NOT service_role (service_role bypasses RLS/guards):
-- create a project via the app, then: delete from projects where id = '<that id>';
-- before 111 this raised 'a project must keep at least one owner'; after, it succeeds.
```
(Adding members / removing a non-last owner / demoting still correctly guards the last owner.)
