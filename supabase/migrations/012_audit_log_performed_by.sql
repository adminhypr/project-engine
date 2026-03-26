-- ============================================================
-- Project Engine — 012: Fix audit log to track who performed updates
-- The original trigger hardcoded performed_by as NULL for all
-- task update events. This replaces it with auth.uid() so the
-- activity log shows who made each change.
-- ============================================================

create or replace function public.audit_task_updated()
returns trigger as $$
declare
  _uid uuid := auth.uid();
begin
  -- Status changed
  if new.status is distinct from old.status then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'status_changed', _uid, old.status, new.status);
  end if;

  -- Urgency changed
  if new.urgency is distinct from old.urgency then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'urgency_changed', _uid, old.urgency, new.urgency);
  end if;

  -- Due date changed
  if new.due_date is distinct from old.due_date then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (
      new.id,
      'due_date_changed',
      _uid,
      case when old.due_date is not null then old.due_date::text else 'none' end,
      case when new.due_date is not null then new.due_date::text else 'removed' end
    );
  end if;

  -- Notes updated
  if new.notes is distinct from old.notes then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'notes_updated', _uid, left(coalesce(old.notes, ''), 100), left(coalesce(new.notes, ''), 100));
  end if;

  -- Reassigned (assigned_to changed)
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value, note)
    values (
      new.id,
      'reassigned',
      _uid,
      (select full_name from public.profiles where id = old.assigned_to),
      (select full_name from public.profiles where id = new.assigned_to),
      'Reassigned from ' || coalesce((select full_name from public.profiles where id = old.assigned_to), 'unknown') ||
      ' to ' || coalesce((select full_name from public.profiles where id = new.assigned_to), 'unknown')
    );
  end if;

  return new;
end;
$$ language plpgsql security definer;
