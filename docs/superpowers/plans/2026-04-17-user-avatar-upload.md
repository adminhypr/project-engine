# User Avatar Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload a custom profile photo from Settings that replaces their Google OAuth avatar everywhere in the app, with a one-click revert to the Google photo.

**Architecture:** Public Supabase Storage bucket `avatars` (5 MB, image/*) with per-user RLS on the `<userId>/…` prefix. A new `useAvatarUpload` hook handles the upload/remove/cleanup loop and triggers `useAuth.refreshProfile` so the app re-renders with the new URL. A new `AvatarCard` component mounts at the top of `SettingsPage`. No changes to the 31 existing avatar consumers — they already read `profiles.avatar_url`.

**Tech Stack:** React 18, Supabase Storage + Postgres, Tailwind. `useAuth` already exposes `refreshProfile()` so we reuse it instead of adding a new method.

**Spec:** `docs/superpowers/specs/2026-04-17-user-avatar-upload-design.md`

---

## File structure

```
supabase/
  migrations/
    026_avatar_upload.sql          NEW — bucket + RLS
src/
  hooks/
    useAvatarUpload.js             NEW — uploadAvatar, removeAvatar, uploading
  components/
    settings/
      AvatarCard.jsx               NEW — preview + Upload / Reset buttons
  pages/
    SettingsPage.jsx               MOD — mount <AvatarCard /> at top of profile section
```

---

## Task 1: Migration 026 — avatars bucket + RLS

**Files:**
- Create: `supabase/migrations/026_avatar_upload.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/026_avatar_upload.sql`:

```sql
-- ─────────────────────────────────────────────
-- 026 · User avatar upload
-- Public bucket, per-user folder write, anyone read.
-- ─────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "avatars_read"   on storage.objects;
drop policy if exists "avatars_insert" on storage.objects;
drop policy if exists "avatars_update" on storage.objects;
drop policy if exists "avatars_delete" on storage.objects;

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

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/026_avatar_upload.sql
git commit -m "feat: migration 026 — avatars storage bucket + per-user RLS"
```

---

## Task 2: Apply migration 026 to the remote DB

**Files:** none (database state change only)

- [ ] **Step 1: Apply via CLI**

```bash
supabase db query --file supabase/migrations/026_avatar_upload.sql --linked
```

Expected: `"rows": []` in the response, no error.

- [ ] **Step 2: Record as applied in migration_history**

```bash
supabase migration repair --status applied 026 --linked
```

Expected: `Repaired migration history: [026] => applied`.

- [ ] **Step 3: Verify the bucket exists**

```bash
supabase db query "select id, public, file_size_limit from storage.buckets where id = 'avatars';" --linked
```

Expected: one row — `id='avatars'`, `public=true`, `file_size_limit=5242880`.

- [ ] **Step 4: Verify the policies exist**

```bash
supabase db query "select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'avatars_%' order by policyname;" --linked
```

Expected: four rows — `avatars_delete`, `avatars_insert`, `avatars_read`, `avatars_update`.

---

## Task 3: `useAvatarUpload` hook

**Files:**
- Create: `src/hooks/useAvatarUpload.js`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useAvatarUpload.js`:

```js
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

function sanitizeName(name) {
  return (name || 'avatar').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

export function useAvatarUpload() {
  const { profile, session, refreshProfile } = useAuth()
  const [uploading, setUploading] = useState(false)

  const uploadAvatar = useCallback(async (file) => {
    if (!profile?.id) return false
    if (!file || !file.type?.startsWith('image/')) {
      showToast('Pick an image file (JPEG, PNG, WebP, or GIF)', 'error')
      return false
    }
    if (file.size > MAX_BYTES) {
      showToast('Image exceeds 5 MB limit', 'error')
      return false
    }

    setUploading(true)
    const userId = profile.id
    const path = `${userId}/${Date.now()}-${sanitizeName(file.name)}`

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (uploadErr) {
      setUploading(false)
      showToast('Upload failed', 'error')
      return false
    }

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const publicUrl = pub?.publicUrl || null

    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId)
    if (dbErr) {
      await supabase.storage.from('avatars').remove([path]).catch(() => {})
      setUploading(false)
      showToast('Failed to update profile', 'error')
      return false
    }

    // Best-effort: delete any older files in the user's folder.
    try {
      const { data: files } = await supabase.storage.from('avatars').list(userId, { limit: 100 })
      const keepName = path.split('/').pop()
      const toRemove = (files || [])
        .filter(f => f.name !== keepName)
        .map(f => `${userId}/${f.name}`)
      if (toRemove.length > 0) {
        await supabase.storage.from('avatars').remove(toRemove)
      }
    } catch { /* non-critical */ }

    await refreshProfile()
    setUploading(false)
    showToast('Avatar updated')
    return true
  }, [profile?.id, refreshProfile])

  const removeAvatar = useCallback(async () => {
    if (!profile?.id) return false
    const googleUrl = session?.user?.user_metadata?.avatar_url || null

    setUploading(true)
    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: googleUrl })
      .eq('id', profile.id)
    if (dbErr) {
      setUploading(false)
      showToast('Failed to reset avatar', 'error')
      return false
    }

    try {
      const { data: files } = await supabase.storage.from('avatars').list(profile.id, { limit: 100 })
      const toRemove = (files || []).map(f => `${profile.id}/${f.name}`)
      if (toRemove.length > 0) await supabase.storage.from('avatars').remove(toRemove)
    } catch { /* non-critical */ }

    await refreshProfile()
    setUploading(false)
    showToast(googleUrl ? 'Reverted to default avatar' : 'Avatar cleared')
    return true
  }, [profile?.id, session?.user?.user_metadata?.avatar_url, refreshProfile])

  return { uploadAvatar, removeAvatar, uploading }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: green. No TypeScript/lint errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAvatarUpload.js
git commit -m "feat: useAvatarUpload hook (upload, remove, cleanup old files)"
```

---

## Task 4: `AvatarCard` component

**Files:**
- Create: `src/components/settings/AvatarCard.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/settings/AvatarCard.jsx`:

```jsx
import { useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useAvatarUpload } from '../../hooks/useAvatarUpload'
import { Upload, RotateCcw, Loader2 } from 'lucide-react'

export default function AvatarCard() {
  const { profile, session } = useAuth()
  const { uploadAvatar, removeAvatar, uploading } = useAvatarUpload()
  const fileRef = useRef(null)

  if (!profile) return null

  const googleUrl = session?.user?.user_metadata?.avatar_url || null
  const currentUrl = profile.avatar_url || null
  const hasCustomAvatar = !!currentUrl && currentUrl !== googleUrl
  const canReset = hasCustomAvatar && !!googleUrl

  function pickFile() {
    if (!uploading) fileRef.current?.click()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await uploadAvatar(file)
  }

  return (
    <div className="card p-4 mb-6">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Profile photo</h3>
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-brand-500 flex items-center justify-center text-white text-2xl font-bold shrink-0">
          {currentUrl ? (
            <img src={currentUrl} alt={profile.full_name || 'Avatar'} className="w-full h-full object-cover" />
          ) : (
            <span>{profile.full_name?.[0]?.toUpperCase() || '?'}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={pickFile}
              disabled={uploading}
              className="btn btn-primary text-xs flex items-center gap-1.5 disabled:opacity-40"
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {uploading ? 'Uploading…' : 'Upload new photo'}
            </button>
            {canReset && (
              <button
                type="button"
                onClick={removeAvatar}
                disabled={uploading}
                className="btn btn-ghost text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                <RotateCcw size={12} />
                Reset to default
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            JPEG, PNG, WebP, or GIF. Max 5 MB.
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/AvatarCard.jsx
git commit -m "feat: AvatarCard component (preview + upload + reset buttons)"
```

---

## Task 5: Mount `AvatarCard` in `SettingsPage`

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

- [ ] **Step 1: Read the page**

Read `src/pages/SettingsPage.jsx` to locate where the page's main content begins rendering. Specifically find the first JSX element inside the `<PageTransition>` wrapper that contains the user-facing profile section (the area before the `<div>` that lists other user profiles / admin controls).

- [ ] **Step 2: Add the import**

Near the top with the other imports, add:

```jsx
import AvatarCard from '../components/settings/AvatarCard'
```

- [ ] **Step 3: Render `<AvatarCard />` at the top of the page content**

Inside the top-level layout container that holds the page's content (e.g., directly after the `<PageHeader ... />` render), add the component so it appears above all existing sections:

```jsx
<AvatarCard />
```

If the existing layout wraps content in a container div with padding (e.g., `className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6"`), place `<AvatarCard />` as the first child of that container.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: green.

- [ ] **Step 5: Start dev server and smoke-test**

```bash
npm run dev
```

Open `http://localhost:<port>/settings`. Expected: `Profile photo` card at the top with the current avatar and "Upload new photo" button. If `avatar_url` differs from Google's, "Reset to default" is visible.

Kill the dev server after confirming.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "feat: mount AvatarCard at the top of SettingsPage"
```

---

## Task 6: Manual verification checklist

No code. Walk through the end-to-end behavior in the browser.

- [ ] **Step 1: Boot dev**

```bash
npm run dev
```

- [ ] **Step 2: Settings shows current avatar**

Navigate to `/settings`. Expected: the `Profile photo` card renders with your current avatar (Google photo if you haven't uploaded anything). No "Reset to default" button yet.

- [ ] **Step 3: Upload a small JPEG**

Click `Upload new photo`, pick a ~200 KB JPEG. Expected: button shows `Uploading…` briefly, toast `Avatar updated`, preview updates to the new image within ~1 s.

- [ ] **Step 4: Verify propagation**

Open the notification bell (top-right), a hub members list, and a message you authored in Campfire or Message Board. Each should show the new avatar on the next fetch/refresh. If one of them has a cached older URL in component state, a hard reload clears it.

- [ ] **Step 5: Reset to default**

Back in Settings, the card now shows a "Reset to default" button. Click it. Expected: preview reverts to your Google photo, toast `Reverted to default avatar`. The `Reset` button disappears.

- [ ] **Step 6: Rejection — oversized**

Upload a >5 MB image. Expected: toast `Image exceeds 5 MB limit`; no network call to the bucket.

- [ ] **Step 7: Rejection — non-image**

Rename any `.txt` file to something that tricks you into picking it (e.g., select from the OS picker with "all files" filter if possible, otherwise skip this step — the `accept="image/*"` filter should block it). Expected: toast `Pick an image file (JPEG, PNG, WebP, or GIF)`; no upload.

- [ ] **Step 8: Double upload**

Upload avatar A, then immediately upload avatar B. Expected: preview shows B. Inspect the `avatars/<yourUserId>/` bucket folder via Supabase dashboard — only one file present (the B upload).

- [ ] **Step 9: Persistence across sessions**

Log out and log back in. Expected: custom avatar (or Google photo, depending on what you left it as) persists.

- [ ] **Step 10: Final build check**

Kill dev, then:

```bash
npm run build
npm run test:run
```

Expected: build green, 174 tests pass (no new tests added — this feature relies on manual verification per the spec).

- [ ] **Step 11: No commit**

This is a verification task only. `git status` should be clean.
