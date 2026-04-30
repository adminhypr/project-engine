-- ─────────────────────────────────────────────
-- 088 · spawn_recurrence — defensive NULL p_creator guard
--
-- Pre-existing bug from 058 + 079: task_recurrences.created_by has
-- ON DELETE SET NULL (058:34). When the creator's profile is deleted,
-- subsequent spawns pass `p_creator = NULL` into spawn_recurrence,
-- which tries to INSERT into tasks.assigned_by (NOT NULL on 001:60)
-- and fails the constraint inside the RPC's transaction. The 079
-- header comment claimed the edge function short-circuits on this
-- case, but it doesn't — verified in the edge-function code.
--
-- The clean fix is in TWO layers:
--   • Edge function pre-check: detect rec.created_by IS NULL before
--     calling the RPC, deactivate + audit + notify (mirrors the
--     zero-assignees path in spawn-recurring-tasks/index.ts:75-114).
--     Done in the same commit as this migration.
--   • RPC defensive guard (this migration): if the pre-check is ever
--     bypassed (manual rpc call, future caller), refuse rather than
--     leave a half-applied state. Returns NULL like the other
--     refusal paths.
--
-- Idempotent: just `create or replace`. Body is unchanged except for
-- the new early-return. Also extends task_recurrence_audit.event_type
-- CHECK (058:85-87) to allow the new 'spawn_failed_creator_deleted'
-- value the edge function writes on the creator-null path.
-- ─────────────────────────────────────────────

-- Extend the audit CHECK first so the edge function's pre-spawn
-- audit insert succeeds.
alter table public.task_recurrence_audit
  drop constraint if exists task_recurrence_audit_event_type_check;

alter table public.task_recurrence_audit
  add constraint task_recurrence_audit_event_type_check
  check (event_type in (
    'created','edited','paused','resumed','spawned',
    'spawn_failed_no_assignees','spawn_failed_creator_deleted','deleted'
  ));

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

  -- NEW (088): defensive NULL-creator guard. The edge function is
  -- expected to deactivate-and-notify before reaching here; if it
  -- somehow bypasses that, refuse rather than crash.
  if p_creator is null then
    return null;
  end if;

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

  -- 1) Insert the task.
  insert into public.tasks (
    task_id, title, notes, icon, urgency, due_date,
    assigned_to, assigned_by, assignment_type, team_id,
    status, date_assigned, recurrence_id
  ) values (
    p_task_id_str, rec.template_title, rec.template_notes, rec.template_icon,
    rec.template_urgency, p_due_date, primary_id, p_creator, 'Self',
    rec.team_id, 'Not Started', now(), rec.id
  )
  returning id into new_task;

  -- 2) Insert the task_assignees junction rows. Mark only the primary
  -- as is_primary regardless of what the JSONB array claimed.
  insert into public.task_assignees (task_id, profile_id, is_primary)
  select
    new_task,
    (elem ->> 'profile_id')::uuid,
    ((elem ->> 'profile_id')::uuid = primary_id)
  from jsonb_array_elements(p_assignees) elem
  on conflict (task_id, profile_id) do nothing;

  -- 3) Audit (per-task + template-level).
  insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value, note)
    values (new_task, 'recurring_spawned', p_creator, null, rec.id::text,
            'Spawned from recurring template: ' || rec.template_title);

  insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
    values (rec.id, 'spawned', p_creator, 'Spawned task ' || new_task::text);

  -- 4) Advance next_run_at via the SQL helper.
  next_run := public.compute_next_recurrence_run(rec.anchor_at, rec.interval_unit, rec.interval_every);
  update public.task_recurrences set next_run_at = next_run where id = rec.id;

  return new_task;
end;
$$;
