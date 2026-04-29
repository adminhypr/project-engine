-- ─────────────────────────────────────────────
-- 073 · Scope hub-files storage to hub members
--
-- Migration 016 left the hub-files bucket readable/writable by any
-- authenticated user. The bucket holds inline RichInput images from
-- every hub surface plus card attachments (072), so this leaks
-- everything across hubs to externals. Mirrors the fix migration 049
-- applied to task-attachments.
--
-- Object naming convention (set by useHubFiles + RichInput +
-- FileAttachments): `{hubId}/...rest`. We extract the leading folder
-- segment and check hub_members.
-- ─────────────────────────────────────────────

drop policy if exists "hub_files_storage_select" on storage.objects;
drop policy if exists "hub_files_storage_insert" on storage.objects;
drop policy if exists "hub_files_storage_delete" on storage.objects;

-- Helper: extract hub_id from the object name's first folder segment.
-- storage.foldername(name) returns text[]; first element is the hub uuid.
-- Returns null if the name doesn't start with a uuid-shaped folder.

create or replace function public.hub_id_from_storage_name(p_name text)
returns uuid
language sql
stable
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(p_name))[1])::uuid
    else null
  end
$$;

create policy "hub_files_storage_select" on storage.objects for select using (
  bucket_id = 'hub-files'
  and exists (
    select 1 from public.hub_members hm
     where hm.hub_id = public.hub_id_from_storage_name(storage.objects.name)
       and hm.profile_id = auth.uid()
  )
);

create policy "hub_files_storage_insert" on storage.objects for insert with check (
  bucket_id = 'hub-files'
  and exists (
    select 1 from public.hub_members hm
     where hm.hub_id = public.hub_id_from_storage_name(storage.objects.name)
       and hm.profile_id = auth.uid()
  )
);

create policy "hub_files_storage_delete" on storage.objects for delete using (
  bucket_id = 'hub-files'
  and exists (
    select 1 from public.hub_members hm
     where hm.hub_id = public.hub_id_from_storage_name(storage.objects.name)
       and hm.profile_id = auth.uid()
  )
);

-- Service role bypasses RLS, so edge functions still work.
