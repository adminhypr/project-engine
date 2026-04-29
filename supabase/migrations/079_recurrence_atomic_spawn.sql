-- ─────────────────────────────────────────────
-- 079 · Atomic recurring-task spawn
--
-- Wraps the task INSERT + task_assignees seed + audit log writes +
-- next_run_at advance into one server-side function so the
-- spawn-recurring-tasks edge function can no longer leave a
-- half-applied state on crash.
--
-- Concurrency: pg_try_advisory_xact_lock keyed on the template id
-- serializes overlapping spawns of the same template. Lock is
-- released automatically at COMMIT/ROLLBACK because the entire RPC
-- runs in one implicit transaction.
--
-- Returns:
--   • the new task uuid on success
--   • NULL when the template is not currently due (locked, paused,
--     not-yet-due, or removed)
--
-- Pre-spawn steps (assignee validation, deactivate-and-notify on zero
-- valid assignees) remain in the edge function — only the
-- post-validation insert+audit+advance block is moved into this RPC.
--
-- Known pre-existing failure modes inherited from migration 058 (the
-- RPC behaves no worse than the prior edge-function flow, but rolls
-- back cleanly instead of leaving a half-applied state):
--   • template_urgency = 'Urgent' fails tasks.urgency CHECK
--     (001:65-66 only allows Low/Med/High). Surfaces as
--     `tasks_urgency_check` violation. Follow-up: extend tasks.urgency
--     CHECK to include 'Urgent', or normalize at template-edit time.
--   • A template whose creator was deleted has created_by = NULL
--     (058:34, on delete set null). The RPC tries to insert
--     assigned_by = NULL and fails the NOT NULL on tasks (001:60).
--     Follow-up: either fall back to a system user, or skip + audit.
--
-- Telemetry note: the RPC returns NULL for three distinct reasons
-- (advisory-lock contention, paused, race-loss to a sibling worker).
-- For richer ops debugging the signature could be widened to a
-- (uuid, text) composite. Acceptable for v1 single-replica cron.
-- ─────────────────────────────────────────────

create or replace function public.spawn_recurrence(
  p_recurrence_id uuid,
  p_task_id_str   text,
  p_due_date      timestamptz,
  p_assignees     jsonb,        -- [{profile_id, is_primary}]
  p_creator       uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rec        public.task_recurrences%rowtype;
  primary_id uuid;
  new_task   uuid;
  next_run   timestamptz;
begin
  -- Per-template advisory lock for the duration of this transaction.
  -- A second concurrent spawn of the same template returns NULL.
  if not pg_try_advisory_xact_lock(hashtext(p_recurrence_id::text)) then
    return null;
  end if;

  -- Re-read the template inside the lock and re-check the spawn
  -- predicate. FOR UPDATE prevents a concurrent UPDATE from racing us
  -- between the SELECT and our own UPDATE below.
  select * into rec
    from public.task_recurrences
   where id = p_recurrence_id
   for update;

  if not found then            return null; end if;
  if not rec.is_active then    return null; end if;
  if rec.next_run_at > now() then return null; end if;

  if p_assignees is null or jsonb_typeof(p_assignees) <> 'array'
     or jsonb_array_length(p_assignees) = 0 then
    return null;
  end if;

  -- Pick the primary assignee: the first row flagged is_primary, else
  -- the first row in the array.
  primary_id := coalesce(
    (select (elem ->> 'profile_id')::uuid
       from jsonb_array_elements(p_assignees) elem
      where (elem ->> 'is_primary')::boolean = true
      limit 1),
    (select (elem ->> 'profile_id')::uuid
       from jsonb_array_elements(p_assignees) elem
      limit 1)
  );

  if primary_id is null then
    return null;
  end if;

  -- 1) Insert the task. assigned_to/assigned_by are NOT NULL on the
  -- tasks table (001_initial.sql:59-60), so creator must be set when
  -- this RPC is invoked. The edge function already short-circuits on
  -- a deleted creator before reaching here.
  insert into public.tasks (
    task_id,
    title,
    notes,
    icon,
    urgency,
    due_date,
    assigned_to,
    assigned_by,
    assignment_type,
    team_id,
    status,
    date_assigned,
    recurrence_id
  ) values (
    p_task_id_str,
    rec.template_title,
    rec.template_notes,
    rec.template_icon,
    rec.template_urgency,
    p_due_date,
    primary_id,
    p_creator,
    'Self',
    rec.team_id,
    'Not Started',
    now(),
    rec.id
  )
  returning id into new_task;

  -- 2) Insert the task_assignees junction rows. Mark only the primary
  -- as is_primary regardless of what the JSONB array claimed (defends
  -- against multiple primary=true entries).
  insert into public.task_assignees (task_id, profile_id, is_primary)
  select
    new_task,
    (elem ->> 'profile_id')::uuid,
    ((elem ->> 'profile_id')::uuid = primary_id)
    from jsonb_array_elements(p_assignees) elem
   where (elem ->> 'profile_id') is not null
  on conflict do nothing;

  -- 3) Audit: per-task (recurring_spawned) + template-level (spawned).
  insert into public.task_audit_log (
    task_id, event_type, performed_by, old_value, new_value, note
  ) values (
    new_task,
    'recurring_spawned',
    p_creator,
    null,
    rec.id::text,
    'Spawned from recurring template: ' || rec.template_title
  );

  insert into public.task_recurrence_audit (
    recurrence_id, event_type, performed_by, note
  ) values (
    rec.id,
    'spawned',
    p_creator,
    'Spawned task ' || new_task::text
  );

  -- 4) Advance next_run_at via the SQL helper. Same signature the
  -- edge function used to call (compute_next_recurrence_run with
  -- p_from defaulted to now()).
  next_run := public.compute_next_recurrence_run(
    rec.anchor_at,
    rec.interval_unit,
    rec.interval_every
  );

  update public.task_recurrences
     set next_run_at = next_run
   where id = rec.id;

  return new_task;
end;
$$;

revoke all on function public.spawn_recurrence(uuid, text, timestamptz, jsonb, uuid) from public;
-- Service role bypasses RLS; no grant to authenticated.
