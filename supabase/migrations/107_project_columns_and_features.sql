-- ─────────────────────────────────────────────
-- 107 · Trello lists (project_columns), feature_requests backlog,
--        and the tasks.project_* link columns (Dev Board, part 2/3)
--
-- project_columns = the freeform Trello "lists" per project, fractional
-- `pos` ordering. A list may optionally map to a task status, so dropping
-- a card into it syncs tasks.status (the move_feature RPC in 108 does the
-- sync).
--
-- A "Feature" is a TASK tagged with project_id + project_column_id +
-- project_pos. These are nullable additive columns on tasks — they do NOT
-- change existing task behavior; a task with project_id = null is just a
-- normal task.
--
-- feature_requests = the lightweight, promotable backlog with its own
-- status workflow (distinct from task status).
-- ─────────────────────────────────────────────

create table if not exists public.project_columns (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  name           text not null,
  color          text,
  pos            double precision not null default 1000,   -- fractional ordering
  maps_to_status text check (maps_to_status in ('Not Started', 'In Progress', 'Blocked', 'Done')),
  created_at     timestamptz not null default now()
);

create index if not exists project_columns_project_idx on public.project_columns(project_id);

create table if not exists public.feature_requests (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  title            text not null,
  description      text,
  requester_id     uuid references public.profiles(id) on delete set null,
  status           text not null default 'Requested'
                   check (status in ('Requested', 'Under Review', 'Planned', 'Rejected', 'Promoted')),
  promoted_task_id uuid references public.tasks(id) on delete set null,
  pos              double precision not null default 1000,
  created_at       timestamptz not null default now()
);

create index if not exists feature_requests_project_idx on public.feature_requests(project_id);

-- ── tasks gains the project link (a Feature = a task with project_id) ──
alter table public.tasks
  add column if not exists project_id        uuid references public.projects(id) on delete set null,
  add column if not exists project_column_id uuid references public.project_columns(id) on delete set null,
  add column if not exists project_pos       double precision;

create index if not exists tasks_project_idx on public.tasks(project_id);

-- ── RLS: project_columns ────────────────────────────────────────
alter table public.project_columns enable row level security;

create policy "project_columns_select" on public.project_columns
  for select using (public.is_project_member(project_id));

create policy "project_columns_insert" on public.project_columns
  for insert with check (public.is_project_admin(project_id));

create policy "project_columns_update" on public.project_columns
  for update using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

create policy "project_columns_delete" on public.project_columns
  for delete using (public.is_project_admin(project_id));

-- ── RLS: feature_requests ───────────────────────────────────────
-- Any member can file and triage requests (lightweight backlog). The
-- promote action (108) is a SECURITY DEFINER RPC, so creating the Feature
-- task doesn't depend on the caller's task-insert grant here.
alter table public.feature_requests enable row level security;

create policy "feature_requests_select" on public.feature_requests
  for select using (public.is_project_member(project_id));

create policy "feature_requests_insert" on public.feature_requests
  for insert with check (
    public.is_project_member(project_id)
    and requester_id = auth.uid()
  );

create policy "feature_requests_update" on public.feature_requests
  for update using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

create policy "feature_requests_delete" on public.feature_requests
  for delete using (public.is_project_member(project_id));

-- Integrity guard: feature_requests_update lets any member edit the row, so a
-- member could otherwise point promoted_task_id at an arbitrary task. Require
-- it to reference a task that actually belongs to THIS project (the promote
-- flow always sets it to the freshly-created feature, so this is transparent
-- for the happy path and only blocks spoofed/foreign links).
create or replace function public.guard_feature_request_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.promoted_task_id is not null then
    if not exists (
      select 1 from public.tasks
       where id = new.promoted_task_id and project_id = new.project_id
    ) then
      raise exception 'feature_requests: promoted_task_id must reference a task in this project'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_feature_request_promotion_trg
  before insert or update on public.feature_requests
  for each row execute function public.guard_feature_request_promotion();
