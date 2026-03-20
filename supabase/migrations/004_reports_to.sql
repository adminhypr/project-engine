-- ============================================================
-- Migration 004: Add reports_to for manager/reporting assignment
-- Allows admins to explicitly set "X reports to Y"
-- ============================================================

-- Add reports_to column to profiles
alter table public.profiles
  add column reports_to uuid references public.profiles(id) on delete set null;

-- Index for lookups (who reports to me?)
create index idx_profiles_reports_to on public.profiles(reports_to);

-- ─────────────────────────────────────────────
-- Update task visibility RLS to include reports_to
-- Managers can now also see tasks of users who report to them
-- ─────────────────────────────────────────────

-- Drop and recreate task SELECT policy
drop policy "Task visibility by role" on public.tasks;

create policy "Task visibility by role"
  on public.tasks for select
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or (p.role = 'Manager' and p.team_id = tasks.team_id)
        -- NEW: manager can see tasks of anyone who reports to them
        or (p.role in ('Manager', 'Admin') and exists (
          select 1 from public.profiles assignee
          where assignee.id = tasks.assigned_to
          and assignee.reports_to = auth.uid()
        ))
      )
    )
  );

-- Drop and recreate task UPDATE policy
drop policy "Task update by role" on public.tasks;

create policy "Task update by role"
  on public.tasks for update
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or (p.role = 'Manager' and p.team_id = tasks.team_id)
        -- NEW: manager can update tasks of anyone who reports to them
        or (p.role in ('Manager', 'Admin') and exists (
          select 1 from public.profiles assignee
          where assignee.id = tasks.assigned_to
          and assignee.reports_to = auth.uid()
        ))
      )
    )
  );

-- Update comment visibility to match
drop policy "Comment visibility" on public.comments;

create policy "Comment visibility"
  on public.comments for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = comments.task_id
      and (
        t.assigned_to = auth.uid()
        or t.assigned_by = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
          and (
            p.role = 'Admin'
            or (p.role = 'Manager' and p.team_id = t.team_id)
            or (p.role in ('Manager', 'Admin') and exists (
              select 1 from public.profiles assignee
              where assignee.id = t.assigned_to
              and assignee.reports_to = auth.uid()
            ))
          )
        )
      )
    )
  );
