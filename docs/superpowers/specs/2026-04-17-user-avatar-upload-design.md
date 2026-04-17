# User Avatar Upload — Design

**Status:** Draft for implementation
**Date:** 2026-04-17
**Branch:** main

## Motivation

Users today inherit their avatar from Google OAuth (`session.user.user_metadata.avatar_url`, written into `profiles.avatar_url` at first login). There is no way to change it. Team members want to set a custom photo that reflects how they want to be seen inside the app — Campfire, Message Board, mentions, comment threads, notification bell, hub member lists, etc.

Goal: let a user upload their own photo from Settings, have it replace their Google photo everywhere the app shows that user's avatar, and give them a one-click way to revert to the Google photo.

## Scope

### In scope

- New Supabase Storage bucket `avatars` (public, 5 MB, image/* only).
- Migration `026_avatar_upload.sql` creating the bucket and its RLS policies.
- New hook `src/hooks/useAvatarUpload.js` — upload + remove operations.
- New component `src/components/settings/AvatarCard.jsx` — UI at the top of `SettingsPage.jsx`.
- Small edit to `SettingsPage.jsx` to mount the card.

### Out of scope

- Client-side cropping. Users upload a photo as-is; every consumer renders it inside a square container with `object-cover` + `rounded-full` (existing pattern).
- Changing how the 31 existing consumers read `avatar_url` — they already read the column and work correctly once it's updated.
- Admin-initiated avatar changes for other users. (Admins can already delete users via existing flows; custom avatars are user-driven only.)
- Avatar upload on invite/signup. New users still inherit the Google photo on first login; they can change it afterward from Settings.
- Realtime propagation. Other viewers see the new avatar on their next fetch/refresh; we do not push a global invalidation.

## Architecture

### Bucket + policies

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

create policy "avatars_read" on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_insert" on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update" on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete" on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

Filename layout: `<userId>/<unixMs>-<safeFileName>`. The timestamp prefix acts as a cache-buster — each upload yields a new unique URL that browsers cannot serve stale.

### Hook

`useAvatarUpload()` exposes:

```
uploadAvatar(file): Promise<boolean>
removeAvatar(): Promise<boolean>
uploading: boolean
```

`uploadAvatar` flow:

1. Guard: `file.type.startsWith('image/')` and `file.size <= 5 * 1024 * 1024`. Otherwise toast and return false.
2. Upload to `avatars/<userId>/<Date.now()>-<sanitized>` via `supabase.storage.from('avatars').upload(path, file)`.
3. On success, `supabase.storage.from('avatars').getPublicUrl(path)` → `publicUrl`.
4. `supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId)`.
5. Trigger `useAuth`'s refetch so the in-memory `profile` updates (exposes a refetch function; see below).
6. List all existing files under `<userId>/`; delete any whose path is not the new one. This happens after the DB write succeeds, so even if delete fails, the DB points at a valid file.
7. Toast "Avatar updated".

`removeAvatar` flow:

1. Read `session.user.user_metadata.avatar_url` from `useAuth`. Call it `googleUrl`.
2. `supabase.from('profiles').update({ avatar_url: googleUrl ?? null }).eq('id', userId)`.
3. List + delete all files under `<userId>/` in the `avatars` bucket.
4. Trigger `useAuth` refetch.
5. Toast "Reverted to default avatar".

### `useAuth` refetch

`useAuth` already exposes `refreshProfile()`. The new hook calls it after any avatar write to trigger a re-render with the updated `profiles.avatar_url`. No change to `useAuth` itself is needed.

### UI — `AvatarCard.jsx`

Renders at the very top of `SettingsPage.jsx`'s profile section.

- Left column: 80×80 avatar preview with `object-cover rounded-full`. Falls back to the initials-in-brand-bg pattern used everywhere else when `avatar_url` is empty.
- Right column:
  - `Upload new photo` button → opens hidden `<input type="file" accept="image/*">`.
  - `Reset to default` button — only rendered when `profile.avatar_url` differs from `session.user.user_metadata.avatar_url` AND `googleUrl` is non-empty.
- Below: subtitle "JPEG, PNG, WebP, or GIF. Max 5 MB."
- During upload: both buttons disabled, upload button shows a spinner and "Uploading…".

## Data flow

```
User picks file
  → client-side guard (type + size)
  → supabase.storage.upload('avatars/<uid>/<ts>-<name>')
  → supabase.storage.getPublicUrl(...)
  → supabase.from('profiles').update({ avatar_url })
  → useAuth.refreshProfile() → local profile state re-renders
  → 31 consumer components re-read avatar_url on their next render/refetch
```

Old files in the user's folder are removed *after* the DB write succeeds, so a partial failure never leaves a broken image.

## Error handling

- **Oversized / wrong type**: client-side guard rejects with a toast before any network call. Bucket-level limit is the same; Supabase returns a 400 if the client guard is somehow bypassed — surfaced as a toast.
- **Upload succeeds but DB update fails**: new file exists in the bucket but `avatar_url` still points at the old URL → broken state. Mitigation: delete the orphan on error. If that also fails, a storage-reaper cron could clean up; acceptable risk for this scale.
- **Delete-old-files step fails**: orphan files in bucket, but current DB URL is valid. No user-visible bug; eventual cleanup is nice-to-have but not required for correctness.
- **User navigates away mid-upload**: `uploading` state is component-local; next visit shows whichever state the DB committed.
- **RLS rejection**: if `(storage.foldername(name))[1] !== auth.uid()::text`, insert is rejected. Only possible if a user tampers with client code; rejection surfaces as a toast.

## Testing

Pure-unit tests are low-value for this feature (the logic is thin glue around `supabase.storage` + `supabase.from('profiles').update`). Rely on manual verification.

### Manual verification checklist

- [ ] Open Settings. Upload card shows current (Google) avatar + "Upload new photo" button. No "Reset" button yet.
- [ ] Upload a 200 KB JPEG. Preview updates within ~1 s. Toast "Avatar updated".
- [ ] Open any page showing your avatar (NotificationBell header, hub members, a Campfire message you authored). All show the new photo on next fetch.
- [ ] In another logged-in user's browser, navigate to the same page. They see the new avatar after refresh.
- [ ] Click "Reset to default". Preview reverts to Google photo. Bucket is empty for that user.
- [ ] Upload a 6 MB image. Client-side guard rejects with a toast; no network call.
- [ ] Upload a `.txt` (rename a text file to `.txt`). Client-side guard rejects.
- [ ] Upload a 10 MB image that somehow bypasses the client guard (devtools hack): bucket-level limit rejects with a toast.
- [ ] Upload twice in a row. Second upload's public URL is different from the first. Inspecting the bucket shows only one file.
- [ ] Log out and back in. Avatar persists (the custom one, not the Google one).

## Files touched

### New

- `supabase/migrations/026_avatar_upload.sql`
- `src/hooks/useAvatarUpload.js`
- `src/components/settings/AvatarCard.jsx`

### Modified

- `src/pages/SettingsPage.jsx` — mount `<AvatarCard />` at the top of the profile section.

## Open questions

None. Bucket visibility, remove behavior, crop UX, and size limit all locked during brainstorming.
