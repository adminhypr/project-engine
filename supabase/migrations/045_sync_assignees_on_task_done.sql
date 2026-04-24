-- ─────────────────────────────────────────────
-- 045 · Sync per-assignee completion on manual status → Done
--
-- Gap in 044: a user can flip tasks.status to 'Done' directly via the
-- status dropdown without anyone ticking a per-assignee checkbox. The
-- task ends up Done at the task level, but task_assignees.completed_at
-- stays null for every assignee — so the detail panel shows empty
-- circles and the list chip shows a partial count on a closed task.
--
-- Fix: AFTER UPDATE trigger on tasks that back-fills completed_at /
-- completed_by on any open task_assignees rows whenever status
-- transitions to 'Done'. Idempotent on the aggregate + force-close
-- paths (where assignees are already filled → update matches zero rows).
--
-- Reuses the `app.force_close` GUC from 044 so the per-row self-update
-- guard (`guard_task_assignee_self_update`) allows this task-level
-- close even when the caller isn't admin / assigner.
-- ─────────────────────────────────────────────

create or replace function public.sync_assignees_on_task_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'Done' and old.status is distinct from 'Done' then
    -- Bypass the per-row self-update guard; this is a task-level close
    -- initiated by a legitimate tasks UPDATE that already passed tasks RLS.
    perform set_config('app.force_close', 'on', true);

    update public.task_assignees
       set completed_at = now(),
           completed_by = coalesce(auth.uid(), new.assigned_by)
     where task_id = new.id
       and completed_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_assignees_on_task_done on public.tasks;
create trigger trg_sync_assignees_on_task_done
  after update of status on public.tasks
  for each row execute function public.sync_assignees_on_task_done();
