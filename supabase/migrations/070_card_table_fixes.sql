-- ─────────────────────────────────────────────
-- 070 · Forward-fixes for migration 069 (Card Table)
--
-- Two critical issues from code review of 069:
--
--   1. Legacy `comments` INSERT policy from 001 ("Authenticated users can
--      post comments") is wide-open: it only checks authenticated +
--      author_id = auth.uid(). With 069 adding `card_id`, any authenticated
--      user can now seed a card comment with any card_id, bypassing the
--      hub-membership scope of `comments_insert_card_member`. We retighten
--      it to require task_id IS NOT NULL — task INSERTs continue to flow
--      through the legacy permissive policy (existing behaviour); card
--      INSERTs are forced through `comments_insert_card_member` only.
--
--   2. The replacement enqueue_comment_notification function in 069 wrote
--      `{preview, author}` payloads instead of the original 062 shape
--      `{actor_id, actor_name, task_title, snippet}`. The digest cron
--      (notification-digest/index.ts) reads actor_name / task_title /
--      snippet directly — the rewrite would have produced empty digest
--      cards for every task comment after 069 applied. Restore parity
--      for the task branch and use a parallel shape for the card branch.
--      Also: card_assigned payload now includes actor_name + uses
--      actor_id (not "assigner") for consistency.
-- ─────────────────────────────────────────────

-- 1. Tighten the legacy `comments` INSERT policy to task-only.

drop policy if exists "Authenticated users can post comments" on public.comments;

create policy "Authenticated users can post comments"
  on public.comments for insert
  with check (
    task_id is not null
    and auth.role() = 'authenticated'
    and author_id = auth.uid()
  );

-- 2. Add search_path hardening to bump_hub_card_updated_at (was missed in 069).
create or replace function public.bump_hub_card_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end $$;

-- 3. Restore migration-062-compatible payload for task comments AND use
--    a parallel shape for card comments. Trigger from 062 still fires
--    AFTER INSERT on comments and calls this function — replacing the
--    function suffices.

create or replace function public.enqueue_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  watcher       uuid;
  mentioned     uuid;
  payload_json  jsonb;
  author_name   text;
  task_title_v  text;
  card_title_v  text;
  hub_id_v      uuid;
begin
  -- Resolve author display name (used by both branches).
  select full_name into author_name from public.profiles where id = new.author_id;

  -- Task comment branch (preserves 062 payload shape exactly).
  if new.task_id is not null then
    select title into task_title_v from public.tasks where id = new.task_id;

    payload_json := jsonb_build_object(
      'actor_id',   new.author_id,
      'actor_name', coalesce(author_name, 'Someone'),
      'task_id',    new.task_id,
      'task_title', coalesce(task_title_v, 'Task'),
      'snippet',    left(coalesce(new.content, ''), 140)
    );

    -- Watchers: assignee, secondary assignees, assigner — minus author.
    for watcher in
      select distinct uid from (
        select t.assigned_to as uid from public.tasks t where t.id = new.task_id
        union
        select t.assigned_by as uid from public.tasks t where t.id = new.task_id
        union
        select ta.profile_id as uid from public.task_assignees ta where ta.task_id = new.task_id
      ) w where uid is not null and uid <> new.author_id
    loop
      insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
      values (watcher, 'comment_posted', payload_json, 'comments', new.id);
    end loop;

    if new.mentioned_ids is not null and array_length(new.mentioned_ids, 1) > 0 then
      foreach mentioned in array new.mentioned_ids loop
        if mentioned <> new.author_id then
          insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
          values (mentioned, 'comment_mention', payload_json, 'comments', new.id);
        end if;
      end loop;
    end if;

    return new;
  end if;

  -- Card comment branch (parallel shape — adds card_id + hub_id, swaps
  -- task_title for card_title).
  if new.card_id is not null then
    select hm.hub_id, c.title into hub_id_v, card_title_v
      from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
     where c.id = new.card_id;

    payload_json := jsonb_build_object(
      'actor_id',   new.author_id,
      'actor_name', coalesce(author_name, 'Someone'),
      'card_id',    new.card_id,
      'hub_id',     hub_id_v,
      'card_title', coalesce(card_title_v, 'a card'),
      'snippet',    left(coalesce(new.content, ''), 140)
    );

    for watcher in
      select profile_id from public.hub_card_assignees
       where card_id = new.card_id and profile_id <> new.author_id
    loop
      insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
      values (watcher, 'card_comment', payload_json, 'comments', new.id);
    end loop;

    if new.mentioned_ids is not null and array_length(new.mentioned_ids, 1) > 0 then
      foreach mentioned in array new.mentioned_ids loop
        if mentioned <> new.author_id then
          insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
          values (mentioned, 'card_mention', payload_json, 'comments', new.id);
        end if;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

-- 4. Card-assignment payload: include actor_name and rename `assigner` to
--    `actor_id` so the digest can render with the same helpers it uses
--    for task_assigned.

create or replace function public.enqueue_card_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller       uuid := auth.uid();
  hub_id_v     uuid;
  card_title_v text;
  actor_name_v text;
begin
  if new.profile_id = caller then return new; end if;

  select hm.hub_id, c.title into hub_id_v, card_title_v
    from public.hub_cards c
    join public.hub_modules hm on hm.id = c.module_id
   where c.id = new.card_id;

  select full_name into actor_name_v
    from public.profiles where id = caller;

  insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
  values (
    new.profile_id,
    'card_assigned',
    jsonb_build_object(
      'actor_id',   caller,
      'actor_name', coalesce(actor_name_v, 'Someone'),
      'card_id',    new.card_id,
      'hub_id',     hub_id_v,
      'card_title', coalesce(card_title_v, 'a card')
    ),
    'hub_card_assignees',
    new.card_id
  );

  return new;
end;
$$;
