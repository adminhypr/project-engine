-- ============================================================
-- Project Engine — Initial Database Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- TEAMS
-- ─────────────────────────────────────────────
create table public.teams (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null unique,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- PROFILES
-- Extends Supabase auth.users
-- Auto-created on first Google login via trigger
-- ─────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  avatar_url  text,
  team_id     uuid references public.teams(id) on delete set null,
  role        text not null default 'Staff' check (role in ('Staff','Manager','Admin')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
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
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────
-- TASKS
-- ─────────────────────────────────────────────
create table public.tasks (
  id                uuid primary key default uuid_generate_v4(),
  task_id           text not null unique,           -- Human readable e.g. T-A1B2C3
  assigned_to       uuid not null references public.profiles(id) on delete cascade,
  assigned_by       uuid not null references public.profiles(id) on delete cascade,
  assignment_type   text not null default 'Superior'
                    check (assignment_type in ('Superior','Peer','CrossTeam','Upward','Self','Unknown')),
  team_id           uuid references public.teams(id) on delete set null,
  title             text not null,
  urgency           text not null default 'Med'
                    check (urgency in ('Low','Med','High')),
  due_date          timestamptz,
  who_due_to        text,                           -- Client name, project etc
  date_assigned     timestamptz not null default now(),
  last_updated      timestamptz not null default now(),
  status            text not null default 'Not Started'
                    check (status in ('Not Started','In Progress','Blocked','Done')),
  notes             text,
  email_alert_sent  boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Auto-update last_updated on any change
create or replace function public.update_last_updated()
returns trigger as $$
begin
  new.last_updated = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_last_updated
  before update on public.tasks
  for each row execute procedure public.update_last_updated();

-- Reset email_alert_sent when status changes (re-arms alert)
create or replace function public.reset_email_alert_on_status_change()
returns trigger as $$
begin
  if new.status <> old.status then
    new.email_alert_sent = false;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tasks_reset_email_alert
  before update on public.tasks
  for each row execute procedure public.reset_email_alert_on_status_change();

-- ─────────────────────────────────────────────
-- COMMENTS
-- ─────────────────────────────────────────────
create table public.comments (
  id         uuid primary key default uuid_generate_v4(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.teams    enable row level security;
alter table public.tasks    enable row level security;
alter table public.comments enable row level security;

-- Profiles: users can read all profiles, edit only their own
-- Admins can update any profile (for role/team assignment)
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Admins can update any profile"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'Admin'
    )
  );

-- Teams: readable by all authenticated
create policy "Teams viewable by authenticated users"
  on public.teams for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage teams"
  on public.teams for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'Admin'
    )
  );

-- Tasks: Staff see own tasks + tasks they assigned
--        Managers see all tasks in their team
--        Admins see all tasks
create policy "Task visibility by role"
  on public.tasks for select
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or (p.role = 'Manager' and p.team_id = tasks.team_id)
      )
    )
  );

create policy "Anyone can create tasks"
  on public.tasks for insert
  with check (auth.role() = 'authenticated');

create policy "Task update by role"
  on public.tasks for update
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or (p.role = 'Manager' and p.team_id = tasks.team_id)
      )
    )
  );

-- Comments: same visibility as tasks
create policy "Comment visibility"
  on public.comments for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = comments.task_id
      and (
        t.assigned_to = auth.uid()
        or t.assigned_by = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
          and (
            p.role = 'Admin'
            or (p.role = 'Manager' and p.team_id = t.team_id)
          )
        )
      )
    )
  );

create policy "Authenticated users can post comments"
  on public.comments for insert
  with check (
    auth.role() = 'authenticated'
    and author_id = auth.uid()
  );

-- ─────────────────────────────────────────────
-- INDEXES (performance)
-- ─────────────────────────────────────────────
create index idx_tasks_assigned_to   on public.tasks(assigned_to);
create index idx_tasks_assigned_by   on public.tasks(assigned_by);
create index idx_tasks_team_id       on public.tasks(team_id);
create index idx_tasks_status        on public.tasks(status);
create index idx_tasks_due_date      on public.tasks(due_date);
create index idx_tasks_last_updated  on public.tasks(last_updated);
create index idx_tasks_date_assigned on public.tasks(date_assigned);
create index idx_comments_task_id    on public.comments(task_id);
create index idx_comments_author_id  on public.comments(author_id);
create index idx_profiles_team_id    on public.profiles(team_id);
create index idx_profiles_role       on public.profiles(role);

-- ─────────────────────────────────────────────
-- SEED DATA (optional — remove for production)
-- Creates sample teams to get started
-- ─────────────────────────────────────────────
insert into public.teams (name) values
  ('Sales'),
  ('Recruitment'),
  ('Operations'),
  ('Marketing'),
  ('Finance')
on conflict (name) do nothing;

-- ─────────────────────────────────────────────
-- REALTIME
-- Enable realtime on tasks and comments
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.comments;
