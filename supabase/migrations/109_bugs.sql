-- ─────────────────────────────────────────────
-- 109 · Bug lane (Dev Board, part 4)
--
-- bugs = a lightweight, promotable bug report per project, mirroring
-- feature_requests (107). A bug is NOT a task — it lives on the Bugs lane
-- until Promoted, at which point the frontend's assignTask flow creates a
-- normal project-tagged fix task (urgency from severity, icon 🐛) and links
-- it via promoted_task_id.
--
-- Statuses: Reported · Confirmed · Won't Fix · Promoted (terminal = last two).
-- Any project member files AND triages (same as feature_requests).
-- Recursion-safe: gated by is_project_member() SECURITY DEFINER helper (106),
-- so no policy on `bugs` ever sub-selects project_members.
-- ─────────────────────────────────────────────

create table if not exists public.bugs (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  title            text not null,
  description      text,
  reporter_id      uuid references public.profiles(id) on delete set null,
  severity         text not null default 'Medium'
                   check (severity in ('Critical', 'High', 'Medium', 'Low')),
  status           text not null default 'Reported'
                   check (status in ('Reported', 'Confirmed', 'Won''t Fix', 'Promoted')),
  promoted_task_id uuid references public.tasks(id) on delete set null,
  pos              double precision not null default 1000,
  created_at       timestamptz not null default now()
);

create index if not exists bugs_project_idx on public.bugs(project_id);

-- ── RLS: any member files + triages (mirrors feature_requests) ──
alter table public.bugs enable row level security;

drop policy if exists "bugs_select" on public.bugs;
create policy "bugs_select" on public.bugs
  for select using (public.is_project_member(project_id));

drop policy if exists "bugs_insert" on public.bugs;
create policy "bugs_insert" on public.bugs
  for insert with check (
    public.is_project_member(project_id)
    and reporter_id = auth.uid()
  );

drop policy if exists "bugs_update" on public.bugs;
create policy "bugs_update" on public.bugs
  for update using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

drop policy if exists "bugs_delete" on public.bugs;
create policy "bugs_delete" on public.bugs
  for delete using (public.is_project_member(project_id));

-- Integrity guard: bugs_update lets any member edit the row, so require that a
-- promoted_task_id references a task in THIS project (the promote flow always
-- sets it to the freshly-created fix task, so this is transparent for the happy
-- path and only blocks spoofed/foreign links). Mirrors 107's request guard.
create or replace function public.guard_bug_promotion()
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
      raise exception 'bugs: promoted_task_id must reference a task in this project'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_bug_promotion_trg on public.bugs;
create trigger guard_bug_promotion_trg
  before insert or update on public.bugs
  for each row execute function public.guard_bug_promotion();
