-- ─────────────────────────────────────────────
-- 057 · Fix user deletion blocked by NO ACTION foreign keys
--
-- admin-delete-user was 500'ing whenever the deleted user had created
-- any hub content (hub, event, file, folder, to-do list, to-do item,
-- check-in prompt, to-do comment). All those FKs were declared with
-- ON DELETE NO ACTION, which blocks the auth.users → profiles
-- cascade chain when child rows exist.
--
-- Fix: convert each to ON DELETE SET NULL. User content stays, but
-- "created by" becomes null — interpreted as "unknown / former user"
-- in the UI. This matches the existing behavior for tasks
-- (assigned_by/assigned_to use CASCADE) and conversations
-- (created_by uses SET NULL).
-- ─────────────────────────────────────────────

-- Make creator/uploader columns nullable so SET NULL can fire.
alter table public.hubs                  alter column created_by  drop not null;
alter table public.hub_check_in_prompts  alter column created_by  drop not null;
alter table public.hub_events            alter column created_by  drop not null;
alter table public.hub_files             alter column uploaded_by drop not null;
alter table public.hub_folders           alter column created_by  drop not null;
alter table public.hub_todo_lists        alter column created_by  drop not null;
alter table public.hub_todo_items        alter column created_by  drop not null;
alter table public.hub_todo_comments     alter column created_by  drop not null;
-- hub_todo_items.completed_by is already nullable — no change.

-- Drop and recreate FKs with ON DELETE SET NULL.
alter table public.hubs
  drop constraint if exists hubs_created_by_fkey;
alter table public.hubs
  add constraint hubs_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.hub_check_in_prompts
  drop constraint if exists hub_check_in_prompts_created_by_fkey;
alter table public.hub_check_in_prompts
  add constraint hub_check_in_prompts_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.hub_events
  drop constraint if exists hub_events_created_by_fkey;
alter table public.hub_events
  add constraint hub_events_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.hub_files
  drop constraint if exists hub_files_uploaded_by_fkey;
alter table public.hub_files
  add constraint hub_files_uploaded_by_fkey
  foreign key (uploaded_by) references public.profiles(id) on delete set null;

alter table public.hub_folders
  drop constraint if exists hub_folders_created_by_fkey;
alter table public.hub_folders
  add constraint hub_folders_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.hub_todo_lists
  drop constraint if exists hub_todo_lists_created_by_fkey;
alter table public.hub_todo_lists
  add constraint hub_todo_lists_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.hub_todo_items
  drop constraint if exists hub_todo_items_created_by_fkey;
alter table public.hub_todo_items
  add constraint hub_todo_items_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.hub_todo_items
  drop constraint if exists hub_todo_items_completed_by_fkey;
alter table public.hub_todo_items
  add constraint hub_todo_items_completed_by_fkey
  foreign key (completed_by) references public.profiles(id) on delete set null;

alter table public.hub_todo_comments
  drop constraint if exists hub_todo_comments_created_by_fkey;
alter table public.hub_todo_comments
  add constraint hub_todo_comments_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
