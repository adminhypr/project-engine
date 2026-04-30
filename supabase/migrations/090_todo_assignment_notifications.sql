-- ─────────────────────────────────────────────
-- 090 · To-do assignment notifications
--
-- Bug observed in prod: when a hub member (any role, but originally
-- spotted with Client → Staff) assigns someone to a to-do item, the
-- assignee gets nothing — no bell, no email. The activity feed updates
-- (per 023's hub_activity_on_todo_assigned) but there's no path to the
-- notification_outbox or to the bell.
--
-- This migration closes the gap symmetrically with the card-table
-- pattern from migration 070:
--
--   1. Add `hub_todo_item_assignees.assigned_by` column. Auto-populated
--      via a BEFORE INSERT trigger so the 3 existing frontend INSERT
--      call sites (useHubTodos.createItem + setAssignees,
--      AssignTodoFromChatModal) don't need any code change. Existing
--      rows are left NULL — there's no reliable way to recover the
--      assigner historically and the bell only looks at the last 7
--      days anyway.
--
--   2. Extend notification_outbox.event_type CHECK with 'todo_assigned'
--      (069+070 added the card_* values; this slots in next to them).
--
--   3. AFTER INSERT trigger on hub_todo_item_assignees that writes one
--      outbox row per (recipient, assignment), skipping self-assignment.
--      Payload mirrors card_assigned: actor_id/actor_name, item_id,
--      item_title, list_id, list_title, hub_id.
--
-- The bell does NOT yet read from notification_outbox — that's the
-- "delivered_to_bell_at" / future bell-unification work parked in
-- migration 062's comment. For now the bell uses scattered fetches.
-- This migration's outbox rows are still useful: they're picked up by
-- the notification-digest cron once that function adds a 'todo_assigned'
-- renderer (separate follow-up — not done here so this migration
-- doesn't require an edge-function redeploy).
-- ─────────────────────────────────────────────

-- ── 1. assigned_by column + BEFORE INSERT auto-default ───────
alter table public.hub_todo_item_assignees
  add column if not exists assigned_by uuid
    references public.profiles(id) on delete set null;

-- column-default `auth.uid()` is rejected by Postgres (defaults must be
-- IMMUTABLE; auth.uid() is STABLE). Use a BEFORE INSERT trigger so
-- existing INSERT call sites that don't pass assigned_by still get it
-- populated.
create or replace function public.set_todo_assignee_assigned_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_by is null then
    new.assigned_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_todo_assignee_assigned_by on public.hub_todo_item_assignees;
create trigger trg_set_todo_assignee_assigned_by
  before insert on public.hub_todo_item_assignees
  for each row execute function public.set_todo_assignee_assigned_by();

-- ── 2. Extend notification_outbox event_type CHECK ───────────
alter table public.notification_outbox
  drop constraint if exists notification_outbox_event_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_event_type_check
    check (event_type in (
      'task_assigned','task_completed','task_declined','task_reassigned',
      'comment_posted','comment_mention',
      'task_chat_message','task_chat_mention',
      'group_message','group_mention',
      'dm_message','hub_mention',
      'card_assigned','card_comment','card_mention',
      'todo_assigned'
    ));

-- ── 3. AFTER INSERT outbox enqueue trigger ───────────────────
create or replace function public.enqueue_todo_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller        uuid := coalesce(new.assigned_by, auth.uid());
  hub_id_v      uuid;
  item_title_v  text;
  list_id_v     uuid;
  list_title_v  text;
  actor_name_v  text;
begin
  -- Defensive: if we have no caller, we can't credit anyone — drop the
  -- outbox row rather than insert a payload with NULL actor_id.
  if caller is null then return new; end if;

  -- Skip self-assignment (matches card_assigned and task_assigned
  -- patterns).
  if new.profile_id = caller then return new; end if;

  select i.hub_id, i.title, i.list_id
    into hub_id_v, item_title_v, list_id_v
    from public.hub_todo_items i
   where i.id = new.item_id;

  -- If the item was deleted between assignment and trigger fire, bail.
  if hub_id_v is null then return new; end if;

  select title into list_title_v
    from public.hub_todo_lists where id = list_id_v;

  select full_name into actor_name_v
    from public.profiles where id = caller;

  insert into public.notification_outbox
    (recipient_id, event_type, payload, source_table, source_id)
  values (
    new.profile_id,
    'todo_assigned',
    jsonb_build_object(
      'actor_id',    caller,
      'actor_name',  coalesce(actor_name_v, 'Someone'),
      'item_id',     new.item_id,
      'item_title',  coalesce(item_title_v, 'a to-do'),
      'list_id',     list_id_v,
      'list_title',  coalesce(list_title_v, 'a list'),
      'hub_id',      hub_id_v
    ),
    'hub_todo_item_assignees',
    new.id
  );

  return new;
end;
$$;

drop trigger if exists trg_enqueue_todo_assignment on public.hub_todo_item_assignees;
create trigger trg_enqueue_todo_assignment
  after insert on public.hub_todo_item_assignees
  for each row execute function public.enqueue_todo_assignment_notification();
