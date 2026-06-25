-- ============================================================
-- Project Dev Board migrations 106 + 107 + 108 (combined, re-run-safe)
-- Paste this ENTIRE file into the Supabase SQL Editor and Run once.
-- Every statement is idempotent (if not exists / or replace / drop if exists),
-- so re-running is safe. Plain ASCII only.
-- ============================================================


-- =================== 106: projects + membership ===================

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      text not null default 'Active'
              check (status in ('Active', 'On Hold', 'Completed', 'Archived')),
  target_date date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);

create index if not exists project_members_profile_idx on public.project_members(profile_id);

create or replace function public.is_project_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p_project and profile_id = auth.uid());
$$;

create or replace function public.is_project_admin(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p_project and profile_id = auth.uid() and role in ('owner','admin'));
$$;

create or replace function public.project_has_members(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p_project);
$$;

revoke all on function public.is_project_member(uuid)  from public;
revoke all on function public.is_project_admin(uuid)   from public;
revoke all on function public.project_has_members(uuid) from public;
grant execute on function public.is_project_member(uuid)  to authenticated;
grant execute on function public.is_project_admin(uuid)   to authenticated;
grant execute on function public.project_has_members(uuid) to authenticated;

alter table public.projects enable row level security;
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select using (public.is_project_member(id));
drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects for insert with check (created_by = auth.uid() and not public.is_external_user(auth.uid()));
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update using (public.is_project_admin(id)) with check (public.is_project_admin(id));
drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects for delete using (public.is_project_admin(id));

alter table public.project_members enable row level security;
drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select" on public.project_members for select using (public.is_project_member(project_id));
drop policy if exists "project_members_insert" on public.project_members;
create policy "project_members_insert" on public.project_members for insert with check (
  public.is_project_admin(project_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  or (project_members.profile_id = auth.uid() and project_members.role = 'owner' and not public.project_has_members(project_members.project_id))
);
drop policy if exists "project_members_update" on public.project_members;
create policy "project_members_update" on public.project_members for update using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));
drop policy if exists "project_members_delete" on public.project_members;
create policy "project_members_delete" on public.project_members for delete using (public.is_project_admin(project_id));

create or replace function public.guard_project_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  remaining_owners int;
begin
  if tg_op = 'DELETE' then
    if old.role <> 'owner' then return old; end if;
  elsif tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then return new; end if;
  end if;
  select count(*) into remaining_owners from public.project_members
   where project_id = old.project_id and role = 'owner' and profile_id <> old.profile_id;
  if remaining_owners = 0 then
    raise exception 'guard_project_last_owner: a project must keep at least one owner' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists guard_project_last_owner_trg on public.project_members;
create trigger guard_project_last_owner_trg
  before update or delete on public.project_members
  for each row execute function public.guard_project_last_owner();

create or replace function public.create_project_with_owner(p_name text, p_description text default null)
returns public.projects language plpgsql security definer set search_path = public as $$
declare
  caller      uuid := auth.uid();
  new_project public.projects%rowtype;
begin
  if caller is null then
    raise exception 'create_project_with_owner: not authenticated' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'create_project_with_owner: name required' using errcode = '22023';
  end if;
  if public.is_external_user(caller) then
    raise exception 'create_project_with_owner: external users cannot create projects' using errcode = '42501';
  end if;
  insert into public.projects (name, description, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), caller)
  returning * into new_project;
  insert into public.project_members (project_id, profile_id, role)
  values (new_project.id, caller, 'owner') on conflict do nothing;
  return new_project;
end;
$$;

revoke all on function public.create_project_with_owner(text, text) from public;
grant execute on function public.create_project_with_owner(text, text) to authenticated;


-- =================== 107: columns + requests + tasks cols ===================

create table if not exists public.project_columns (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  name           text not null,
  color          text,
  pos            double precision not null default 1000,
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

alter table public.tasks
  add column if not exists project_id        uuid references public.projects(id) on delete set null,
  add column if not exists project_column_id uuid references public.project_columns(id) on delete set null,
  add column if not exists project_pos       double precision;
create index if not exists tasks_project_idx on public.tasks(project_id);

alter table public.project_columns enable row level security;
drop policy if exists "project_columns_select" on public.project_columns;
create policy "project_columns_select" on public.project_columns for select using (public.is_project_member(project_id));
drop policy if exists "project_columns_insert" on public.project_columns;
create policy "project_columns_insert" on public.project_columns for insert with check (public.is_project_admin(project_id));
drop policy if exists "project_columns_update" on public.project_columns;
create policy "project_columns_update" on public.project_columns for update using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));
drop policy if exists "project_columns_delete" on public.project_columns;
create policy "project_columns_delete" on public.project_columns for delete using (public.is_project_admin(project_id));

alter table public.feature_requests enable row level security;
drop policy if exists "feature_requests_select" on public.feature_requests;
create policy "feature_requests_select" on public.feature_requests for select using (public.is_project_member(project_id));
drop policy if exists "feature_requests_insert" on public.feature_requests;
create policy "feature_requests_insert" on public.feature_requests for insert with check (public.is_project_member(project_id) and requester_id = auth.uid());
drop policy if exists "feature_requests_update" on public.feature_requests;
create policy "feature_requests_update" on public.feature_requests for update using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
drop policy if exists "feature_requests_delete" on public.feature_requests;
create policy "feature_requests_delete" on public.feature_requests for delete using (public.is_project_member(project_id));

create or replace function public.guard_feature_request_promotion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.promoted_task_id is not null then
    if not exists (select 1 from public.tasks where id = new.promoted_task_id and project_id = new.project_id) then
      raise exception 'feature_requests: promoted_task_id must reference a task in this project' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_feature_request_promotion_trg on public.feature_requests;
create trigger guard_feature_request_promotion_trg
  before insert or update on public.feature_requests
  for each row execute function public.guard_feature_request_promotion();


-- =================== 108: tasks visibility + move RPC ===================

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks for select using (
  not public.is_external_user(auth.uid())
  and (
    tasks.assigned_to = auth.uid()
    or tasks.assigned_by = auth.uid()
    or exists (select 1 from public.task_assignees ta where ta.task_id = tasks.id and ta.profile_id = auth.uid())
    or (tasks.project_id is not null and public.is_project_member(tasks.project_id))
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (
           p.role = 'Admin'
           or exists (select 1 from public.profile_teams pt where pt.profile_id = auth.uid() and pt.team_id = tasks.team_id and pt.role = 'Manager')
           or (p.role in ('Manager','Admin') and exists (select 1 from public.profiles assignee where assignee.id = tasks.assigned_to and assignee.reports_to = auth.uid()))
         )
    )
  )
);

create or replace function public.move_feature(p_task uuid, p_column uuid, p_pos double precision)
returns void language plpgsql security definer set search_path = public as $$
declare
  caller        uuid := auth.uid();
  v_project_id  uuid;
  v_col_project uuid;
  v_maps_status text;
begin
  if caller is null then
    raise exception 'move_feature: not authenticated' using errcode = '42501';
  end if;
  select project_id into v_project_id from public.tasks where id = p_task;
  if v_project_id is null then
    raise exception 'move_feature: task % is not a project feature', p_task using errcode = '22023';
  end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'move_feature: not a member of this project' using errcode = '42501';
  end if;
  select project_id, maps_to_status into v_col_project, v_maps_status from public.project_columns where id = p_column;
  if v_col_project is null or v_col_project <> v_project_id then
    raise exception 'move_feature: column does not belong to the project' using errcode = '22023';
  end if;
  if v_maps_status is not null then
    update public.tasks set project_column_id = p_column, project_pos = p_pos, status = v_maps_status where id = p_task;
  else
    update public.tasks set project_column_id = p_column, project_pos = p_pos where id = p_task;
  end if;
end;
$$;

revoke all on function public.move_feature(uuid, uuid, double precision) from public;
grant execute on function public.move_feature(uuid, uuid, double precision) to authenticated;

-- ============================================================
-- Done. Expect "Success. No rows returned."
-- ============================================================
