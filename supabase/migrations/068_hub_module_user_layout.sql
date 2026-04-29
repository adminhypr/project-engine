-- ─────────────────────────────────────────────
-- 068 · Per-user hub module layout overrides
--
-- hub_modules carries the canonical "house" layout (admin-curated). This
-- table layers per-user overrides on top: if a user has an override row
-- for a module, that row's column_index + position wins; otherwise the
-- canonical hub_modules.column_index + position is used.
--
-- Drag-reorder writes here only. The "Reset layout" button deletes the
-- caller's override rows for a hub, restoring the canonical view.
--
-- ON DELETE CASCADE on module_id drops user overrides automatically when
-- an admin deletes a module. ON DELETE CASCADE on user_id drops a leaving
-- user's overrides.
-- ─────────────────────────────────────────────

create table public.hub_module_user_layout (
  user_id      uuid not null references public.profiles(id)     on delete cascade,
  module_id    uuid not null references public.hub_modules(id)  on delete cascade,
  column_index int  not null check (column_index between 0 and 2),
  position     int  not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, module_id)
);

create index idx_hub_module_user_layout_user   on public.hub_module_user_layout(user_id);
create index idx_hub_module_user_layout_module on public.hub_module_user_layout(module_id);

alter table public.hub_module_user_layout enable row level security;

-- A user can only see and write their own override rows.

drop policy if exists "hub_module_user_layout_select_self" on public.hub_module_user_layout;
create policy "hub_module_user_layout_select_self" on public.hub_module_user_layout
  for select using (user_id = auth.uid());

drop policy if exists "hub_module_user_layout_insert_self" on public.hub_module_user_layout;
create policy "hub_module_user_layout_insert_self" on public.hub_module_user_layout
  for insert with check (user_id = auth.uid());

drop policy if exists "hub_module_user_layout_update_self" on public.hub_module_user_layout;
create policy "hub_module_user_layout_update_self" on public.hub_module_user_layout
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "hub_module_user_layout_delete_self" on public.hub_module_user_layout;
create policy "hub_module_user_layout_delete_self" on public.hub_module_user_layout
  for delete using (user_id = auth.uid());

alter publication supabase_realtime add table public.hub_module_user_layout;
