# Project Attachments — Migration 110 (apply to Supabase)

**What:** Adds an `attachments jsonb` column to `bugs` and `feature_requests`, plus a private `project-attachments` Storage bucket scoped to project members. Backs the new file/image attachments on the Bug + Feature Request modals.

**When:** Apply **before** merging/deploying this branch — without it, uploads fail (the bucket + columns don't exist) and the Attachments section errors.

> The **urgency badge** and **Features filter** in the same PR are frontend-only and need no migration.

**How:** Paste into the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql/new) and **Run**. Idempotent (`add column if not exists`, `on conflict do nothing`, `drop policy if exists`). Depends on `is_project_member` (migration 106), already live.

```sql
-- ---------------------------------------------
-- 110 - Attachments on bugs + feature_requests (+ project-attachments bucket)
-- attachments shape: [{ storage_path, file_name, mime_type, size }]
-- object path:       {projectId}/{bug|request}/{entityId}/{uuid}-{filename}
-- ---------------------------------------------

alter table public.bugs
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.feature_requests
  add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-attachments', 'project-attachments', false, 10485760, array[
  'image/png','image/jpeg','image/jpg','image/gif','image/webp','image/heic','image/heif','image/avif','image/bmp','image/tiff',
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet','application/vnd.oasis.opendocument.presentation',
  'application/rtf','text/plain','text/csv','text/markdown','text/tab-separated-values','application/json',
  'application/zip','application/x-zip-compressed','application/x-7z-compressed','application/x-rar-compressed','application/x-tar','application/gzip',
  'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/webm','audio/ogg','audio/mp4','audio/aac','audio/flac',
  'video/mp4','video/webm','video/quicktime','video/x-msvideo','video/x-matroska',
  'application/octet-stream'
])
on conflict (id) do nothing;

create or replace function public.project_id_from_storage_name(p_name text)
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

drop policy if exists "project_attachments_storage_select" on storage.objects;
create policy "project_attachments_storage_select" on storage.objects for select using (
  bucket_id = 'project-attachments'
  and public.is_project_member(public.project_id_from_storage_name(storage.objects.name))
);

drop policy if exists "project_attachments_storage_insert" on storage.objects;
create policy "project_attachments_storage_insert" on storage.objects for insert with check (
  bucket_id = 'project-attachments'
  and public.is_project_member(public.project_id_from_storage_name(storage.objects.name))
);

drop policy if exists "project_attachments_storage_delete" on storage.objects;
create policy "project_attachments_storage_delete" on storage.objects for delete using (
  bucket_id = 'project-attachments'
  and public.is_project_member(public.project_id_from_storage_name(storage.objects.name))
);
```

## Smoke test
1. Open a bug or feature request → **Attachments** → "Attach file/image".
2. Upload an image → it shows as a thumbnail (click opens full size); upload a PDF → file chip with download.
3. Close the modal without Save, reopen → attachments are still there (persisted immediately).
4. A non-member of the project can't fetch the files (RLS on `project-attachments`).
