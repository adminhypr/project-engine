-- ---------------------------------------------
-- 110 - Attachments on bugs + feature_requests (+ project-attachments bucket)
--
-- Lets users attach files/images to a bug or feature request for triage
-- context. Mirrors the card-attachments pattern (072): a jsonb array on the
-- row + a private Storage bucket scoped by RLS. Projects aren't hubs, so we
-- can't reuse hub-files; a new `project-attachments` bucket is scoped to
-- project members via the leading {projectId}/ folder (mirrors 073's hub-files
-- RLS, with MIME allow-list from 077 minus script-capable types).
--
-- attachments shape: [{ storage_path, file_name, mime_type, size }]
-- object path:       {projectId}/{bug|request}/{entityId}/{uuid}-{filename}
-- ---------------------------------------------

alter table public.bugs
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.feature_requests
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Private bucket, 10 MB cap, MIME allow-list (NO svg/html/xml/js - XSS risk).
-- application/octet-stream included as the browser-unknown fallback (the
-- project-member storage RLS below means only members can read these anyway).
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

-- Helper: extract the leading folder uuid (the projectId) from an object name.
-- storage.foldername(name) returns text[]; first element is the project uuid.
-- Returns null if the name doesn't start with a uuid-shaped folder.
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

-- Scope read/write/delete to project members. is_project_member (106) is
-- SECURITY DEFINER STABLE and returns false for a null project id, so a
-- malformed path is denied. Service role bypasses RLS.
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
