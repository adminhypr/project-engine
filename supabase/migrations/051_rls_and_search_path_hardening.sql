-- ============================================================
-- Migration 051: tasks UPDATE WITH CHECK + search_path hardening
--
-- Part A (H-2):
--   The "Task update by role" policy from migration 011 has USING
--   but no WITH CHECK, so secondary assignees (rows in
--   task_assignees) can rewrite any column — title, team_id,
--   assigned_to, urgency, etc. We:
--     1. Recreate the policy with WITH CHECK mirroring USING so
--        post-update state still matches the policy.
--     2. Add a BEFORE UPDATE guard trigger that restricts
--        non-owner writers (anyone who isn't the assigner, primary
--        assignee, Admin, or a Manager of the task's team) to the
--        workflow columns only.
--
-- Part B (Medium #15):
--   Batch-add `set search_path = public` to every SECURITY DEFINER
--   function declared in migrations 001, 002, 003, 012, 013, 014,
--   016, 017, 022, 023, and 036 that was missing it. This closes
--   the latent search_path-hijack hardening gap (documented by
--   Supabase security advisor). Function bodies are preserved
--   verbatim from the source migrations — no behavior changes.
-- ============================================================


-- ─────────────────────────────────────────────
-- Part A — H-2: tasks UPDATE WITH CHECK + guard trigger
-- ─────────────────────────────────────────────

drop policy if exists "Task update by role" on public.tasks;
create policy "Task update by role"
  on public.tasks for update
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.task_assignees ta
      where ta.task_id = tasks.id and ta.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or exists (
          select 1 from public.profile_teams pt
          where pt.profile_id = auth.uid()
          and pt.team_id = tasks.team_id
          and pt.role = 'Manager'
        )
      )
    )
  )
  with check (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.task_assignees ta
      where ta.task_id = tasks.id and ta.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or exists (
          select 1 from public.profile_teams pt
          where pt.profile_id = auth.uid()
          and pt.team_id = tasks.team_id
          and pt.role = 'Manager'
        )
      )
    )
  );

-- BEFORE UPDATE guard trigger: non-owners (secondary assignees,
-- non-admin, non-manager) can only change workflow columns.
create or replace function public.guard_task_non_owner_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  is_admin_caller boolean;
  is_manager_on_team boolean;
  is_assigner boolean;
  is_primary_assignee boolean;
begin
  -- Service role / trigger context bypass.
  if caller is null then return new; end if;

  select (role = 'Admin') into is_admin_caller
    from public.profiles where id = caller;
  if coalesce(is_admin_caller, false) then return new; end if;

  is_assigner := (new.assigned_by = caller);
  is_primary_assignee := (new.assigned_to = caller);

  select exists(
    select 1 from public.profile_teams
     where profile_id = caller
       and team_id = new.team_id
       and role = 'Manager'
  ) into is_manager_on_team;

  if is_assigner or is_primary_assignee or is_manager_on_team then
    return new;
  end if;

  -- Secondary assignee (reached via task_assignees only).
  -- They can only change workflow columns.
  if new.title          is distinct from old.title
  or new.team_id        is distinct from old.team_id
  or new.assigned_to    is distinct from old.assigned_to
  or new.assigned_by    is distinct from old.assigned_by
  or new.urgency        is distinct from old.urgency
  or new.due_date       is distinct from old.due_date
  or new.who_due_to     is distinct from old.who_due_to
  or new.icon           is distinct from old.icon
  or new.assignment_type is distinct from old.assignment_type
  then
    raise exception 'Only the assigner, primary assignee, Admin, or team Manager can change these fields';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_task_non_owner_update on public.tasks;
create trigger trg_guard_task_non_owner_update
  before update on public.tasks
  for each row execute function public.guard_task_non_owner_update();


-- ─────────────────────────────────────────────
-- Part B — Medium #15: search_path hardening
-- Each function is recreated with the body verbatim from its
-- source migration, plus `set search_path = public`.
-- ─────────────────────────────────────────────


-- ── 001: handle_new_user ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;


-- ── 002: audit_task_created ──
create or replace function public.audit_task_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_audit_log (task_id, event_type, performed_by, new_value, note)
  values (
    new.id,
    'task_created',
    new.assigned_by,
    new.status,
    'Task "' || left(new.title, 80) || '" assigned to ' || (select full_name from public.profiles where id = new.assigned_to)
  );
  return new;
end;
$$;


-- ── 012 (latest): audit_task_updated ──
create or replace function public.audit_task_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
begin
  if new.status is distinct from old.status then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'status_changed', _uid, old.status, new.status);
  end if;

  if new.urgency is distinct from old.urgency then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'urgency_changed', _uid, old.urgency, new.urgency);
  end if;

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

  if new.notes is distinct from old.notes then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'notes_updated', _uid, left(coalesce(old.notes, ''), 100), left(coalesce(new.notes, ''), 100));
  end if;

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
$$;


-- ── 003: set_acceptance_on_create ──
create or replace function public.set_acceptance_on_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignment_type in ('Superior', 'Self') then
    new.acceptance_status = 'Accepted';
    new.accepted_at = now();
  else
    new.acceptance_status = 'Pending';
  end if;
  return new;
end;
$$;


-- ── 036 (latest): audit_acceptance_change ──
create or replace function public.audit_acceptance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auto-accept when the assignee moves the task forward while Pending.
  if old.acceptance_status = 'Pending'
     and new.acceptance_status = 'Pending'
     and new.status in ('In Progress','Done')
     and (old.status is distinct from new.status) then
    new.acceptance_status := 'Accepted';
    new.accepted_at := now();
  end if;

  -- Accepted transition (manual or auto-accept).
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

  -- Declined transition.
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

  -- Reassignment from a declined state resets acceptance.
  if new.assigned_to is distinct from old.assigned_to
     and old.acceptance_status = 'Declined' then
    new.acceptance_status := 'Pending';
    new.decline_reason := null;
    new.accepted_at := null;
    new.declined_at := null;
  end if;

  return new;
end;
$$;


-- ── 013: user_has_teams, is_manager_on_team ──
create or replace function public.user_has_teams(p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profile_teams
    where profile_id = p_profile_id
  );
$$;

create or replace function public.is_manager_on_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profile_teams
    where profile_id = auth.uid()
    and team_id = p_team_id
    and role = 'Manager'
  );
$$;


-- ── 017: is_hub_member, hub_member_role ──
create or replace function public.is_hub_member(p_hub_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.hub_members
    where hub_id = p_hub_id and profile_id = auth.uid()
  );
$$;

create or replace function public.hub_member_role(p_hub_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.hub_members
  where hub_id = p_hub_id and profile_id = auth.uid()
  limit 1;
$$;


-- ── 016 (latest): hub_activity_on_message ──
create or replace function public.hub_activity_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
begin
  select full_name into actor_name from public.profiles where id = new.author_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
    new.hub_id,
    new.author_id,
    case when new.parent_id is null then 'message_posted' else 'message_reply' end,
    'message',
    new.id,
    case when new.parent_id is null
      then coalesce(actor_name, 'Someone') || ' posted: ' || left(coalesce(new.title, new.content), 80)
      else coalesce(actor_name, 'Someone') || ' replied to a message'
    end
  );
  return new;
end;
$$;


-- ── 016 (latest): hub_activity_on_check_in ──
create or replace function public.hub_activity_on_check_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  prompt_team uuid;
  prompt_hub uuid;
  prompt_question text;
begin
  select full_name into actor_name from public.profiles where id = new.author_id;
  select team_id, hub_id, question into prompt_team, prompt_hub, prompt_question
    from public.hub_check_in_prompts where id = new.prompt_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    prompt_team,
    prompt_hub,
    new.author_id,
    'check_in_response',
    'check_in',
    new.id,
    coalesce(actor_name, 'Someone') || ' answered: ' || left(prompt_question, 60)
  );
  return new;
end;
$$;


-- ── 016 (latest): hub_activity_on_event ──
create or replace function public.hub_activity_on_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
begin
  select full_name into actor_name from public.profiles where id = new.created_by;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
    new.hub_id,
    new.created_by,
    'event_created',
    'event',
    new.id,
    coalesce(actor_name, 'Someone') || ' added event: ' || left(new.title, 80)
  );
  return new;
end;
$$;


-- ── 016 (latest): hub_activity_on_chat ──
create or replace function public.hub_activity_on_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  recent_count int;
begin
  select count(*) into recent_count from public.hub_activity
  where hub_id = new.hub_id
    and actor_id = new.author_id
    and event_type = 'chat_message'
    and created_at > now() - interval '5 minutes';
  if recent_count > 0 then return new; end if;

  select full_name into actor_name from public.profiles where id = new.author_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
    new.hub_id,
    new.author_id,
    'chat_message',
    'chat',
    new.id,
    coalesce(actor_name, 'Someone') || ' is chatting in Campfire'
  );
  return new;
end;
$$;


-- ── 022: hub_activity_on_todo ──
create or replace function public.hub_activity_on_todo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  hub_team uuid;
begin
  select full_name into actor_name from public.profiles where id = new.created_by;
  select team_id into hub_team from public.hubs where id = new.hub_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    hub_team, new.hub_id, new.created_by,
    'todo_added', 'todo', new.id,
    coalesce(actor_name, 'Someone') || ' added a to-do: ' || left(new.title, 80)
  );
  return new;
end;
$$;


-- ── 023: hub_todo_item_auto_subscribe_creator ──
create or replace function public.hub_todo_item_auto_subscribe_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.hub_todo_item_subscribers (item_id, profile_id)
  values (new.id, new.created_by)
  on conflict (item_id, profile_id) do nothing;
  return new;
end;
$$;


-- ── 023: hub_todo_assignee_auto_subscribe ──
create or replace function public.hub_todo_assignee_auto_subscribe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.hub_todo_item_subscribers (item_id, profile_id)
  values (new.item_id, new.profile_id)
  on conflict (item_id, profile_id) do nothing;
  return new;
end;
$$;


-- ── 023: hub_todo_comment_auto_subscribe ──
create or replace function public.hub_todo_comment_auto_subscribe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.hub_todo_item_subscribers (item_id, profile_id)
  values (new.item_id, new.created_by)
  on conflict (item_id, profile_id) do nothing;
  return new;
end;
$$;


-- ── 023: hub_activity_on_todo_completed ──
create or replace function public.hub_activity_on_todo_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  hub_team uuid;
begin
  if (old.completed = false and new.completed = true) then
    select full_name into actor_name from public.profiles where id = new.completed_by;
    select team_id into hub_team from public.hubs where id = new.hub_id;
    insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
    values (
      hub_team, new.hub_id, new.completed_by,
      'todo_item_completed', 'todo', new.id,
      coalesce(actor_name, 'Someone') || ' completed a to-do: ' || left(new.title, 80)
    );
  end if;
  return new;
end;
$$;


-- ── 023: hub_activity_on_todo_list_created ──
create or replace function public.hub_activity_on_todo_list_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  hub_team uuid;
begin
  select full_name into actor_name from public.profiles where id = new.created_by;
  select team_id into hub_team from public.hubs where id = new.hub_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    hub_team, new.hub_id, new.created_by,
    'todo_list_created', 'todo_list', new.id,
    coalesce(actor_name, 'Someone') || ' started a list: ' || left(new.title, 80)
  );
  return new;
end;
$$;


-- ── 023: hub_activity_on_todo_assigned ──
create or replace function public.hub_activity_on_todo_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigner_name text;
  assignee_name text;
  item_title text;
  hub_id_v uuid;
  hub_team uuid;
begin
  select title, hub_id into item_title, hub_id_v from public.hub_todo_items where id = new.item_id;
  select full_name into assigner_name from public.profiles where id = auth.uid();
  select full_name into assignee_name from public.profiles where id = new.profile_id;
  select team_id into hub_team from public.hubs where id = hub_id_v;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    hub_team, hub_id_v, auth.uid(),
    'todo_item_assigned', 'todo', new.item_id,
    coalesce(assigner_name, 'Someone') || ' assigned ' || coalesce(assignee_name, 'someone') ||
      ' to ' || left(coalesce(item_title, 'a to-do'), 60)
  );
  return new;
end;
$$;
