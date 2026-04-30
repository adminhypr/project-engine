-- ─────────────────────────────────────────────
-- 092 · Card-assignee audit trigger: skip during cascade delete
--
-- Real prod bug observed today: deleting a hub failed with
--   ERROR: 23503: insert or update on table "hub_card_audit_log"
--   violates foreign key constraint "hub_card_audit_log_card_id_fkey"
--   DETAIL: Key (card_id)=(...) is not present in table "hub_cards".
--   CONTEXT: PL/pgSQL function audit_hub_card_assignee_change()
--
-- Cascade chain when a hub is deleted:
--   hubs → hub_modules → hub_card_columns → hub_cards → hub_card_assignees
--
-- The DELETE on hub_card_assignees fires trg_audit_hub_card_assignee_change
-- AFTER the parent hub_cards row is already gone. The trigger tries to
-- INSERT a new audit row with card_id = old.card_id, which violates the
-- audit log's FK to hub_cards (the card is no longer present), so the
-- whole transaction rolls back. User sees "Failed to delete hub".
--
-- Fix: skip the audit INSERT when the parent card no longer exists. We
-- only want to audit USER-INITIATED unassignments, not cascade-driven
-- ones (the cascade itself is already implied by the hub/card deletion
-- — there's nothing useful to audit).
--
-- The INSERT branch keeps its original behavior; only the DELETE branch
-- gets the guard.
-- ─────────────────────────────────────────────

create or replace function public.audit_hub_card_assignee_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  who_name text;
begin
  if tg_op = 'INSERT' then
    select full_name into who_name from public.profiles where id = new.profile_id;
    insert into public.hub_card_audit_log (card_id, event_type, performed_by, new_value, note)
    values (new.card_id, 'assignee_added', caller, new.profile_id::text,
            'Assigned ' || coalesce(who_name, 'a member'));
  elsif tg_op = 'DELETE' then
    -- Cascade-delete guard: if the parent card has already been deleted
    -- (typical when DELETING a hub, hub_module, hub_card_column, or the
    -- card itself), skip the audit insert. The audit row would FK-fail
    -- against the just-deleted card.
    if not exists (select 1 from public.hub_cards where id = old.card_id) then
      return old;
    end if;
    select full_name into who_name from public.profiles where id = old.profile_id;
    insert into public.hub_card_audit_log (card_id, event_type, performed_by, old_value, note)
    values (old.card_id, 'assignee_removed', caller, old.profile_id::text,
            'Unassigned ' || coalesce(who_name, 'a member'));
  end if;
  return coalesce(new, old);
end;
$$;
