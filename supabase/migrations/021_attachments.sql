-- ============================================================
-- Project Engine — File Attachments
-- Adds task_attachments table + Supabase Storage bucket
-- ============================================================

-- ─────────────────────────────────────────────
-- TASK ATTACHMENTS TABLE
-- ─────────────────────────────────────────────
create table public.task_attachments (
  id           uuid primary key default uuid_generate_v4(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  comment_id   uuid references public.comments(id) on delete set null,
  uploaded_by  uuid not null references public.profiles(id) on delete cascade,
  file_name    text not null,
  file_size    integer not null,
  mime_type    text not null,
  storage_path text not null,
  created_at   timestamptz not null default now()
);

create index idx_task_attachments_task on public.task_attachments(task_id);
create index idx_task_attachments_comment on public.task_attachments(comment_id);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table public.task_attachments enable row level security;

-- SELECT: anyone who can see the parent task
create policy "Attachment visibility"
  on public.task_attachments for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_attachments.task_id
      and (
        t.assigned_to = auth.uid()
        or t.assigned_by = auth.uid()
        or exists (
          select 1 from public.task_assignees ta
          where ta.task_id = t.id and ta.profile_id = auth.uid()
        )
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'Admin'
        )
        or exists (
          select 1 from public.profile_teams pt
          where pt.profile_id = auth.uid()
            and pt.team_id = t.team_id
            and pt.role = 'Manager'
        )
      )
    )
  );

-- INSERT: any authenticated user (must match own uid)
create policy "Authenticated users can add attachments"
  on public.task_attachments for insert
  with check (
    auth.role() = 'authenticated'
    and uploaded_by = auth.uid()
  );

-- DELETE: uploader, task owner (assigned_by), or admin
create policy "Attachment delete"
  on public.task_attachments for delete
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from public.tasks t
      where t.id = task_attachments.task_id
        and t.assigned_by = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Admin'
    )
  );

-- ─────────────────────────────────────────────
-- STORAGE BUCKET
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 5242880)
on conflict (id) do nothing;

-- Storage: authenticated users can upload
create policy "Authenticated upload"
  on storage.objects for insert
  with check (
    bucket_id = 'task-attachments'
    and auth.role() = 'authenticated'
  );

-- Storage: authenticated users can read
create policy "Authenticated read"
  on storage.objects for select
  using (
    bucket_id = 'task-attachments'
    and auth.role() = 'authenticated'
  );

-- Storage: owner of the upload folder or admin can delete
create policy "Owner or admin delete storage"
  on storage.objects for delete
  using (
    bucket_id = 'task-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'Admin'
      )
    )
  );
