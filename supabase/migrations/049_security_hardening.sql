-- ============================================================
-- Migration 049: Security hardening
--   C2 — Manager→Admin privilege escalation via 008 policy
--   C3 — task-attachments bucket readable by any authenticated user
-- ============================================================

-- ─────────────────────────────────────────────
-- C2: Manager update on unassigned users — restrict mutable columns.
-- The original policy from 008 had USING but no WITH CHECK, letting
-- Managers change role / email / reports_to / etc. We now tighten
-- the policy and add a BEFORE UPDATE trigger that fires on ANY
-- profile update (self or cross-user) so sensitive columns are
-- immutable to non-Admin callers.
-- ─────────────────────────────────────────────
drop policy if exists "Managers can update unassigned user profiles" on public.profiles;
create policy "Managers can update unassigned user profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('Manager','Admin')
    )
    -- Target user must have no team_id set (unassigned)
    and team_id is null
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('Manager','Admin')
    )
    -- Post-update: target may now have a team_id (setting it is the point).
    -- Sensitive cols are enforced by guard_profile_cross_user_updates below.
  );

-- Companion trigger: block non-Admin callers from mutating
-- role / email / reports_to on any profile row — self or cross-user.
create or replace function public.guard_profile_cross_user_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  is_admin_caller boolean;
begin
  -- Service role / background context (no auth.uid) bypass.
  if caller is null then
    return new;
  end if;

  select (role = 'Admin') into is_admin_caller
    from public.profiles where id = caller;

  if coalesce(is_admin_caller, false) then
    return new;
  end if;

  -- Non-admin caller: sensitive columns must not change, regardless of
  -- whether this is a self-update or a cross-user update. 042's guard
  -- already covers self-updates; this trigger closes the cross-user path.
  if new.role is distinct from old.role then
    raise exception 'only Admin can change profiles.role';
  end if;
  if new.email is distinct from old.email then
    raise exception 'only Admin can change profiles.email';
  end if;
  if new.reports_to is distinct from old.reports_to then
    raise exception 'only Admin can change profiles.reports_to';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_cross_user_updates on public.profiles;
create trigger trg_guard_profile_cross_user_updates
  before update on public.profiles
  for each row execute function public.guard_profile_cross_user_updates();

-- ─────────────────────────────────────────────
-- C3: task-attachments bucket was readable by any authenticated user,
-- including externals. Gate SELECT on task visibility via join to
-- task_attachments (storage_path = storage.objects.name) and then
-- rely on task_attachments' own RLS (already enforces task visibility
-- including Admin / Manager-of-team / assignee / assigner / extra
-- assignees). Tighten INSERT to non-externals with caller-owned folder.
-- ─────────────────────────────────────────────
drop policy if exists "Authenticated read" on storage.objects;
create policy "task_attachments_read_via_task"
  on storage.objects for select
  using (
    bucket_id = 'task-attachments'
    and exists (
      select 1
        from public.task_attachments ta
       where ta.storage_path = storage.objects.name
    )
  );

-- INSERT: the storage upload happens BEFORE the task_attachments row
-- is created, so we can't join by storage_path. Require the first
-- folder segment to be the caller's user id (matches existing
-- convention used by the owner-delete policy) and block externals.
drop policy if exists "Authenticated upload" on storage.objects;
create policy "task_attachments_insert_via_task"
  on storage.objects for insert
  with check (
    bucket_id = 'task-attachments'
    and auth.role() = 'authenticated'
    and not public.is_external_user(auth.uid())
    and (storage.foldername(name))[1] = auth.uid()::text
  );
