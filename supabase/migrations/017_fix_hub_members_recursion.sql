-- Fix: hub_members RLS policies self-reference hub_members → 500 error
-- Solution: SECURITY DEFINER helper that bypasses RLS

-- Helper: is the current user a member of this hub?
create or replace function public.is_hub_member(p_hub_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.hub_members
    where hub_id = p_hub_id and profile_id = auth.uid()
  );
$$;

-- Helper: what role does the current user have in this hub?
create or replace function public.hub_member_role(p_hub_id uuid)
returns text
language sql
security definer
stable
as $$
  select role from public.hub_members
  where hub_id = p_hub_id and profile_id = auth.uid()
  limit 1;
$$;


-- ── Recreate hub_members policies ──

drop policy if exists "hub_members_select" on public.hub_members;
drop policy if exists "hub_members_insert" on public.hub_members;
drop policy if exists "hub_members_update" on public.hub_members;
drop policy if exists "hub_members_delete" on public.hub_members;

create policy "hub_members_select" on public.hub_members for select using (
  public.is_hub_member(hub_members.hub_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_members_insert" on public.hub_members for insert with check (
  public.hub_member_role(hub_members.hub_id) in ('owner', 'admin')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  -- Allow self-insert as owner (when creating a new hub)
  or (hub_members.profile_id = auth.uid() and hub_members.role = 'owner')
);

create policy "hub_members_update" on public.hub_members for update using (
  public.hub_member_role(hub_members.hub_id) = 'owner'
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_members_delete" on public.hub_members for delete using (
  public.hub_member_role(hub_members.hub_id) in ('owner', 'admin')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  -- Members can remove themselves
  or hub_members.profile_id = auth.uid()
);


-- ── Recreate hubs policies using helper ──

drop policy if exists "hubs_select" on public.hubs;
drop policy if exists "hubs_update" on public.hubs;
drop policy if exists "hubs_delete" on public.hubs;

create policy "hubs_select" on public.hubs for select using (
  public.is_hub_member(hubs.id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hubs_update" on public.hubs for update using (
  public.hub_member_role(hubs.id) in ('owner', 'admin')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hubs_delete" on public.hubs for delete using (
  public.hub_member_role(hubs.id) = 'owner'
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);


-- ── Recreate hub_folders/files policies using helper ──

drop policy if exists "hub_folders_select" on public.hub_folders;
drop policy if exists "hub_folders_insert" on public.hub_folders;
drop policy if exists "hub_folders_update" on public.hub_folders;
drop policy if exists "hub_folders_delete" on public.hub_folders;
drop policy if exists "hub_files_select" on public.hub_files;
drop policy if exists "hub_files_insert" on public.hub_files;
drop policy if exists "hub_files_delete" on public.hub_files;

create policy "hub_folders_select" on public.hub_folders for select using (
  public.is_hub_member(hub_folders.hub_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_folders_insert" on public.hub_folders for insert with check (
  created_by = auth.uid() and public.is_hub_member(hub_folders.hub_id)
);

create policy "hub_folders_update" on public.hub_folders for update using (
  created_by = auth.uid()
  or public.hub_member_role(hub_folders.hub_id) in ('owner', 'admin')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_folders_delete" on public.hub_folders for delete using (
  created_by = auth.uid()
  or public.hub_member_role(hub_folders.hub_id) in ('owner', 'admin')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_files_select" on public.hub_files for select using (
  public.is_hub_member(hub_files.hub_id)
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_files_insert" on public.hub_files for insert with check (
  uploaded_by = auth.uid() and public.is_hub_member(hub_files.hub_id)
);

create policy "hub_files_delete" on public.hub_files for delete using (
  uploaded_by = auth.uid()
  or public.hub_member_role(hub_files.hub_id) in ('owner', 'admin')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);


-- ── Also fix existing hub_* table policies that reference hub_members directly ──

drop policy if exists "hub_messages_select_by_hub" on public.hub_messages;
drop policy if exists "hub_messages_insert_by_hub" on public.hub_messages;
drop policy if exists "hub_chat_select_by_hub" on public.hub_chat_messages;
drop policy if exists "hub_chat_insert_by_hub" on public.hub_chat_messages;
drop policy if exists "check_in_prompts_select_by_hub" on public.hub_check_in_prompts;
drop policy if exists "hub_events_select_by_hub" on public.hub_events;
drop policy if exists "hub_events_insert_by_hub" on public.hub_events;
drop policy if exists "hub_activity_select_by_hub" on public.hub_activity;

create policy "hub_messages_select_by_hub" on public.hub_messages for select using (
  public.is_hub_member(hub_messages.hub_id)
);
create policy "hub_messages_insert_by_hub" on public.hub_messages for insert with check (
  author_id = auth.uid() and public.is_hub_member(hub_messages.hub_id)
);
create policy "hub_chat_select_by_hub" on public.hub_chat_messages for select using (
  public.is_hub_member(hub_chat_messages.hub_id)
);
create policy "hub_chat_insert_by_hub" on public.hub_chat_messages for insert with check (
  author_id = auth.uid() and public.is_hub_member(hub_chat_messages.hub_id)
);
create policy "check_in_prompts_select_by_hub" on public.hub_check_in_prompts for select using (
  public.is_hub_member(hub_check_in_prompts.hub_id)
);
create policy "hub_events_select_by_hub" on public.hub_events for select using (
  public.is_hub_member(hub_events.hub_id)
);
create policy "hub_events_insert_by_hub" on public.hub_events for insert with check (
  created_by = auth.uid() and public.is_hub_member(hub_events.hub_id)
);
create policy "hub_activity_select_by_hub" on public.hub_activity for select using (
  public.is_hub_member(hub_activity.hub_id)
);
