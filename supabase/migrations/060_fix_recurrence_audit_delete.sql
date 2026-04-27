-- ─────────────────────────────────────────────
-- 060 · Fix audit_task_recurrence_change trigger blocking template DELETE
--
-- The original trigger (058) tried to insert a 'deleted' audit row in the
-- AFTER DELETE branch — which fails the FK check because the parent
-- task_recurrences row is already gone, and task_recurrence_audit cascades
-- on it.
--
-- v1 trade-off: drop the delete-audit. Cascade-delete already removes the
-- whole audit history along with the template, so a final "deleted" entry
-- has nowhere to live anyway. If we ever want a separate "system audit"
-- that survives template deletion, it'd need its own table outside the
-- cascade.
-- ─────────────────────────────────────────────

create or replace function public.audit_task_recurrence_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
    values (new.id, 'created', new.created_by, new.template_title);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.is_active is distinct from new.is_active then
      insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
      values (
        new.id,
        case when new.is_active then 'resumed' else 'paused' end,
        auth.uid(),
        null
      );
    end if;

    if old.template_title is distinct from new.template_title
       or old.template_notes is distinct from new.template_notes
       or old.template_icon is distinct from new.template_icon
       or old.template_urgency is distinct from new.template_urgency
       or old.template_due_offset_hours is distinct from new.template_due_offset_hours
       or old.team_id is distinct from new.team_id
       or old.interval_unit is distinct from new.interval_unit
       or old.interval_every is distinct from new.interval_every
       or old.anchor_at is distinct from new.anchor_at then
      insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
      values (new.id, 'edited', auth.uid(), null);
    end if;

    return new;
  end if;

  -- DELETE branch intentionally omitted — see header comment.
  return null;
end;
$$;

-- Trigger definition unchanged (still fires on insert/update/delete) — only
-- the function body changed. No need to drop/recreate the trigger itself.
