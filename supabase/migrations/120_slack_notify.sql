-- ============================================================
-- 120: Slack notifications for Dev Projects board activity
--
-- Mirrors migration 119's six event shapes, but instead of fanning out
-- to notification_outbox, each event fires ONE async net.http_post to
-- the slack-notify edge function, which enriches + formats + posts to
-- a Slack Incoming Webhook (group chat chosen by the team).
--
-- PURELY ADDITIVE: brand-new trigger functions and triggers only —
-- 119's functions/triggers/policies are untouched (per the
-- read-live-bodies gotcha, we never recreate an existing function).
--
-- Auth follows the 096 pattern: Authorization is a constant
-- header-presence placeholder ('Bearer cron'); the real auth is
-- X-Webhook-Secret sourced from Vault ('webhook_shared_secret').
--
-- Payload shape (thin — the edge function does all name lookups):
--   { event, record: to_jsonb(NEW), old?: {…}, actor: auth.uid() }
--
-- Failure model: _slack_post swallows every exception (missing vault
-- row, pg_net absent) — a Slack outage must NEVER fail the user's
-- board action. pg_net is already async, so no latency is added.
--
-- Deploy ordering (like 081): deploy the slack-notify function with
-- SLACK_WEBHOOK_URL + WEBHOOK_SHARED_SECRET secrets set BEFORE
-- applying this migration, or events will 401/500 (harmlessly —
-- board actions are unaffected, the posts are just lost).
-- ============================================================

-- ── 1. Shared poster ─────────────────────────────────────────
create or replace function public._slack_post(p_event text, p_body jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/slack-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer cron',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_shared_secret' limit 1)
    ),
    body    := p_body || jsonb_build_object('event', p_event),
    timeout_milliseconds := 15000
  );
exception when others then
  raise warning 'slack _slack_post(%) failed: %', p_event, sqlerrm;
end;
$$;

revoke all on function public._slack_post(text, jsonb) from public, anon, authenticated;

-- ── 2. Feature (project task) created ────────────────────────
create or replace function public.slack_project_feature_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._slack_post('feature_created', jsonb_build_object(
    'record', to_jsonb(new),
    'actor',  coalesce(auth.uid(), new.assigned_by)
  ));
  return new;
end;
$$;

drop trigger if exists trg_slack_project_feature_created on public.tasks;
create trigger trg_slack_project_feature_created
  after insert on public.tasks
  for each row
  when (new.project_id is not null)
  execute function public.slack_project_feature_created();

-- ── 3. Feature moved (status or column changed) ──────────────
create or replace function public.slack_project_feature_moved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._slack_post('feature_moved', jsonb_build_object(
    'record', to_jsonb(new),
    'old',    jsonb_build_object('status', old.status, 'project_column_id', old.project_column_id),
    'actor',  auth.uid()
  ));
  return new;
end;
$$;

drop trigger if exists trg_slack_project_feature_moved on public.tasks;
create trigger trg_slack_project_feature_moved
  after update on public.tasks
  for each row
  when (new.project_id is not null
        and (old.status is distinct from new.status
             or old.project_column_id is distinct from new.project_column_id))
  execute function public.slack_project_feature_moved();

-- ── 4. Bug reported ──────────────────────────────────────────
create or replace function public.slack_project_bug_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._slack_post('bug_reported', jsonb_build_object(
    'record', to_jsonb(new),
    'actor',  coalesce(auth.uid(), new.reporter_id)
  ));
  return new;
end;
$$;

drop trigger if exists trg_slack_project_bug_reported on public.bugs;
create trigger trg_slack_project_bug_reported
  after insert on public.bugs
  for each row execute function public.slack_project_bug_reported();

-- ── 5. Feature request created ───────────────────────────────
create or replace function public.slack_project_request_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._slack_post('request_created', jsonb_build_object(
    'record', to_jsonb(new),
    'actor',  coalesce(auth.uid(), new.requester_id)
  ));
  return new;
end;
$$;

drop trigger if exists trg_slack_project_request_created on public.feature_requests;
create trigger trg_slack_project_request_created
  after insert on public.feature_requests
  for each row execute function public.slack_project_request_created();

-- ── 6. Bug / request promoted ────────────────────────────────
-- One function serves both tables. The edge function tells bug from
-- request by the presence of `severity` in old (to_jsonb pattern, 119).
create or replace function public.slack_project_promotion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._slack_post('promotion', jsonb_build_object(
    'record', to_jsonb(new),
    'old',    jsonb_build_object('severity', to_jsonb(old) ->> 'severity'),
    'actor',  auth.uid()
  ));
  return new;
end;
$$;

drop trigger if exists trg_slack_project_bug_promotion on public.bugs;
create trigger trg_slack_project_bug_promotion
  after update on public.bugs
  for each row
  when (old.promoted_task_id is null and new.promoted_task_id is not null)
  execute function public.slack_project_promotion();

drop trigger if exists trg_slack_project_request_promotion on public.feature_requests;
create trigger trg_slack_project_request_promotion
  after update on public.feature_requests
  for each row
  when (old.promoted_task_id is null and new.promoted_task_id is not null)
  execute function public.slack_project_promotion();

-- ── 7. Comment on a project feature ──────────────────────────
-- WHEN can't join to tasks, so the project check happens in the edge
-- function (it resolves the parent task anyway). To avoid an HTTP call
-- for every org-wide task comment, pre-check project membership here.
create or replace function public.slack_project_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.tasks where id = new.task_id;
  if v_project is null then return new; end if;

  perform public._slack_post('comment', jsonb_build_object(
    'record', to_jsonb(new),
    'actor',  coalesce(auth.uid(), new.author_id)
  ));
  return new;
end;
$$;

drop trigger if exists trg_slack_project_comment on public.comments;
create trigger trg_slack_project_comment
  after insert on public.comments
  for each row
  when (new.task_id is not null)
  execute function public.slack_project_comment();
