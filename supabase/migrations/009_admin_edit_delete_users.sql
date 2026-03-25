-- ============================================================
-- Project Engine — 009: Admin Edit & Delete Users
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────
-- Allow admins to delete profiles
-- ─────────────────────────────────────────────
create policy "Admins can delete profiles"
  on public.profiles for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'Admin'
    )
  );

-- ─────────────────────────────────────────────
-- Fix audit log FK: allow profile deletion
-- without losing audit history
-- (performed_by set to null instead of blocking)
-- ─────────────────────────────────────────────
alter table public.task_audit_log
  drop constraint task_audit_log_performed_by_fkey;

alter table public.task_audit_log
  add constraint task_audit_log_performed_by_fkey
    foreign key (performed_by)
    references public.profiles(id)
    on delete set null;
