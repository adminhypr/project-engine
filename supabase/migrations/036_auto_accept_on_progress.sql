-- ─────────────────────────────────────────────
-- 036 · Auto-accept pending tasks when the assignee moves them forward
--
-- Requiring acceptance before working is friction. If an assignee changes
-- the status to 'In Progress' or 'Done' while the task is still Pending
-- acceptance, that's an implicit accept — flip the row to Accepted in the
-- same update and log the transition to the audit log.
--
-- Implementation: extend the existing BEFORE UPDATE trigger function
-- (`audit_acceptance_change`) with an up-front branch that mutates the
-- NEW row. The existing audit block downstream then fires naturally, so
-- the change shows up in task_audit_log with an "Auto-accepted" note.
-- ─────────────────────────────────────────────

create or replace function public.audit_acceptance_change()
returns trigger as $$
begin
  -- Auto-accept when the assignee moves the task forward while Pending.
  -- Guards:
  --   · old.acceptance_status = 'Pending'  (don't touch already-accepted or
  --     declined tasks)
  --   · new.acceptance_status is still 'Pending' in the incoming update
  --     (the user didn't simultaneously accept/decline in the same call)
  --   · status is transitioning (not an unrelated field update on a row
  --     that happens to already be In Progress — we want this to fire
  --     only on the actual "move forward" event)
  if old.acceptance_status = 'Pending'
     and new.acceptance_status = 'Pending'
     and new.status in ('In Progress','Done')
     and (old.status is distinct from new.status) then
    new.acceptance_status := 'Accepted';
    new.accepted_at := now();
  end if;

  -- Existing audit: accepted transition (covers both manual accept and
  -- the auto-accept branch above). Append a note when it was auto.
  if new.acceptance_status = 'Accepted' and old.acceptance_status = 'Pending' then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value, note)
    values (
      new.id,
      'accepted',
      new.assigned_to,
      'Pending',
      'Accepted',
      case
        when new.status in ('In Progress','Done') and (old.status is distinct from new.status)
          then 'Auto-accepted on status → ' || new.status
        else null
      end
    );
  end if;

  -- Existing audit: declined transition.
  if new.acceptance_status = 'Declined' and old.acceptance_status = 'Pending' then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value, note)
    values (
      new.id,
      'declined',
      new.assigned_to,
      'Pending',
      'Declined',
      coalesce(new.decline_reason, 'No reason provided')
    );
  end if;

  -- Existing: reassignment from a declined state resets acceptance.
  if new.assigned_to is distinct from old.assigned_to
     and old.acceptance_status = 'Declined' then
    new.acceptance_status := 'Pending';
    new.decline_reason := null;
    new.accepted_at := null;
    new.declined_at := null;
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- Trigger definition unchanged (still BEFORE UPDATE calling this function).
