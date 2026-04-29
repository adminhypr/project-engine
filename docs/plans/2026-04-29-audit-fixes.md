# Audit Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the critical security holes, fix the reliability bugs that cause duplicate emails and races, and address the highest-leverage scaling concerns identified in the 2026-04-29 audit.

**Architecture:** Three phases, each independently deployable. Phase 1 (security) and Phase 2 (reliability) are both "this week" work — fix without redesign. Phase 3 is scaling foundations that compound at 500+ users. Phase 4 is parked for later.

**Tech Stack:** Postgres / Supabase RLS migrations, Deno edge functions, React 18 hooks. No new dependencies.

**Branch:** Stay on `card-table` for now (or split into `audit-fixes` if the user prefers — ask before branching).

**Migration numbering:** Continues from 072. Allocated: 073–082.

---

## Phase 1 — Critical Security

### Task 1.1: Migration 073 — Lock down `hub-files` storage bucket

**Why:** `016_custom_hubs.sql:401-409` lets any authenticated user (including external Agents/Clients) read every file in the bucket. This bucket holds card attachments, hub docs, and inline RichInput images from Campfire / message board / todos / cards / DMs.

**Files:**
- Create: `supabase/migrations/073_hub_files_storage_rls.sql`

**Step 1: Write the migration**

```sql
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
immutable
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F-]{36}$'
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
```

**Step 2: Apply locally and verify path conventions**

Read all upload paths to confirm they all use `{hubId}/...`:
- `src/hooks/useHubFiles.js`
- `src/components/ui/RichInput.jsx`
- `src/components/hub/cards/FileAttachments.jsx`
- `src/hooks/useHubTodoAttachments.js`

Run: `grep -rn "from.*hub-files\|hub-files.*upload\|storage.from('hub-files')" src/`

If any path does NOT lead with the hub uuid, that upload will start failing — patch the call site to prepend `${hubId}/`.

**Step 3: Smoke test**

Push migration. From the app:
- As a hub member: upload a card attachment → succeeds, view it → succeeds.
- As a non-member of that hub: try to fetch the signed URL of someone else's attachment → 403.
- As an external (Agent/Client) not in the hub: → 403.

**Step 4: Commit**

```bash
git add supabase/migrations/073_hub_files_storage_rls.sql
git commit -m "fix(security): scope hub-files storage to hub members (audit C1)"
```

---

### Task 1.2: Migration 074 — Block self-insert as hub owner

**Why:** `016:171` allows `profile_id = auth.uid() AND role = 'owner'` self-insert. PK blocks promoting an existing membership but NOT a non-member self-claiming ownership of a hub they were never invited to. Originally added to support hub creation; we keep that path via a creator-only escape.

**Files:**
- Create: `supabase/migrations/074_hub_members_no_self_owner.sql`
- Verify: `src/hooks/useHubs.js` (hub-create path inserts owner row)

**Step 1: Read the hub-create flow**

Run: `grep -n "hub_members\|insert.*hub" src/hooks/useHubs.js`

The owner row is inserted client-side after creating the hub. We need to keep that working without leaving the door open.

**Step 2: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 074 · Restrict hub_members self-insert to fresh-hub creators
--
-- The 016 self-insert escape (profile_id = auth.uid() AND role='owner')
-- lets any authenticated user claim ownership of any hub. Replace with
-- a tighter rule: self-insert as owner is only valid when the hub has
-- ZERO existing members (i.e. it was just created by the caller).
-- ─────────────────────────────────────────────

drop policy if exists "hub_members_insert" on public.hub_members;

create policy "hub_members_insert" on public.hub_members for insert with check (
  -- Hub owner/admin adding someone:
  exists (
    select 1 from public.hub_members hm
     where hm.hub_id = hub_members.hub_id
       and hm.profile_id = auth.uid()
       and hm.role in ('owner', 'admin')
  )
  -- Global Admin:
  or exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'Admin'
  )
  -- Self-insert as owner ONLY when the hub has no members yet (creator path).
  -- Once any row exists, self-insert is no longer possible via this clause.
  or (
    hub_members.profile_id = auth.uid()
    and hub_members.role = 'owner'
    and not exists (select 1 from public.hub_members hm2 where hm2.hub_id = hub_members.hub_id)
  )
);
```

**Step 3: Test in the app**

- Create a new hub → succeeds (creator inserts as owner; no prior rows).
- As a non-member: `supabase.from('hub_members').insert({ hub_id: <existing>, profile_id: self, role: 'owner' })` → 42501 RLS violation.
- Existing hub-add flows (owner adding a member) → unaffected.

**Step 4: Commit**

```bash
git add supabase/migrations/074_hub_members_no_self_owner.sql
git commit -m "fix(security): block hub_members self-insert as owner on existing hubs (audit C2)"
```

---

### Task 1.3: Migration 075 — Verify and tighten `profile_teams` write policies

**Why:** Audit flagged that Settings page calls `update({ role })` and `delete()` on `profile_teams` from the client (`src/pages/SettingsPage.jsx:438,454,460,474`) but no migration grants UPDATE/DELETE to non-admins. Either (a) all callers are Admin/Manager via separate policies, or (b) Staff can self-promote. We verify, then add explicit policies that block the escalation regardless.

**Files:**
- Create: `supabase/migrations/075_profile_teams_write_hardening.sql`
- Audit: `src/pages/SettingsPage.jsx` (lines around 438, 454, 460, 474)

**Step 1: Verify current state with a SQL script**

```sql
-- Run in Supabase SQL editor:
select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  from pg_policy
 where polrelid = 'public.profile_teams'::regclass;
```

Document which policies exist for INSERT / UPDATE / DELETE and to whom.

**Step 2: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 075 · Profile_teams write hardening
--
-- Audit found that the Settings page issues client-side UPDATE/DELETE
-- on profile_teams with no explicit policy granting non-admins. We
-- add explicit, scoped policies and DROP any permissive carry-overs:
--   • UPDATE: Admin global, OR Manager on the team being updated.
--     Caller cannot UPDATE their own row's role (anti-self-promotion).
--   • DELETE: Admin global, OR Manager on the team. Caller cannot
--     DELETE their own row (would orphan team membership).
--   • INSERT: untouched (007/010/013 already cover it).
-- ─────────────────────────────────────────────

-- Drop any permissive UPDATE/DELETE policies that may exist.
drop policy if exists "profile_teams_update" on public.profile_teams;
drop policy if exists "profile_teams_delete" on public.profile_teams;
drop policy if exists "Profile teams update open" on public.profile_teams;
drop policy if exists "Profile teams delete open" on public.profile_teams;

create policy "profile_teams_update" on public.profile_teams
  for update using (
    -- Admin can update anyone's profile_teams row.
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
    or (
      -- Manager on this team can update OTHER users' rows on this team.
      profile_id <> auth.uid()
      and exists (
        select 1 from public.profile_teams self_pt
         where self_pt.profile_id = auth.uid()
           and self_pt.team_id = profile_teams.team_id
           and self_pt.role in ('Manager', 'TeamLeader')
      )
    )
  )
  with check (
    -- Cannot promote yourself via the WITH CHECK side either.
    profile_id <> auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  );

create policy "profile_teams_delete" on public.profile_teams
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
    or (
      profile_id <> auth.uid()
      and exists (
        select 1 from public.profile_teams self_pt
         where self_pt.profile_id = auth.uid()
           and self_pt.team_id = profile_teams.team_id
           and self_pt.role in ('Manager', 'TeamLeader')
      )
    )
  );

-- Belt + suspenders: a BEFORE UPDATE trigger that rejects any role-change
-- on a row where profile_id = auth.uid(), regardless of policy gaps.
create or replace function public.guard_profile_teams_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  is_admin boolean;
begin
  if caller is null then return new; end if; -- service role / triggers
  if old.profile_id <> caller then return new; end if;
  if old.role is not distinct from new.role then return new; end if;

  select (role = 'Admin') into is_admin from public.profiles where id = caller;
  if is_admin then return new; end if;

  raise exception 'guard_profile_teams_self_role_change: cannot change own per-team role'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_guard_profile_teams_self_role on public.profile_teams;
create trigger trg_guard_profile_teams_self_role
  before update on public.profile_teams
  for each row execute function public.guard_profile_teams_self_role_change();
```

**Step 3: Test from a Staff session**

In SQL editor, impersonate a Staff user (or test from the app UI):
- Staff trying to `update profile_teams set role = 'Manager' where profile_id = self` → rejected.
- Manager updating another Staff's role on their team → succeeds.
- Admin updating anyone → succeeds.

**Step 4: Run the existing test suite**

Run: `npm run test:run`
Expected: PASS (no test changes required; this is RLS-level).

**Step 5: Commit**

```bash
git add supabase/migrations/075_profile_teams_write_hardening.sql
git commit -m "fix(security): explicit profile_teams UPDATE/DELETE policies + self-role guard (audit C3)"
```

---

### Task 1.4: Migration 076 — Task chat mention enrol respects task RLS

**Why:** `047_task_chat_mention_enrol.sql:14-57` enrols any internally-mentioned user as a task-chat participant without checking whether they can see the task. An assignee mentioning `@CEO` from another team grants them read access to all chat (which often quotes the task body).

**Files:**
- Create: `supabase/migrations/076_task_chat_mention_visibility_check.sql`

**Step 1: Find the task SELECT visibility predicate**

The cleanest approach is a SECURITY DEFINER helper that mirrors the tasks SELECT RLS predicate. Spec: a user can see a task if any of:
- They are an assignee (`task_assignees`).
- They are the assigner (`tasks.assigned_by`).
- They are global Admin.
- They are Manager on the task's team.
- The assignee reports to them.

Read `011_multi_assignee.sql:60-92` and `039_agentboard_rls.sql:108-141` for the exact predicate, and copy it into the helper.

**Step 2: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 076 · Task-chat mention enrol: gate by task visibility
--
-- Migration 047's auto-enrol trigger force-adds any mentioned internal
-- user as a participant. That bypasses task SELECT RLS — a CEO mentioned
-- in a task chat by a Staff user gains read access to all chat. We add
-- a visibility check before the upsert.
-- ─────────────────────────────────────────────

create or replace function public.can_user_see_task(p_user uuid, p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Assignee
    exists (select 1 from public.task_assignees ta where ta.task_id = p_task and ta.profile_id = p_user)
    -- Assigner
    or exists (select 1 from public.tasks t where t.id = p_task and t.assigned_by = p_user)
    -- Admin
    or exists (select 1 from public.profiles p where p.id = p_user and p.role = 'Admin')
    -- Manager on task's team (any team membership row with Manager role
    -- on the task's team_id):
    or exists (
      select 1
        from public.tasks t
        join public.profile_teams pt
          on pt.team_id = t.team_id
       where t.id = p_task
         and pt.profile_id = p_user
         and pt.role in ('Manager', 'TeamLeader')
    )
    -- Reports-to: any assignee reports to p_user
    or exists (
      select 1
        from public.task_assignees ta
        join public.profiles ap on ap.id = ta.profile_id
       where ta.task_id = p_task
         and ap.reports_to = p_user
    )
$$;

revoke all on function public.can_user_see_task(uuid, uuid) from public;
grant execute on function public.can_user_see_task(uuid, uuid) to authenticated;

-- Replace the 047 trigger function with a visibility-gated version.
create or replace function public.auto_enrol_mentioned_in_task_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_kind text;
  conv_task uuid;
  mentioned_id uuid;
  is_ext boolean;
begin
  select kind, task_id into conv_kind, conv_task
    from public.conversations where id = new.conversation_id;
  if conv_kind is distinct from 'task' or conv_task is null then return new; end if;

  if new.mentions is null or jsonb_typeof(new.mentions) <> 'array' then
    return new;
  end if;

  for mentioned_id in
    select (elem ->> 'user_id')::uuid
      from jsonb_array_elements(new.mentions) elem
     where elem ? 'user_id'
  loop
    if mentioned_id is null then continue; end if;

    -- Skip externals unless already a participant (preserve 047 behavior).
    select public.is_external_user(mentioned_id) into is_ext;
    if is_ext and not exists (
      select 1 from public.conversation_participants
       where conversation_id = new.conversation_id and user_id = mentioned_id
    ) then
      continue;
    end if;

    -- New: skip internal users who can't see the underlying task.
    if not is_ext and not public.can_user_see_task(mentioned_id, conv_task) then
      continue;
    end if;

    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
      values (new.conversation_id, mentioned_id, now() - interval '1 second')
      on conflict do nothing;
  end loop;

  return new;
end;
$$;
```

**Step 3: Smoke test**

- Staff A on team X creates a task assigned to Staff B (also team X). They open the task chat.
- Staff A mentions `@StaffC` (team Y, not assignee, not manager): C should NOT be enrolled.
- Staff A mentions `@StaffB`: already a participant, no-op.
- Manager M on team X mentioned: enrolled (passes manager-on-team check).

**Step 4: Commit**

```bash
git add supabase/migrations/076_task_chat_mention_visibility_check.sql
git commit -m "fix(security): gate task-chat mention enrol by task RLS (audit H1)"
```

---

### Task 1.5: Migration 077 — Restrict `hub-files` MIME types

**Why:** SVGs with embedded `<script>` pass the `RichInput.jsx:157` `image/*` check and execute when opened via signed URL.

**Files:**
- Create: `supabase/migrations/077_hub_files_mime_allowlist.sql`
- Modify: `src/components/ui/RichInput.jsx:157` (defense in depth)

**Step 1: Decide the allow-list**

Audit existing uploads for what types are actually in use:
- Images: png, jpg/jpeg, gif, webp.
- Docs/files: pdf, docx, xlsx, pptx, txt, md, csv, zip — any others users currently upload?

Run a one-off query against `storage.objects` to enumerate current MIME types in `hub-files`:
```sql
select metadata->>'mimetype' as mime, count(*)
  from storage.objects where bucket_id='hub-files'
  group by 1 order by 2 desc;
```

Adjust the list below to cover existing usage.

**Step 2: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 077 · MIME allow-list on hub-files bucket
--
-- Blocks SVG (XSS via <script>), HTML, and other active types.
-- Allow-list covers images, common docs, archives, and audio.
-- Adjust as new file types are needed.
-- ─────────────────────────────────────────────

update storage.buckets
   set allowed_mime_types = array[
     -- Images (NO svg)
     'image/png','image/jpeg','image/jpg','image/gif','image/webp','image/heic','image/heif',
     -- Docs
     'application/pdf',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'text/plain','text/csv','text/markdown',
     -- Archives
     'application/zip','application/x-zip-compressed',
     -- Audio (voice notes, future)
     'audio/mpeg','audio/wav','audio/webm','audio/ogg',
     -- Video (limited)
     'video/mp4','video/webm','video/quicktime'
   ]
 where id = 'hub-files';

-- Same allow-list (minus video/audio) for card-attachments if separate bucket exists.
-- 072 reuses hub-files, so nothing extra needed.
```

**Step 3: Defense-in-depth on the client**

Modify `src/components/ui/RichInput.jsx:157` to explicitly reject `image/svg+xml` (the storage layer will also reject, but a clearer error UX matters):

```javascript
// Line ~157 in RichInput.jsx — replace the existing image-type check:
const BLOCKED_IMAGE_MIME = new Set(['image/svg+xml'])
if (!file.type.startsWith('image/') || BLOCKED_IMAGE_MIME.has(file.type)) {
  showToast('Only PNG/JPG/GIF/WEBP images are allowed', 'error')
  return
}
```

**Step 4: Test**

- Upload a PNG → succeeds.
- Upload an SVG → client toast + (if bypassed) storage 400.

**Step 5: Commit**

```bash
git add supabase/migrations/077_hub_files_mime_allowlist.sql src/components/ui/RichInput.jsx
git commit -m "fix(security): MIME allow-list on hub-files + reject SVG client-side (audit H3)"
```

---

## Phase 2 — Critical Reliability

### Task 2.1: Migration 078 — Notification outbox atomic claim column

**Why:** Both `notification-digest` race conditions (#6 dup emails on overlap, #7 timeout-during-send) require an atomic claim before sending. Add a `claimed_at` column so a row in flight is invisible to other runs.

**Files:**
- Create: `supabase/migrations/078_outbox_claim_column.sql`

**Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 078 · Notification outbox: atomic claim column
--
-- Adds claimed_at to notification_outbox so the digest can claim rows
-- before sending. The 062 partial index is replaced with one that
-- excludes both emailed and recently-claimed rows. Stale claims (older
-- than 10 min, the digest's own timeout budget) are reclaimable.
-- ─────────────────────────────────────────────

alter table public.notification_outbox
  add column if not exists claimed_at timestamptz;

drop index if exists idx_notif_outbox_pending_email;
create index if not exists idx_notif_outbox_pending
  on public.notification_outbox (recipient_id, created_at)
  where emailed_at is null
    and (claimed_at is null or claimed_at < now() - interval '10 minutes');

-- Helper: reset abandoned claims (used by the digest as its first step).
create or replace function public.reset_stale_outbox_claims()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  update public.notification_outbox
     set claimed_at = null
   where emailed_at is null
     and claimed_at is not null
     and claimed_at < now() - interval '10 minutes'
  returning 1
$$;
```

**Step 2: Commit**

```bash
git add supabase/migrations/078_outbox_claim_column.sql
git commit -m "feat(reliability): outbox claim column + stale-claim reset helper (audit #6/#7)"
```

---

### Task 2.2: Edge function — `notification-digest` atomic claim + concurrent send

**Why:** Eliminate duplicate emails on overlap (#6) and stop timing out at 120+ recipients (#7).

**Files:**
- Modify: `supabase/functions/notification-digest/index.ts:240-308`

**Step 1: Write the new dispatch logic**

Replace the body of the recipient-fan-out section (the `for (const [recipientId, rows] ...)` loop) with:

```typescript
// Step 0: Reset any stale claims left by a crashed prior run.
await supabase.rpc('reset_stale_outbox_claims')

// Step 1: Atomically claim the rows we plan to email. A second concurrent
// digest run will see them as claimed and skip them.
const allRowIds = pending.map((r) => r.id)
const { data: claimed, error: claimErr } = await supabase
  .from('notification_outbox')
  .update({ claimed_at: new Date().toISOString() })
  .in('id', allRowIds)
  .is('claimed_at', null)
  .is('emailed_at', null)
  .select('id, recipient_id')
if (claimErr) {
  return new Response(JSON.stringify({ error: claimErr.message }), { status: 500, headers: cors })
}
const claimedIds = new Set((claimed || []).map((r: any) => r.id))

// Re-bucket only the claimed rows.
const claimedByRecipient: Record<string, OutboxRow[]> = {}
for (const r of pending) {
  if (!claimedIds.has(r.id)) continue
  ;(claimedByRecipient[r.recipient_id] ||= []).push(r)
}

// Step 2: Build per-recipient send tasks.
const offlineCutoff = new Date(Date.now() - OFFLINE_WINDOW_MINUTES * 60 * 1000)
let sent = 0, skipOnline = 0, skipOptedOut = 0, skipNoEmail = 0, failed = 0

type SendJob = { recipientId: string; rows: OutboxRow[]; prof: RecipientProfile }
const sendJobs: SendJob[] = []
const skipRowIds: string[] = []

for (const [recipientId, rows] of Object.entries(claimedByRecipient)) {
  const prof = profileById.get(recipientId)
  if (!prof) {
    // Mark these as emailed so we don't keep retrying — recipient is gone.
    skipRowIds.push(...rows.map((r) => r.id))
    continue
  }
  if (!prof.email) { skipNoEmail++; skipRowIds.push(...rows.map((r) => r.id)); continue }
  if (!prof.email_digest_enabled) { skipOptedOut++; skipRowIds.push(...rows.map((r) => r.id)); continue }
  const lastSeen = prof.last_seen_at ? new Date(prof.last_seen_at) : null
  const isOnline = lastSeen !== null && lastSeen > offlineCutoff
  if (isOnline) { skipOnline++; skipRowIds.push(...rows.map((r) => r.id)); continue }
  sendJobs.push({ recipientId, rows, prof })
}

// Step 3: Mark all skip rows as emailed in one batch (idempotent skip).
if (skipRowIds.length > 0) {
  await supabase
    .from('notification_outbox')
    .update({ emailed_at: new Date().toISOString() })
    .in('id', skipRowIds)
}

// Step 4: Send emails with a concurrency cap.
const CONCURRENCY = 8
async function runJob(job: SendJob) {
  const { subject, html } = renderDigestHtml(job.rows, job.prof.full_name || '')
  const ok = await sendEmail(job.prof.email!, subject, html)
  if (ok) {
    sent++
    await supabase
      .from('notification_outbox')
      .update({ emailed_at: new Date().toISOString() })
      .in('id', job.rows.map((r) => r.id))
  } else {
    failed++
    // Release the claim so the next tick retries.
    await supabase
      .from('notification_outbox')
      .update({ claimed_at: null })
      .in('id', job.rows.map((r) => r.id))
  }
}

const queue = sendJobs.slice()
const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  while (queue.length > 0) {
    const job = queue.shift()
    if (!job) return
    try { await runJob(job) } catch (e) { console.error('digest send failed:', e); failed++ }
  }
})
await Promise.all(workers)

return new Response(
  JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - startedAt,
    considered: pending.length,
    claimed: claimedIds.size,
    sent,
    failed,
    skipped: { online: skipOnline, opted_out: skipOptedOut, no_email: skipNoEmail },
  }),
  { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
)
```

**Step 2: Local syntax check**

Run: `cd supabase/functions/notification-digest && deno check index.ts`
Expected: no errors.

**Step 3: Deploy and observe**

```bash
supabase functions deploy notification-digest
```

Trigger manually via a CLI test (with the shared secret once Task 2.5 lands) and confirm:
- One run, 50 offline users → ~5–8s elapsed (vs. ~25s+ before).
- Two runs simultaneously → second sees `claimed: 0`.

**Step 4: Commit**

```bash
git add supabase/functions/notification-digest/index.ts
git commit -m "fix(reliability): notification-digest atomic claim + concurrent send (audit #6/#7)"
```

---

### Task 2.3: Edge function — `spawn-recurring-tasks` advisory lock + transactional advance

**Why:** Without an advisory lock, a crash between INSERT and `next_run_at` advance, or a slow run overlapping the next cron tick, spawns duplicate tasks (#8).

**Files:**
- Modify: `supabase/functions/spawn-recurring-tasks/index.ts:125-200` (the `spawnOne` function)
- Create: `supabase/migrations/079_recurrence_atomic_spawn.sql` (RPC that does insert + advance in one call)

**Step 1: Write the SQL RPC**

```sql
-- ─────────────────────────────────────────────
-- 079 · Atomic recurring-task spawn
--
-- Wraps the task INSERT + task_assignees seed + next_run_at advance in
-- one server-side function so the spawn-recurring-tasks edge function
-- can no longer leave a half-applied state on crash. Includes a
-- pg_try_advisory_xact_lock to serialize concurrent spawns of the same
-- template.
-- ─────────────────────────────────────────────

create or replace function public.spawn_recurrence(
  p_recurrence_id uuid,
  p_task_id_str text,
  p_due_date timestamptz,
  p_assignees jsonb,        -- [{profile_id, is_primary}]
  p_creator uuid
)
returns uuid                -- new task uuid, or null if locked / not due
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.task_recurrences%rowtype;
  primary_id uuid;
  new_task_id uuid;
  next_run timestamptz;
begin
  -- Per-template advisory lock for the duration of this transaction.
  if not pg_try_advisory_xact_lock(hashtext(p_recurrence_id::text)) then
    return null;
  end if;

  select * into rec from public.task_recurrences where id = p_recurrence_id for update;
  if not found or not rec.is_active then return null; end if;
  if rec.next_run_at > now() then return null; end if;

  primary_id := coalesce(
    (select (elem ->> 'profile_id')::uuid
       from jsonb_array_elements(p_assignees) elem
      where (elem ->> 'is_primary')::boolean = true limit 1),
    (select (elem ->> 'profile_id')::uuid from jsonb_array_elements(p_assignees) elem limit 1)
  );

  insert into public.tasks (
    task_id, title, notes, icon, urgency, due_date,
    assigned_to, assigned_by, assignment_type, team_id,
    status, date_assigned, recurrence_id
  ) values (
    p_task_id_str, rec.template_title, rec.template_notes, rec.template_icon,
    rec.template_urgency, p_due_date, primary_id, rec.created_by, 'Self',
    rec.team_id, 'Not Started', now(), rec.id
  )
  returning id into new_task_id;

  insert into public.task_assignees (task_id, profile_id, is_primary)
    select new_task_id,
           (elem ->> 'profile_id')::uuid,
           (elem ->> 'is_primary')::boolean
      from jsonb_array_elements(p_assignees) elem;

  next_run := public.compute_next_recurrence_run(rec.anchor_at, rec.interval_unit, rec.interval_every);
  update public.task_recurrences set next_run_at = next_run where id = rec.id;

  insert into public.task_audit_log (task_id, event_type, performed_by, new_value, note)
    values (new_task_id, 'recurring_spawned', rec.created_by, rec.id::text,
            'Spawned from recurring template: ' || rec.template_title);

  insert into public.task_recurrence_audit (recurrence_id, event_type, performed_by, note)
    values (rec.id, 'spawned', rec.created_by, 'Spawned task ' || new_task_id::text);

  return new_task_id;
end;
$$;

revoke all on function public.spawn_recurrence(uuid, text, timestamptz, jsonb, uuid) from public;
-- Service role calls this; no grant needed for authenticated.
```

**Step 2: Update the edge function to use the RPC**

Replace the body of `spawnOne` (`spawn-recurring-tasks/index.ts:125-200`) with a single `rpc('spawn_recurrence', ...)` call:

```typescript
async function spawnOne(rec: any) {
  const validAssignees = await pickValidAssignees(rec)  // unchanged earlier code
  if (validAssignees.length === 0) {
    // unchanged: deactivate template, audit, ping notify
    return { ok: false, reason: 'no valid assignees — deactivated' }
  }

  const dueDate = new Date(Date.now() + rec.template_due_offset_hours * 3600 * 1000).toISOString()
  const taskIdStr = generateTaskId()

  const { data: spawnedId, error: spawnErr } = await supabase
    .rpc('spawn_recurrence', {
      p_recurrence_id: rec.id,
      p_task_id_str: taskIdStr,
      p_due_date: dueDate,
      p_assignees: validAssignees.map((a) => ({ profile_id: a.profile_id, is_primary: a.is_primary })),
      p_creator: rec.created_by,
    })

  if (spawnErr) return { ok: false, reason: `spawn rpc: ${spawnErr.message}` }
  if (!spawnedId) return { ok: false, reason: 'locked or not due' }

  return { ok: true, taskId: spawnedId }
}
```

**Step 3: Verify locally**

`deno check supabase/functions/spawn-recurring-tasks/index.ts`

**Step 4: Deploy + smoke test**

- Set `is_active=true` on a template with `next_run_at = now()`. Trigger the function twice quickly. Expect: ONE task spawned, second call returns `locked or not due`.

**Step 5: Commit**

```bash
git add supabase/migrations/079_recurrence_atomic_spawn.sql supabase/functions/spawn-recurring-tasks/index.ts
git commit -m "fix(reliability): atomic recurring-task spawn with advisory lock (audit #8)"
```

---

### Task 2.4: Migration 080 — DM email debounce uniqueness

**Why:** `dm-offline-notify` debounce is non-atomic; two parallel runs both pass the SELECT-then-INSERT check and double-send (#9).

**Files:**
- Create: `supabase/migrations/080_dm_email_log_unique.sql`
- Modify: `supabase/functions/dm-offline-notify/index.ts:96-111` (use ON CONFLICT)

**Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 080 · DM email debounce uniqueness
--
-- The dm-offline-notify function checks dm_email_log then inserts later;
-- two parallel runs both pass the check. Add a unique constraint scoped
-- to (recipient, conversation, time_bucket) so the second insert fails
-- and the second sender skips. Bucket = 15-min window (date_trunc).
-- ─────────────────────────────────────────────

alter table public.dm_email_log
  add column if not exists time_bucket timestamptz
    generated always as (date_trunc('minute', sent_at) - (extract(minute from sent_at)::int % 15) * interval '1 minute') stored;

-- If the table has historic rows, dedupe before adding the unique index.
delete from public.dm_email_log a
 using public.dm_email_log b
 where a.ctid > b.ctid
   and a.recipient_id = b.recipient_id
   and a.conversation_id = b.conversation_id
   and a.time_bucket = b.time_bucket;

create unique index if not exists uq_dm_email_log_debounce
  on public.dm_email_log (recipient_id, conversation_id, time_bucket);
```

**Step 2: Update the function to use ON CONFLICT**

In `supabase/functions/dm-offline-notify/index.ts:143` (the post-send INSERT into `dm_email_log`), use `upsert` with `onConflict: 'recipient_id,conversation_id,time_bucket'` and `ignoreDuplicates: true`. If the upsert reports zero rows inserted, treat as already-sent and skip Resend on the next iteration.

Better: claim BEFORE sending. Restructure to:
1. Try INSERT into `dm_email_log` with `(recipient_id, conversation_id, time_bucket = now-bucket)`.
2. On conflict: another worker already claimed → skip.
3. On success: Resend; on Resend failure, DELETE the claim row to allow retry next tick.

**Step 3: Test**

- Run two cron triggers within 60s. Confirm only one email per (recipient, conversation, 15-min bucket).

**Step 4: Commit**

```bash
git add supabase/migrations/080_dm_email_log_unique.sql supabase/functions/dm-offline-notify/index.ts
git commit -m "fix(reliability): atomic DM email debounce via unique time-bucket (audit #9)"
```

---

### Task 2.5: Edge function auth hardening — make webhook secret mandatory + add to digest/spawn

**Why:** `_shared/security.ts:55-58` soft-fails open. `notification-digest` and `spawn-recurring-tasks` have no auth at all. Anyone with the URL can trigger arbitrary email blasts or task spawns (#10).

**Files:**
- Modify: `supabase/functions/_shared/security.ts:50-64`
- Modify: `supabase/functions/notification-digest/index.ts` (add secret check)
- Modify: `supabase/functions/spawn-recurring-tasks/index.ts` (add secret check)
- Update: `supabase/migrations/063_schedule_notification_digest.sql` (regenerate cron call to include header) — or add a follow-up migration `081_cron_jobs_use_webhook_secret.sql`

**Step 1: Make the secret mandatory in `verifyWebhookSecret`**

Edit `_shared/security.ts:50-64`:

```typescript
export function verifyWebhookSecret(req: Request): boolean {
  const expected = Deno.env.get('WEBHOOK_SHARED_SECRET')
  if (!expected) {
    console.error('[security] WEBHOOK_SHARED_SECRET is not set — rejecting request. Set the env var.')
    return false   // strict from now on
  }
  const got = req.headers.get('x-webhook-secret')
  if (!got) return false
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}
```

**Step 2: Add the check to `notification-digest`**

In `notification-digest/index.ts` near the top of the request handler (just after `if (req.method === 'OPTIONS') ...`):

```typescript
if (!verifyWebhookSecret(req)) {
  return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: cors })
}
```

Same in `spawn-recurring-tasks/index.ts`.

**Step 3: Update the cron jobs to send the header**

Create `supabase/migrations/081_cron_jobs_use_webhook_secret.sql`:

```sql
-- ─────────────────────────────────────────────
-- 081 · pg_cron jobs send X-Webhook-Secret on edge invocations
--
-- Pairs with the strict secret check in _shared/security.ts. We
-- unschedule the existing jobs and re-schedule them with the secret
-- header. The secret is read from current_setting('app.webhook_secret')
-- — set this on the database via:
--   alter database postgres set app.webhook_secret = '<value>';
-- ─────────────────────────────────────────────

-- notification-digest (every 15 min) — pairs with 063
select cron.unschedule('notification-digest-job');

select cron.schedule(
  'notification-digest-job',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notification-digest',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'X-Webhook-Secret', current_setting('app.webhook_secret', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- spawn-recurring-tasks (hourly) — pairs with 059
select cron.unschedule('spawn-recurring-tasks-job');

select cron.schedule(
  'spawn-recurring-tasks-job',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/spawn-recurring-tasks',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'X-Webhook-Secret', current_setting('app.webhook_secret', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- dm-offline-notify and send-alerts: same pattern, follow-up if not already updated.
```

> **Manual step:** Set `WEBHOOK_SHARED_SECRET` in Supabase function secrets AND `app.webhook_secret` on the database. They MUST match. Coordinate the cutover: deploy the edge function with strict mode, then set both secrets, THEN apply the cron migration. If you flip strict before the secret is set, cron calls 403 until you fix it.

**Step 4: Commit**

```bash
git add supabase/functions/_shared/security.ts \
        supabase/functions/notification-digest/index.ts \
        supabase/functions/spawn-recurring-tasks/index.ts \
        supabase/migrations/081_cron_jobs_use_webhook_secret.sql
git commit -m "fix(security): mandatory webhook secret on cron-driven edge functions (audit #10)"
```

---

## Phase 3 — High-priority scaling

### Task 3.1: Migration 082 — Outbox retention + claim-on-skip

**Why:** Online and opted-out users currently leave outbox rows un-emailed forever (#H1). The 062 partial index keeps growing. Already partially addressed in Task 2.2 (skip path now sets `emailed_at`); add a 30-day prune cron for completed rows.

**Files:**
- Create: `supabase/migrations/082_outbox_retention.sql`

**Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 082 · Outbox retention
--
-- Notification rows older than 30 days that have been emailed (or
-- skipped) are pruned. Runs nightly. Also prunes task_audit_log and
-- hub_card_audit_log rows older than 1 year — adjustable.
-- ─────────────────────────────────────────────

create or replace function public.prune_notification_outbox()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.notification_outbox
     where emailed_at is not null
       and emailed_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::int from deleted
$$;

create or replace function public.prune_task_audit_log()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.task_audit_log
     where created_at < now() - interval '1 year'
    returning 1
  )
  select count(*)::int from deleted
$$;

create or replace function public.prune_hub_card_audit_log()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.hub_card_audit_log
     where created_at < now() - interval '180 days'
    returning 1
  )
  select count(*)::int from deleted
$$;

-- Schedule nightly at 03:15 UTC.
select cron.schedule(
  'prune-notification-outbox',
  '15 3 * * *',
  $$select public.prune_notification_outbox();$$
);

select cron.schedule(
  'prune-task-audit-log',
  '30 3 * * *',
  $$select public.prune_task_audit_log();$$
);

select cron.schedule(
  'prune-hub-card-audit-log',
  '45 3 * * *',
  $$select public.prune_hub_card_audit_log();$$
);
```

**Step 2: Commit**

```bash
git add supabase/migrations/082_outbox_retention.sql
git commit -m "feat(scaling): outbox + audit log retention via nightly prune (audit H1)"
```

---

### Task 3.2: Frontend — namespace realtime channel names

**Why:** Static channel names (`tasks-realtime`, `task-assignees-realtime`, `task-recurrences-realtime`, `comments-notif`, `profiles-admin-notif`, `hub-invite-notif`) collide under StrictMode/HMR. `removeChannel` on shared name tears down the live one.

**Files:**
- Modify: `src/hooks/useTasks.jsx:317,348` (channel names)
- Modify: `src/hooks/useRecurrences.js:88`
- Modify: `src/components/notifications/NotificationBell.jsx:263,292,333`
- Modify: `src/hooks/useMentionNotifications.js:120,144`

**Step 1: Find a stable per-instance ID**

Use the profile id where available (`useAuth().profile.id`) and fall back to a `useId()` hook for component-scoped identity. Example pattern:

```javascript
const profileId = profile?.id ?? 'anon'
const channel = supabase.channel(`tasks-realtime:${profileId}`)
```

For NotificationBell, namespace by both profile id AND a hook instance id:
```javascript
const instanceId = useId()
supabase.channel(`comments-notif:${profileId}:${instanceId}`)
```

**Step 2: Apply across the four hooks**

Audit grep first: `grep -rn "supabase.channel(['\"]" src/hooks src/components` to confirm all static-name channels.

Modify each call to interpolate the profile id (and instance id where reentry is possible).

**Step 3: Verify**

- `npm run dev` with React StrictMode on (already on by default in `main.jsx`). Open `/my-tasks`. Console should NOT show "subscription closed" loops.
- Manually toggle to a different page and back. Subscriptions should re-mount cleanly.

**Step 4: Run tests**

`npm run test:run` — pass.

**Step 5: Commit**

```bash
git add src/hooks/useTasks.jsx src/hooks/useRecurrences.js src/hooks/useMentionNotifications.js src/components/notifications/NotificationBell.jsx
git commit -m "fix(realtime): namespace channel names by profile id (audit #FE-channels)"
```

---

### Task 3.3: Frontend — cancellation flags for rapid-switch fetches

**Why:** `useConversation.js:39-49` and `useHubMessages.js:38-43` can land stale state when a user rapidly switches conversations.

**Files:**
- Modify: `src/hooks/useConversation.js:39-49`
- Modify: `src/hooks/useHubMessages.js:38-43`

**Step 1: Add a cancellation flag pattern (matches `useHubChat.js:71-78`)**

```javascript
useEffect(() => {
  let cancelled = false
  ;(async () => {
    setLoading(true)
    const { data, error } = await supabase.from(...).select(...)
    if (cancelled) return
    if (error) { setLoading(false); return }
    setMessages(data ?? [])
    setLoading(false)
  })()
  return () => { cancelled = true }
}, [conversationId])
```

Apply identically to `useHubMessages.js`.

**Step 2: Add a regression test**

`src/hooks/__tests__/useConversation.cancellation.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest'
// Construct a mocked Supabase client that delays the first response and
// verify rapid prop changes don't land the stale fetch's setMessages.
// (Skeleton — fill in based on existing hook test patterns if any exist.)
```

**Step 3: Run tests**

`npm run test:run`

**Step 4: Commit**

```bash
git add src/hooks/useConversation.js src/hooks/useHubMessages.js src/hooks/__tests__/useConversation.cancellation.test.js
git commit -m "fix(hooks): cancel stale fetches on rapid conversation switch"
```

---

### Task 3.4: Migration 083 — `is_task_visible` SECURITY DEFINER helper for tasks RLS

**Why:** Tasks SELECT RLS re-executes 4 EXISTS subqueries per row. At 100k+ tasks this table-scans. Replace with a SECURITY DEFINER STABLE helper.

**Files:**
- Create: `supabase/migrations/083_tasks_rls_helper.sql`

**Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 083 · is_task_visible helper + RLS rewrite
--
-- Replaces the inline EXISTS-soup in the tasks SELECT policy with a
-- single SECURITY DEFINER STABLE function call. Postgres caches STABLE
-- function results within a query, so the per-row cost drops from
-- "4 subqueries per row" to "1 cached call per (caller, row) pair".
-- ─────────────────────────────────────────────

-- Use the visibility predicate from migration 076 — same logic.
-- (Already created as can_user_see_task in 076; alias for clarity.)

create or replace function public.is_task_visible(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_user_see_task(auth.uid(), p_task)
$$;

revoke all on function public.is_task_visible(uuid) from public;
grant execute on function public.is_task_visible(uuid) to authenticated;

-- Replace the SELECT policies introduced in 011 + 039 with one helper-backed
-- policy. Drop the legacy ones first.
drop policy if exists "tasks_select_policy" on public.tasks;
drop policy if exists "tasks_select_assignees" on public.tasks;
drop policy if exists "tasks_select_external" on public.tasks;

create policy "tasks_select" on public.tasks for select
  using (public.is_task_visible(id));
```

> **Care:** Names of existing policies to drop must match what's actually in the database. Run this first:
> ```sql
> select polname from pg_policy where polrelid = 'public.tasks'::regclass and polcmd = 'r';
> ```
> Adjust the `drop policy` lines accordingly before applying.

**Step 2: Benchmark before/after**

Run `EXPLAIN ANALYZE select * from tasks limit 50` as a typical user before and after applying. Expect the helper version to short-circuit faster.

**Step 3: Test all role views**

In the app:
- Staff sees own tasks + assigned tasks.
- Manager sees own team tasks.
- Admin sees all.
- Externals see only tasks in hubs they're in (already gated by 039 — verify the helper preserves this).

**Step 4: Commit**

```bash
git add supabase/migrations/083_tasks_rls_helper.sql
git commit -m "perf(rls): is_task_visible helper-backed tasks SELECT policy (audit #DB-RLS-cost)"
```

---

### Task 3.5: Edge functions — Resend retry/error handling

**Why:** Resend errors are silently swallowed across all email functions; no retry, no DLQ, no 4xx vs 5xx distinction.

**Files:**
- Modify: `supabase/functions/_shared/email.ts` (or wherever `sendEmail` lives — find it first)
- Modify: callers in `notify`, `send-alerts`, `dm-offline-notify`, `notification-digest`, `hub-mention-notify`

**Step 1: Locate and read the current sender**

`grep -rn "sendEmail\|fetch.*resend\|api.resend" supabase/functions/` — find the canonical path.

**Step 2: Add retry + classification**

Pseudo:

```typescript
type SendResult = { ok: true; id: string } | { ok: false; retryable: boolean; status: number; error: string }

export async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')!
  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (resp.ok) {
      const body = await resp.json()
      return { ok: true, id: body.id }
    }
    const status = resp.status
    const text = await resp.text()
    // 4xx (except 429) — permanent. Don't retry.
    if (status >= 400 && status < 500 && status !== 429) {
      return { ok: false, retryable: false, status, error: text }
    }
    // 429 / 5xx — back off and retry.
    if (attempt < 3) await new Promise((r) => setTimeout(r, 250 * attempt * attempt))
  }
  return { ok: false, retryable: true, status: 0, error: 'exhausted retries' }
}
```

**Step 3: Update callers**

- `notification-digest`: on `result.ok === false && retryable`, release the claim (already does); on permanent failure, set `emailed_at` to mark as dead-lettered (with a `email_failure_reason` column — add via a small migration).
- `dm-offline-notify`: on permanent failure, mark the queue row failed; on retryable, leave for next tick.
- `notify`: on permanent failure, log + write a `notify_failures` row (add table) for ops visibility.

**Step 4: Commit per function**

Do this in 2-3 small commits to keep diffs reviewable:
- `email.ts` shared helper.
- Migration adding `email_failure_reason` columns / `notify_failures` table.
- One commit per consuming function.

---

### Task 3.6: Frontend — heartbeat reliability + lower write rate

**Why:** Per-tab 60s `update profiles` writes hit `sync_effective_role` and 042 self-update guard triggers. At 1000 active users that's 16 writes/sec on a hot table.

**Files:**
- Create: `supabase/migrations/084_heartbeat_rpc.sql` — narrow RPC that updates only `last_seen_at`, bypassing the heavy triggers.
- Modify: `src/hooks/useAuth.jsx:308-330` — call the RPC instead of `update`. Add `sendBeacon` on `pagehide`.

**Step 1: Migration**

```sql
-- ─────────────────────────────────────────────
-- 084 · Narrow heartbeat RPC
--
-- Replaces the per-tab UPDATE on profiles with a thin SECURITY DEFINER
-- function that updates only last_seen_at. Avoids re-running
-- sync_effective_role and the 042 self-update guard trigger 16x/sec at
-- 1000 active users.
-- ─────────────────────────────────────────────

create or replace function public.heartbeat()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

revoke all on function public.heartbeat() from public;
grant execute on function public.heartbeat() to authenticated;
```

> Note: this function still triggers `sync_effective_role` because it does an UPDATE on `profiles`. To avoid that, move `last_seen_at` to a separate `profile_presence` table:
>
> ```sql
> create table if not exists public.profile_presence (
>   profile_id uuid primary key references public.profiles(id) on delete cascade,
>   last_seen_at timestamptz not null default now()
> );
> -- Backfill from profiles.last_seen_at, then update digest function to read here.
> ```
>
> If we go that route, also update `notification-digest` to read `profile_presence.last_seen_at`. Decide before implementing — the table split is the better long-term design.

**Step 2: Frontend changes**

In `useAuth.jsx:308-330`, replace the `update` with `supabase.rpc('heartbeat')` and add a `pagehide` handler that uses `navigator.sendBeacon` to a tiny edge function (or just fires-and-forgets the RPC — sendBeacon needs HTTP not Supabase JS, so might need a thin edge function endpoint).

**Step 3: Commit**

```bash
git add supabase/migrations/084_heartbeat_rpc.sql src/hooks/useAuth.jsx
git commit -m "perf(auth): narrow heartbeat RPC + sendBeacon on pagehide (audit #FE-heartbeat)"
```

---

### Task 3.7: Toast spam dedupe + transient retry

**Why:** A 5s Supabase blip stacks 15 toasts. Add a global short dedupe window in `showToast`.

**Files:**
- Modify: `src/components/ui/index.jsx` (find `showToast`)

**Step 1: Add a 1.5s dedupe by `(message, type)`**

```javascript
const recentToasts = new Map()  // key: `${type}:${message}`, value: timestamp

export function showToast(message, type = 'info') {
  const key = `${type}:${message}`
  const now = Date.now()
  const last = recentToasts.get(key)
  if (last && now - last < 1500) return  // dedupe
  recentToasts.set(key, now)
  // ...existing DOM creation...
}
```

**Step 2: Commit**

```bash
git add src/components/ui/index.jsx
git commit -m "fix(ux): dedupe rapid identical toasts (audit #UX-toast-spam)"
```

---

## Phase 4 — Future-proofing (parked)

These are real but require larger redesigns or product input. Track as separate plans when prioritized:

- **`useRealtimeQuery` helper.** Collapse 25 hooks into one abstraction. Refactor risk — defer.
- **TypeScript / zod boundary validation.** Significant uplift; high value once 1000-user pain hits. Plan separately.
- **Bundle splitting.** Route-split Recharts (Reports/Admin only); lazy-load TipTap inside ChatWidget on first focus. Single afternoon's work — file as a follow-up plan.
- **Sentry rollout completion.** See `~/.claude/projects/.../memory/sentry_pickup.md` for the exact next step.
- **CI: GitHub Actions running `npm run test:run` on PRs.** 10-line workflow; queue once we have a stable green test base.
- **Storage quotas.** Per-user / per-hub caps. Requires product-level decision.
- **Rate limiting.** Postgres triggers or app-level via a Redis sidecar. Defer until abuse is observed.
- **Component splits** (`TaskDetailPanel.jsx`, `useTasks.jsx` god-hook). Refactor risk; do incrementally as features touch them.
- **Realtime row-level filters** (`filter: profile_id=eq.X` on Supabase channels). Requires verifying each subscription's filter is correct under RLS. Higher-value once we exceed ~50 concurrent.

---

## Execution checklist

For each task:
- [ ] Read the existing code/migration referenced.
- [ ] Apply the change.
- [ ] Run the smoke test described.
- [ ] Run `npm run test:run` — must stay green.
- [ ] Commit with the message provided.
- [ ] Push only when the user says so.

**Order of execution:** strictly Phase 1 → Phase 2 → Phase 3. Inside a phase, tasks are mostly independent but some depend on each other (e.g., Task 1.4 reuses `can_user_see_task` which Task 3.4 also reuses; do 1.4 first).

**Rollback strategy:** every migration is forward-only but small enough to revert with a follow-up migration if a problem surfaces in prod. Keep an eye on logs after each deploy.
