-- ─────────────────────────────────────────────
-- 058 · Recurring tasks
--
-- Templates that spawn concrete tasks on a recurring schedule. The hourly
-- spawn-recurring-tasks edge function is the authoritative writer; this
-- migration sets up the schema, RLS, audit, and realtime publication.
--
-- Design contract (from 2026-04-23 design doc):
--  • Simple interval model: (unit ∈ day/week/month) × every N.
--  • anchor_at = first occurrence; next_run_at = upcoming spawn.
--  • Never backfill missed runs (advance next_run_at to next future).
--  • is_active=false freezes spawning entirely; on resume, next_run_at is
--    recomputed by the spawn function to the next future occurrence.
--  • If all assignees become invalid by spawn time: deactivate, audit,
--    notify creator. Don't spawn.
-- ─────────────────────────────────────────────

create table if not exists public.task_recurrences (
  id                          uuid primary key default gen_random_uuid(),
  template_title              text not null,
  template_notes              text,
  template_icon               text,
  template_urgency            text not null default 'Med'
                              check (template_urgency in ('Low','Med','High','Urgent')),
  template_due_offset_hours   int  not null default 24
                              check (template_due_offset_hours >= 0),
  team_id                     uuid references public.teams(id) on delete set null,
  interval_unit               text not null
                              check (interval_unit in ('day','week','month')),
  interval_every              int  not null default 1
                              check (interval_every >= 1),
  anchor_at                   timestamptz not null,
  next_run_at                 timestamptz not null,
  created_by                  uuid references public.profiles(id) on delete set null,
  is_active                   bool not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_task_recurrences_next_run_active
  on public.task_recurrences(next_run_at)
  where is_active = true;

create index if not exists idx_task_recurrences_created_by
  on public.task_recurrences(created_by);

create index if not exists idx_task_recurrences_team_id
  on public.task_recurrences(team_id) where team_id is not null;

-- updated_at auto-bump
create or replace function public.bump_task_recurrences_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bump_task_recurrences_updated_at on public.task_recurrences;
create trigger trg_bump_task_recurrences_updated_at
  before update on public.task_recurrences
  for each row execute function public.bump_task_recurrences_updated_at();

-- ─────────────────────────────────────────────
-- task_recurrence_assignees junction. Mirrors task_assignees shape.
-- ─────────────────────────────────────────────
create table if not exists public.task_recurrence_assignees (
  recurrence_id  uuid not null references public.task_recurrences(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  is_primary     bool not null default false,
  created_at     timestamptz not null default now(),
  primary key (recurrence_id, profile_id)
);

create index if not exists idx_task_recurrence_assignees_profile
  on public.task_recurrence_assignees(profile_id);

-- ─────────────────────────────────────────────
-- task_recurrence_audit — template-level events. Per-task spawn rows still
-- write to task_audit_log via the existing `task_created` event.
-- ─────────────────────────────────────────────
create table if not exists public.task_recurrence_audit (
  id              uuid primary key default gen_random_uuid(),
  recurrence_id   uuid not null references public.task_recurrences(id) on delete cascade,
  event_type      text not null check (event_type in (
    'created','edited','paused','resumed','spawned','spawn_failed_no_assignees','deleted'
  )),
  performed_by    uuid references public.profiles(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_task_recurrence_audit_recurrence
  on public.task_recurrence_audit(recurrence_id, created_at desc);

-- ─────────────────────────────────────────────
-- tasks.recurrence_id — link spawned tasks back to their template.
-- ─────────────────────────────────────────────
alter table public.tasks
  add column if not exists recurrence_id uuid
    references public.task_recurrences(id) on delete set null;

create index if not exists idx_tasks_recurrence_id
  on public.tasks(recurrence_id) where recurrence_id is not null;

-- ─────────────────────────────────────────────
-- Extend task_audit_log event_type CHECK.
-- ─────────────────────────────────────────────
alter table public.task_audit_log
  drop constraint if exists task_audit_log_event_type_check;
alter table public.task_audit_log
  add constraint task_audit_log_event_type_check
  check (event_type in (
    'task_created','status_changed','urgency_changed','due_date_changed',
    'notes_updated','reassigned','accepted','declined','assigner_override',
    'assignee_marked_done','assignee_unmarked','force_closed',
    'all_assignees_completed',
    'subtask_added','subtask_removed','parent_auto_closed_via_subtasks',
    'force_closed_with_open_subtasks',
    'dependency_added','dependency_removed',
    'recurring_spawned'
  )) not valid;

-- ─────────────────────────────────────────────
-- Audit trigger on task_recurrences itself: pause / resume / edited
-- ─────────────────────────────────────────────
create or replace function public.audit_task_recurrence_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
    values (new.id, 'created', new.created_by, new.template_title);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Pause / resume — emit a dedicated event when is_active toggles.
    if old.is_active is distinct from new.is_active then
      insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
      values (
        new.id,
        case when new.is_active then 'resumed' else 'paused' end,
        auth.uid(),
        null
      );
    end if;

    -- Other meaningful edits → single 'edited' row. We deliberately don't
    -- spam one row per column change.
    if old.template_title is distinct from new.template_title
       or old.template_notes is distinct from new.template_notes
       or old.template_icon is distinct from new.template_icon
       or old.template_urgency is distinct from new.template_urgency
       or old.template_due_offset_hours is distinct from new.template_due_offset_hours
       or old.team_id is distinct from new.team_id
       or old.interval_unit is distinct from new.interval_unit
       or old.interval_every is distinct from new.interval_every
       or old.anchor_at is distinct from new.anchor_at then
      insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
      values (new.id, 'edited', auth.uid(), null);
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
    values (old.id, 'deleted', auth.uid(), old.template_title);
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_audit_task_recurrence_change on public.task_recurrences;
create trigger trg_audit_task_recurrence_change
  after insert or update or delete on public.task_recurrences
  for each row execute function public.audit_task_recurrence_change();

-- ─────────────────────────────────────────────
-- RLS — task_recurrences
--
-- SELECT (broad — gives staff visibility into their own templates):
--   Admin · creator · manager-of-team_id · assignee-on-template
--
-- INSERT/UPDATE/DELETE (tight — externals blocked):
--   Admin · creator · manager-of-team_id  (and never an external user)
-- ─────────────────────────────────────────────
alter table public.task_recurrences enable row level security;

drop policy if exists "task_recurrences_select" on public.task_recurrences;
create policy "task_recurrences_select"
  on public.task_recurrences for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
    or created_by = auth.uid()
    or (team_id is not null and exists (
      select 1 from public.profile_teams
       where profile_id = auth.uid()
         and team_id = task_recurrences.team_id
         and role in ('Manager','TeamLeader')
    ))
    or exists (
      select 1 from public.task_recurrence_assignees
       where recurrence_id = task_recurrences.id
         and profile_id = auth.uid()
    )
  );

drop policy if exists "task_recurrences_insert" on public.task_recurrences;
create policy "task_recurrences_insert"
  on public.task_recurrences for insert
  with check (
    auth.uid() = created_by
    and not coalesce(public.is_external_user(auth.uid()), false)
    and (
      exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
      or (team_id is not null and exists (
        select 1 from public.profile_teams
         where profile_id = auth.uid()
           and team_id = task_recurrences.team_id
           and role in ('Manager','TeamLeader')
      ))
      -- Staff can create a template for themselves (no team gating). The
      -- assignee-side junction insert is what enforces who actually gets it.
      or team_id is null
    )
  );

drop policy if exists "task_recurrences_update" on public.task_recurrences;
create policy "task_recurrences_update"
  on public.task_recurrences for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
    or created_by = auth.uid()
    or (team_id is not null and exists (
      select 1 from public.profile_teams
       where profile_id = auth.uid()
         and team_id = task_recurrences.team_id
         and role in ('Manager','TeamLeader')
    ))
  )
  with check (
    not coalesce(public.is_external_user(auth.uid()), false)
    and (
      exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
      or created_by = auth.uid()
      or (team_id is not null and exists (
        select 1 from public.profile_teams
         where profile_id = auth.uid()
           and team_id = task_recurrences.team_id
           and role in ('Manager','TeamLeader')
      ))
    )
  );

drop policy if exists "task_recurrences_delete" on public.task_recurrences;
create policy "task_recurrences_delete"
  on public.task_recurrences for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
    or created_by = auth.uid()
    or (team_id is not null and exists (
      select 1 from public.profile_teams
       where profile_id = auth.uid()
         and team_id = task_recurrences.team_id
         and role in ('Manager','TeamLeader')
    ))
  );

-- ─────────────────────────────────────────────
-- RLS — task_recurrence_assignees (inherits from parent visibility)
-- ─────────────────────────────────────────────
alter table public.task_recurrence_assignees enable row level security;

drop policy if exists "task_recurrence_assignees_select" on public.task_recurrence_assignees;
create policy "task_recurrence_assignees_select"
  on public.task_recurrence_assignees for select
  using (
    exists (select 1 from public.task_recurrences r where r.id = recurrence_id)
  );

drop policy if exists "task_recurrence_assignees_insert" on public.task_recurrence_assignees;
create policy "task_recurrence_assignees_insert"
  on public.task_recurrence_assignees for insert
  with check (
    exists (
      select 1 from public.task_recurrences r
       where r.id = recurrence_id
         and (
           exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
           or r.created_by = auth.uid()
           or (r.team_id is not null and exists (
             select 1 from public.profile_teams
              where profile_id = auth.uid()
                and team_id = r.team_id
                and role in ('Manager','TeamLeader')
           ))
         )
    )
  );

drop policy if exists "task_recurrence_assignees_delete" on public.task_recurrence_assignees;
create policy "task_recurrence_assignees_delete"
  on public.task_recurrence_assignees for delete
  using (
    exists (
      select 1 from public.task_recurrences r
       where r.id = recurrence_id
         and (
           exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
           or r.created_by = auth.uid()
           or (r.team_id is not null and exists (
             select 1 from public.profile_teams
              where profile_id = auth.uid()
                and team_id = r.team_id
                and role in ('Manager','TeamLeader')
           ))
         )
    )
  );

-- ─────────────────────────────────────────────
-- RLS — task_recurrence_audit (read-only for callers; writes via triggers
-- and the spawn edge function only)
-- ─────────────────────────────────────────────
alter table public.task_recurrence_audit enable row level security;

drop policy if exists "task_recurrence_audit_select" on public.task_recurrence_audit;
create policy "task_recurrence_audit_select"
  on public.task_recurrence_audit for select
  using (
    exists (select 1 from public.task_recurrences r where r.id = recurrence_id)
  );

-- No insert/update/delete policies — only triggers and service-role can write.

-- ─────────────────────────────────────────────
-- Realtime
-- ─────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'task_recurrences'
  ) then
    alter publication supabase_realtime add table public.task_recurrences;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'task_recurrence_assignees'
  ) then
    alter publication supabase_realtime add table public.task_recurrence_assignees;
  end if;
end $$;

-- ─────────────────────────────────────────────
-- Helper: compute the next future next_run_at given anchor + interval +
-- now. Used by the spawn function and surfaced as an RPC for the UI to
-- preview "Next spawn: ___" in the template form.
-- ─────────────────────────────────────────────
create or replace function public.compute_next_recurrence_run(
  p_anchor_at timestamptz,
  p_interval_unit text,
  p_interval_every int,
  p_from timestamptz default now()
) returns timestamptz
language plpgsql immutable parallel safe set search_path = public as $$
declare
  step interval;
  candidate timestamptz := p_anchor_at;
  iterations int := 0;
begin
  if p_interval_every is null or p_interval_every < 1 then
    raise exception 'interval_every must be >= 1';
  end if;

  step := case p_interval_unit
            when 'day'   then make_interval(days  => p_interval_every)
            when 'week'  then make_interval(days  => p_interval_every * 7)
            when 'month' then make_interval(months => p_interval_every)
            else null
          end;
  if step is null then
    raise exception 'invalid interval_unit %', p_interval_unit;
  end if;

  -- Anchor in the future already → use it as-is.
  if candidate > p_from then
    return candidate;
  end if;

  -- Otherwise, jump forward in steps until > now. Bounded to avoid runaway
  -- on bogus inputs (years of paused state with daily cadence still
  -- terminates in <100k iterations, but cap as a safety net).
  while candidate <= p_from and iterations < 100000 loop
    candidate := candidate + step;
    iterations := iterations + 1;
  end loop;

  return candidate;
end;
$$;

grant execute on function public.compute_next_recurrence_run(timestamptz, text, int, timestamptz) to authenticated;
