-- ============================================================
-- 119: Dev Projects activity notifications
-- Design: docs/plans/2026-07-14-project-activity-notifications-design.md
--
-- Every project member gets a notification_outbox row (bell realtime +
-- offline email digest, migration 062 pipeline) whenever board activity
-- happens on their project, with a content preview in the payload:
--   • project_bug_reported      — bugs INSERT
--   • project_request_created   — feature_requests INSERT
--   • project_feature_created   — tasks INSERT with project_id
--   • project_feature_moved     — tasks UPDATE (status / column changed)
--   • project_comment           — comments INSERT on a project feature
--   • project_promotion         — bugs / feature_requests promoted_task_id set
--
-- PURELY ADDITIVE: no existing live function or policy is recreated.
-- The comments fan-out is a SECOND trigger on comments that excludes
-- everyone 062's enqueue_comment_notification already notifies.
--
-- Also activates 062's reserved delivered_to_bell_at column as the bell
-- seen-flag for these events: recipients may UPDATE their own rows, but a
-- guard trigger restricts non-service callers to that single column.
-- ============================================================

-- ── 1. Extend event_type CHECK, drift-proof ─────────────────
-- 069 and 090 both reset this constraint, and prod constraints have
-- drifted from migration files before (102). Read the LIVE definition,
-- extract its current value list, and union the new values — never
-- overwrite with a hardcoded list.
do $$
declare
  v_def  text;
  v_vals text[];
  v_new  text[] := array[
    'project_bug_reported','project_request_created','project_feature_created',
    'project_feature_moved','project_comment','project_promotion'
  ];
  v_item text;
  v_list text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conname = 'notification_outbox_event_type_check'
    and conrelid = 'public.notification_outbox'::regclass;

  if v_def is not null then
    select array_agg(m[1]) into v_vals
    from regexp_matches(v_def, '''([^'']+)''', 'g') m;
  end if;

  -- Fallback = canonical list as of 090 (base 062 + card_* 069 + todo 090).
  if v_vals is null or array_length(v_vals, 1) is null then
    v_vals := array[
      'task_assigned','task_completed','task_declined','task_reassigned',
      'comment_posted','comment_mention',
      'task_chat_message','task_chat_mention',
      'group_message','group_mention',
      'dm_message','hub_mention',
      'card_assigned','card_comment','card_mention',
      'todo_assigned'
    ];
  end if;

  foreach v_item in array v_new loop
    if not (v_item = any(v_vals)) then
      v_vals := v_vals || v_item;
    end if;
  end loop;

  select string_agg(quote_literal(v), ', ') into v_list from unnest(v_vals) v;

  execute 'alter table public.notification_outbox drop constraint if exists notification_outbox_event_type_check';
  execute format(
    'alter table public.notification_outbox add constraint notification_outbox_event_type_check check (event_type in (%s))',
    v_list
  );
end $$;

-- ── 2. Shared fan-out helper ─────────────────────────────────
-- Inserts one outbox row per project member, skipping the actor.
-- p_actor NULL (service-role writes, e.g. dev-api moves) notifies everyone.
create or replace function public._enqueue_project_activity(
  p_project      uuid,
  p_actor        uuid,
  p_event        text,
  p_payload      jsonb,
  p_source_table text,
  p_source_id    uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
begin
  for v_member in
    select profile_id from public.project_members
    where project_id = p_project
      and (p_actor is null or profile_id <> p_actor)
  loop
    insert into public.notification_outbox
      (recipient_id, event_type, payload, source_table, source_id)
    values
      (v_member, p_event, p_payload, p_source_table, p_source_id);
  end loop;
end;
$$;

revoke all on function public._enqueue_project_activity(uuid, uuid, text, jsonb, text, uuid) from public, anon, authenticated;

-- ── 3. Bug reported ──────────────────────────────────────────
create or replace function public.enqueue_project_bug_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project_name text;
  v_actor_name   text;
begin
  select name into v_project_name from public.projects where id = new.project_id;
  select full_name into v_actor_name from public.profiles where id = new.reporter_id;

  perform public._enqueue_project_activity(
    new.project_id, new.reporter_id, 'project_bug_reported',
    jsonb_build_object(
      'actor_id',     new.reporter_id,
      'actor_name',   coalesce(v_actor_name, 'Someone'),
      'project_id',   new.project_id,
      'project_name', coalesce(v_project_name, 'a project'),
      'bug_id',       new.id,
      'bug_title',    new.title,
      'severity',     new.severity,
      'snippet',      left(coalesce(new.description, ''), 140)
    ),
    'bugs', new.id);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_project_bug on public.bugs;
create trigger trg_enqueue_project_bug
  after insert on public.bugs
  for each row execute function public.enqueue_project_bug_notification();

-- ── 4. Feature request created ───────────────────────────────
create or replace function public.enqueue_project_request_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project_name text;
  v_actor_name   text;
begin
  select name into v_project_name from public.projects where id = new.project_id;
  select full_name into v_actor_name from public.profiles where id = new.requester_id;

  perform public._enqueue_project_activity(
    new.project_id, new.requester_id, 'project_request_created',
    jsonb_build_object(
      'actor_id',      new.requester_id,
      'actor_name',    coalesce(v_actor_name, 'Someone'),
      'project_id',    new.project_id,
      'project_name',  coalesce(v_project_name, 'a project'),
      'request_id',    new.id,
      'request_title', new.title,
      'snippet',       left(coalesce(new.description, ''), 140)
    ),
    'feature_requests', new.id);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_project_request on public.feature_requests;
create trigger trg_enqueue_project_request
  after insert on public.feature_requests
  for each row execute function public.enqueue_project_request_notification();

-- ── 5. Feature (project task) created ────────────────────────
create or replace function public.enqueue_project_feature_created_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project_name text;
  v_actor_name   text;
begin
  select name into v_project_name from public.projects where id = new.project_id;
  select full_name into v_actor_name from public.profiles where id = new.assigned_by;

  perform public._enqueue_project_activity(
    new.project_id, new.assigned_by, 'project_feature_created',
    jsonb_build_object(
      'actor_id',        new.assigned_by,
      'actor_name',      coalesce(v_actor_name, 'Someone'),
      'project_id',      new.project_id,
      'project_name',    coalesce(v_project_name, 'a project'),
      'task_id',         new.id,
      'task_display_id', new.task_id,
      'task_title',      new.title,
      'urgency',         new.urgency,
      'snippet',         left(coalesce(new.notes, ''), 140)
    ),
    'tasks', new.id);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_project_feature_created on public.tasks;
create trigger trg_enqueue_project_feature_created
  after insert on public.tasks
  for each row
  when (new.project_id is not null)
  execute function public.enqueue_project_feature_created_notification();

-- ── 6. Feature moved (status or column changed) ──────────────
-- Fires for board drags (move_feature), panel dropdown changes, dev-api
-- PATCHes, and aggregate auto-close. The 113 BEFORE trigger folds the
-- column sync into the same UPDATE, so one user action = one fire.
-- Actor is auth.uid(): NULL for service-role writers (dev-api) → everyone
-- is notified and the frontend renders "A teammate" (design residual).
create or replace function public.enqueue_project_feature_moved_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor        uuid := auth.uid();
  v_project_name text;
  v_actor_name   text;
  v_from_column  text;
  v_to_column    text;
begin
  select name into v_project_name from public.projects where id = new.project_id;
  if v_actor is not null then
    select full_name into v_actor_name from public.profiles where id = v_actor;
  end if;
  select name into v_from_column from public.project_columns where id = old.project_column_id;
  select name into v_to_column   from public.project_columns where id = new.project_column_id;

  perform public._enqueue_project_activity(
    new.project_id, v_actor, 'project_feature_moved',
    jsonb_build_object(
      'actor_id',        v_actor,
      'actor_name',      v_actor_name,
      'project_id',      new.project_id,
      'project_name',    coalesce(v_project_name, 'a project'),
      'task_id',         new.id,
      'task_display_id', new.task_id,
      'task_title',      new.title,
      'from_status',     old.status,
      'to_status',       new.status,
      'from_column',     v_from_column,
      'to_column',       v_to_column
    ),
    'tasks', new.id);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_project_feature_moved on public.tasks;
create trigger trg_enqueue_project_feature_moved
  after update on public.tasks
  for each row
  when (new.project_id is not null
        and (old.status is distinct from new.status
             or old.project_column_id is distinct from new.project_column_id))
  execute function public.enqueue_project_feature_moved_notification();

-- ── 7. Comment on a project feature ──────────────────────────
-- SECOND trigger on comments (062's enqueue_comment_notification is left
-- untouched). Notifies project members EXCEPT the author and everyone the
-- 062 trigger already covers (assigner, primary + secondary assignees,
-- mentioned users) — no double rows.
create or replace function public.enqueue_project_comment_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t              public.tasks%rowtype;
  v_project_name text;
  v_actor_name   text;
  v_member       uuid;
begin
  select * into t from public.tasks where id = new.task_id;
  if t.id is null or t.project_id is null then return new; end if;

  select name into v_project_name from public.projects where id = t.project_id;
  select full_name into v_actor_name from public.profiles where id = new.author_id;

  for v_member in
    select pm.profile_id from public.project_members pm
    where pm.project_id = t.project_id
      and pm.profile_id <> new.author_id
      and pm.profile_id is distinct from t.assigned_by
      and pm.profile_id is distinct from t.assigned_to
      and pm.profile_id not in
        (select ta.profile_id from public.task_assignees ta where ta.task_id = new.task_id)
      and (new.mentioned_ids is null or not (pm.profile_id = any(new.mentioned_ids)))
  loop
    insert into public.notification_outbox
      (recipient_id, event_type, payload, source_table, source_id)
    values
      (v_member, 'project_comment',
       jsonb_build_object(
         'actor_id',        new.author_id,
         'actor_name',      coalesce(v_actor_name, 'Someone'),
         'project_id',      t.project_id,
         'project_name',    coalesce(v_project_name, 'a project'),
         'task_id',         t.id,
         'task_display_id', t.task_id,
         'task_title',      t.title,
         'comment_id',      new.id,
         'snippet',         left(coalesce(new.content, ''), 140)
       ),
       'comments', new.id);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_project_comment on public.comments;
create trigger trg_enqueue_project_comment
  after insert on public.comments
  for each row
  when (new.task_id is not null)
  execute function public.enqueue_project_comment_notification();

-- ── 8. Bug / request promoted ────────────────────────────────
-- One function serves both tables (TG_TABLE_NAME distinguishes; severity
-- read via to_jsonb so it's simply absent for feature_requests).
-- Promote flows insert the task first, then set promoted_task_id — so a
-- project_feature_created row fires too. The FRONTEND collapses the pair
-- by task_id (design decision 3); the DB stays truthful.
create or replace function public.enqueue_project_promotion_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task         public.tasks%rowtype;
  v_actor        uuid;
  v_project_name text;
  v_actor_name   text;
begin
  select * into v_task from public.tasks where id = new.promoted_task_id;
  v_actor := coalesce(auth.uid(), v_task.assigned_by);

  select name into v_project_name from public.projects where id = new.project_id;
  select full_name into v_actor_name from public.profiles where id = v_actor;

  perform public._enqueue_project_activity(
    new.project_id, v_actor, 'project_promotion',
    jsonb_build_object(
      'actor_id',        v_actor,
      'actor_name',      coalesce(v_actor_name, 'Someone'),
      'project_id',      new.project_id,
      'project_name',    coalesce(v_project_name, 'a project'),
      'source',          case when tg_table_name = 'bugs' then 'bug' else 'request' end,
      'source_id',       new.id,
      'source_title',    new.title,
      'severity',        to_jsonb(new) ->> 'severity',
      'task_id',         new.promoted_task_id,
      'task_display_id', v_task.task_id,
      'task_title',      v_task.title,
      'snippet',         left(coalesce(new.description, ''), 140)
    ),
    tg_table_name, new.id);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_project_bug_promotion on public.bugs;
create trigger trg_enqueue_project_bug_promotion
  after update on public.bugs
  for each row
  when (old.promoted_task_id is null and new.promoted_task_id is not null)
  execute function public.enqueue_project_promotion_notification();

drop trigger if exists trg_enqueue_project_request_promotion on public.feature_requests;
create trigger trg_enqueue_project_request_promotion
  after update on public.feature_requests
  for each row
  when (old.promoted_task_id is null and new.promoted_task_id is not null)
  execute function public.enqueue_project_promotion_notification();

-- ── 9. Bell seen-flag: recipients update delivered_to_bell_at ─
-- 062 reserved this column; project events are its first consumer.
drop policy if exists "notif_outbox_update_self" on public.notification_outbox;
create policy "notif_outbox_update_self"
  on public.notification_outbox for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- RLS can't restrict WHICH columns an UPDATE touches — guard trigger does.
-- Service-role / trigger contexts (auth.uid() null) pass through untouched
-- so the digest's claimed_at / emailed_at writes keep working.
create or replace function public.guard_outbox_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and auth.uid() = old.recipient_id then
    if (new.recipient_id, new.event_type, new.payload, new.source_table,
        new.source_id,    new.created_at, new.emailed_at, new.claimed_at)
       is distinct from
       (old.recipient_id, old.event_type, old.payload, old.source_table,
        old.source_id,    old.created_at, old.emailed_at, old.claimed_at)
    then
      raise exception 'Only delivered_to_bell_at may be self-updated'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_outbox_self_update on public.notification_outbox;
create trigger trg_guard_outbox_self_update
  before update on public.notification_outbox
  for each row execute function public.guard_outbox_self_update();

-- ── 10. Index for the bell's unseen query ────────────────────
-- (recipient's unseen rows, newest first; partial keeps it tiny since
-- rows are stamped seen quickly and pruned at 30d by 082)
create index if not exists idx_outbox_bell_unseen
  on public.notification_outbox (recipient_id, created_at desc)
  where delivered_to_bell_at is null;
