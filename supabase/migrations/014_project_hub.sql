-- ─────────────────────────────────────────────
-- 014 · Project Hub tables
-- Message board, check-ins, events, chat,
-- activity feed, and supporting triggers
-- ─────────────────────────────────────────────


-- ── Hub Messages (announcements + threaded replies) ──

create table public.hub_messages (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  parent_id   uuid references public.hub_messages(id) on delete cascade,
  title       text,
  content     text not null,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_hub_messages_team    on public.hub_messages(team_id);
create index idx_hub_messages_parent  on public.hub_messages(parent_id);
create index idx_hub_messages_created on public.hub_messages(created_at desc);

alter table public.hub_messages enable row level security;

create policy "hub_messages_select" on public.hub_messages for select using (
  exists (
    select 1 from public.profile_teams pt
    where pt.profile_id = auth.uid() and pt.team_id = hub_messages.team_id
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);

create policy "hub_messages_insert" on public.hub_messages for insert with check (
  author_id = auth.uid()
  and (
    exists (
      select 1 from public.profile_teams pt
      where pt.profile_id = auth.uid() and pt.team_id = hub_messages.team_id
    )
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
    )
  )
);

create policy "hub_messages_update" on public.hub_messages for update using (
  author_id = auth.uid()
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);

create policy "hub_messages_delete" on public.hub_messages for delete using (
  author_id = auth.uid()
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
  or exists (
    select 1 from public.profile_teams pt
    where pt.profile_id = auth.uid() and pt.team_id = hub_messages.team_id and pt.role = 'Manager'
  )
);


-- ── Hub Check-in Prompts ──

create table public.hub_check_in_prompts (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  question    text not null,
  schedule    text not null default 'daily' check (schedule in ('daily', 'weekly_monday', 'weekly_friday')),
  active      boolean not null default true,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index idx_check_in_prompts_team on public.hub_check_in_prompts(team_id);

alter table public.hub_check_in_prompts enable row level security;

create policy "check_in_prompts_select" on public.hub_check_in_prompts for select using (
  exists (
    select 1 from public.profile_teams pt
    where pt.profile_id = auth.uid() and pt.team_id = hub_check_in_prompts.team_id
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);

create policy "check_in_prompts_insert" on public.hub_check_in_prompts for insert with check (
  created_by = auth.uid()
  and (
    exists (
      select 1 from public.profile_teams pt
      where pt.profile_id = auth.uid() and pt.team_id = hub_check_in_prompts.team_id
        and pt.role = 'Manager'
    )
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
    )
  )
);

create policy "check_in_prompts_update" on public.hub_check_in_prompts for update using (
  created_by = auth.uid()
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);

create policy "check_in_prompts_delete" on public.hub_check_in_prompts for delete using (
  created_by = auth.uid()
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);


-- ── Hub Check-in Responses ──

create table public.hub_check_in_responses (
  id             uuid primary key default gen_random_uuid(),
  prompt_id      uuid not null references public.hub_check_in_prompts(id) on delete cascade,
  author_id      uuid not null references public.profiles(id) on delete cascade,
  content        text not null,
  response_date  date not null default current_date,
  created_at     timestamptz not null default now()
);

create unique index idx_check_in_response_unique on public.hub_check_in_responses(prompt_id, author_id, response_date);
create index idx_check_in_responses_prompt on public.hub_check_in_responses(prompt_id);
create index idx_check_in_responses_date   on public.hub_check_in_responses(response_date desc);

alter table public.hub_check_in_responses enable row level security;

create policy "check_in_responses_select" on public.hub_check_in_responses for select using (
  exists (
    select 1 from public.hub_check_in_prompts p
    join public.profile_teams pt on pt.team_id = p.team_id
    where p.id = hub_check_in_responses.prompt_id and pt.profile_id = auth.uid()
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);

create policy "check_in_responses_insert" on public.hub_check_in_responses for insert with check (
  author_id = auth.uid()
);

create policy "check_in_responses_update" on public.hub_check_in_responses for update using (
  author_id = auth.uid()
);

create policy "check_in_responses_delete" on public.hub_check_in_responses for delete using (
  author_id = auth.uid()
);


-- ── Hub Events (schedule/calendar) ──

create table public.hub_events (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  created_by  uuid not null references public.profiles(id),
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  color       text,
  created_at  timestamptz not null default now()
);

create index idx_hub_events_team   on public.hub_events(team_id);
create index idx_hub_events_starts on public.hub_events(starts_at);

alter table public.hub_events enable row level security;

create policy "hub_events_select" on public.hub_events for select using (
  exists (
    select 1 from public.profile_teams pt
    where pt.profile_id = auth.uid() and pt.team_id = hub_events.team_id
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);

create policy "hub_events_insert" on public.hub_events for insert with check (
  created_by = auth.uid()
  and (
    exists (
      select 1 from public.profile_teams pt
      where pt.profile_id = auth.uid() and pt.team_id = hub_events.team_id
    )
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
    )
  )
);

create policy "hub_events_update" on public.hub_events for update using (
  created_by = auth.uid()
  or exists (
    select 1 from public.profile_teams pt
    where pt.profile_id = auth.uid() and pt.team_id = hub_events.team_id and pt.role = 'Manager'
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);

create policy "hub_events_delete" on public.hub_events for delete using (
  created_by = auth.uid()
  or exists (
    select 1 from public.profile_teams pt
    where pt.profile_id = auth.uid() and pt.team_id = hub_events.team_id and pt.role = 'Manager'
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);


-- ── Hub Chat Messages (Campfire) ──

create table public.hub_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);

create index idx_hub_chat_team    on public.hub_chat_messages(team_id);
create index idx_hub_chat_created on public.hub_chat_messages(created_at desc);

alter table public.hub_chat_messages enable row level security;

create policy "hub_chat_select" on public.hub_chat_messages for select using (
  exists (
    select 1 from public.profile_teams pt
    where pt.profile_id = auth.uid() and pt.team_id = hub_chat_messages.team_id
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);

create policy "hub_chat_insert" on public.hub_chat_messages for insert with check (
  author_id = auth.uid()
  and (
    exists (
      select 1 from public.profile_teams pt
      where pt.profile_id = auth.uid() and pt.team_id = hub_chat_messages.team_id
    )
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
    )
  )
);

create policy "hub_chat_delete" on public.hub_chat_messages for delete using (
  author_id = auth.uid()
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);


-- ── Hub Activity Feed (denormalized) ──

create table public.hub_activity (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  event_type  text not null,
  entity_type text,
  entity_id   uuid,
  summary     text not null,
  created_at  timestamptz not null default now()
);

create index idx_hub_activity_team    on public.hub_activity(team_id);
create index idx_hub_activity_created on public.hub_activity(created_at desc);

alter table public.hub_activity enable row level security;

create policy "hub_activity_select" on public.hub_activity for select using (
  exists (
    select 1 from public.profile_teams pt
    where pt.profile_id = auth.uid() and pt.team_id = hub_activity.team_id
  )
  or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin'
  )
);


-- ── Triggers: auto-populate hub_activity ──

create or replace function public.hub_activity_on_message()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_name text;
begin
  select full_name into actor_name from public.profiles where id = new.author_id;
  insert into public.hub_activity (team_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
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

create trigger trg_hub_activity_message
  after insert on public.hub_messages
  for each row execute function public.hub_activity_on_message();


create or replace function public.hub_activity_on_check_in()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_name text;
  prompt_team uuid;
  prompt_question text;
begin
  select full_name into actor_name from public.profiles where id = new.author_id;
  select team_id, question into prompt_team, prompt_question
    from public.hub_check_in_prompts where id = new.prompt_id;
  insert into public.hub_activity (team_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    prompt_team,
    new.author_id,
    'check_in_response',
    'check_in',
    new.id,
    coalesce(actor_name, 'Someone') || ' answered: ' || left(prompt_question, 60)
  );
  return new;
end;
$$;

create trigger trg_hub_activity_check_in
  after insert on public.hub_check_in_responses
  for each row execute function public.hub_activity_on_check_in();


create or replace function public.hub_activity_on_event()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_name text;
begin
  select full_name into actor_name from public.profiles where id = new.created_by;
  insert into public.hub_activity (team_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
    new.created_by,
    'event_created',
    'event',
    new.id,
    coalesce(actor_name, 'Someone') || ' added event: ' || left(new.title, 80)
  );
  return new;
end;
$$;

create trigger trg_hub_activity_event
  after insert on public.hub_events
  for each row execute function public.hub_activity_on_event();


create or replace function public.hub_activity_on_chat()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_name text;
  recent_count int;
begin
  -- Throttle: skip if this user posted a chat activity in the last 5 minutes
  select count(*) into recent_count from public.hub_activity
  where team_id = new.team_id
    and actor_id = new.author_id
    and event_type = 'chat_message'
    and created_at > now() - interval '5 minutes';
  if recent_count > 0 then return new; end if;

  select full_name into actor_name from public.profiles where id = new.author_id;
  insert into public.hub_activity (team_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
    new.author_id,
    'chat_message',
    'chat',
    new.id,
    coalesce(actor_name, 'Someone') || ' is chatting in Campfire'
  );
  return new;
end;
$$;

create trigger trg_hub_activity_chat
  after insert on public.hub_chat_messages
  for each row execute function public.hub_activity_on_chat();


-- ── Realtime publications ──

alter publication supabase_realtime add table public.hub_chat_messages;
alter publication supabase_realtime add table public.hub_activity;
alter publication supabase_realtime add table public.hub_messages;
alter publication supabase_realtime add table public.hub_check_in_responses;
