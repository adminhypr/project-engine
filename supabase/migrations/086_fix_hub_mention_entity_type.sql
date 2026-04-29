-- ─────────────────────────────────────────────
-- 086 · Fix entity_type match in hub-mention payload
--
-- Migration 085 added 'message_id' to the hub_mention notification
-- payload but matched on entity_type = 'hub_message'. The actual value
-- written by useHubMessages.postMessage is 'message' (and replies use
-- 'message_reply'). The 085 case clause therefore always set
-- message_id = null — defeating the deep-link feature.
--
-- This migration replaces the function again with the correct match.
-- For 'message_reply' entries we leave message_id null in v1 — the
-- frontend's data-hub-message-id anchor only exists on top-level
-- posts (see MessageBoard.jsx). A future migration could join through
-- to the parent message and set message_id to the parent so the deep
-- link still scrolls into a useful neighbourhood.
-- ─────────────────────────────────────────────

create or replace function public.enqueue_hub_mention_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mentioner_name text;
  hub_name text;
begin
  if new.mentioned_user is null or new.mentioned_user = new.mentioned_by then
    return new;
  end if;
  select full_name into mentioner_name from public.profiles where id = new.mentioned_by;
  select name into hub_name from public.hubs where id = new.hub_id;

  insert into public.notification_outbox
    (recipient_id, event_type, payload, source_table, source_id)
  values
    (new.mentioned_user, 'hub_mention',
     jsonb_build_object(
       'actor_id',     new.mentioned_by,
       'actor_name',   coalesce(mentioner_name, 'Someone'),
       'hub_id',       new.hub_id,
       'hub_name',     coalesce(hub_name, 'a hub'),
       'entity_type',  new.entity_type,
       'entity_id',    new.entity_id,
       'message_id',   case when new.entity_type = 'message' then new.entity_id else null end
     ),
     'hub_mentions', new.id);
  return new;
end;
$$;
