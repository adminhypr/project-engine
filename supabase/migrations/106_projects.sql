-- ─────────────────────────────────────────────
-- 106 · Projects + explicit membership (Dev Board, part 1/3)
--
-- A "Project" is a new lightweight, member-scoped container for the
-- developer project board. Features are TASKS tagged with project_id
-- (added in 107) — projects never store the work themselves.
--
-- Visibility is EXPLICIT MEMBERSHIP (project_members), mirroring custom
-- hubs. That carries this codebase's #1 RLS hazard — self-referential
-- membership policies cause `42P17 infinite recursion` (the hub_members
-- saga: migrations 013/017/018/093/103). So from day one, every policy
-- that needs "is the caller a member/admin?" goes through a SECURITY
-- DEFINER helper that bypasses RLS — NO policy on project_members ever
-- sub-selects project_members inline.
-- ─────────────────────────────────────────────

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

-- ── SECURITY DEFINER helpers (bypass RLS → no recursion) ─────────
-- Same pattern as is_hub_member / hub_member_role (migration 017/093).
create or replace function public.is_project_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
     where project_id = p_project and profile_id = auth.uid()
  );
$$;

create or replace function public.is_project_admin(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members
     where project_id = p_project
       and profile_id = auth.uid()
       and role in ('owner', 'admin')
  );
$$;

-- Creator-self-insert guard helper (mirrors hub_has_members from 093).
create or replace function public.project_has_members(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.project_members where project_id = p_project);
$$;

revoke all on function public.is_project_member(uuid)  from public;
revoke all on function public.is_project_admin(uuid)   from public;
revoke all on function public.project_has_members(uuid) from public;
grant execute on function public.is_project_member(uuid)  to authenticated;
grant execute on function public.is_project_admin(uuid)   to authenticated;
grant execute on function public.project_has_members(uuid) to authenticated;

-- ── RLS: projects ───────────────────────────────────────────────
alter table public.projects enable row level security;

create policy "projects_select" on public.projects
  for select using (public.is_project_member(id));

-- Any internal (non-external) user can create a project; they become the
-- owner via create_project_with_owner. Block externals (Agent/Client),
-- mirroring the hubs INSERT gate (migration 041).
create policy "projects_insert" on public.projects
  for insert with check (
    created_by = auth.uid()
    and not public.is_external_user(auth.uid())
  );

create policy "projects_update" on public.projects
  for update using (public.is_project_admin(id)) with check (public.is_project_admin(id));

create policy "projects_delete" on public.projects
  for delete using (public.is_project_admin(id));

-- ── RLS: project_members (recursion-safe via helpers only) ──────
alter table public.project_members enable row level security;

create policy "project_members_select" on public.project_members
  for select using (public.is_project_member(project_id));

-- Admin of the project adds members; OR global Admin; OR self-insert as
-- owner only when the project has no members yet (creator path — also
-- covered by create_project_with_owner). Helpers bypass RLS → no cycle.
create policy "project_members_insert" on public.project_members
  for insert with check (
    public.is_project_admin(project_id)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
    or (
      project_members.profile_id = auth.uid()
      and project_members.role = 'owner'
      and not public.project_has_members(project_members.project_id)
    )
  );

create policy "project_members_update" on public.project_members
  for update using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

create policy "project_members_delete" on public.project_members
  for delete using (public.is_project_admin(project_id));

-- ── Last-owner guard (mirrors migration 094's hub last-owner guard) ─
-- Prevent removing or demoting the final owner, which would orphan the
-- project (no one could manage it). Fires on DELETE and on role-change
-- UPDATEs away from 'owner'.
create or replace function public.guard_project_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners int;
begin
  -- Only relevant when an OWNER row is leaving the owner set.
  if tg_op = 'DELETE' then
    if old.role <> 'owner' then return old; end if;
  elsif tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then return new; end if;
  end if;

  select count(*) into remaining_owners
    from public.project_members
   where project_id = old.project_id
     and role = 'owner'
     and profile_id <> old.profile_id;

  if remaining_owners = 0 then
    raise exception 'guard_project_last_owner: a project must keep at least one owner'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger guard_project_last_owner_trg
  before update or delete on public.project_members
  for each row execute function public.guard_project_last_owner();

-- ── Atomic project creation + owner row (mirrors create_hub_with_owner) ─
create or replace function public.create_project_with_owner(
  p_name        text,
  p_description text default null
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
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
  values (new_project.id, caller, 'owner')
  on conflict do nothing;

  return new_project;
end;
$$;

revoke all on function public.create_project_with_owner(text, text) from public;
grant execute on function public.create_project_with_owner(text, text) to authenticated;
