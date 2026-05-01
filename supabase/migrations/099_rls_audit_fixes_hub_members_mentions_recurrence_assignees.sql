-- ─────────────────────────────────────────────
-- 099 · RLS audit fixes (3 latent bugs surfaced after 097/098)
--
-- Comprehensive RLS audit run after 097 + 098 surfaced 3 more
-- latent regressions of the same two bug shapes. None had been
-- reported by users yet but all would silently fail under realistic
-- usage. Fixing pre-emptively before they bite.
--
-- 1. hub_members SELECT — Bug A (STABLE-snapshot blocks INSERT-RETURNING)
--    is_hub_member(hub_id) is STABLE and reads hub_members. When a
--    non-Admin user does the "claim ownership on a brand-new hub"
--    self-insert (the create_hub_with_owner RPC bypasses RLS, but
--    any direct client-side INSERT path still hits this), the just-
--    inserted row's hub_member visibility check fails because the
--    STABLE helper uses the pre-INSERT snapshot. Fix: add an
--    `OR profile_id = auth.uid()` branch so every member can SELECT
--    their own membership row directly via the row's own column —
--    no STABLE-helper traversal needed.
--
-- 2. hub_mentions SELECT — Bug A variant (inserter ≠ row's "owner")
--    Insert WITH CHECK requires `mentioned_by = auth.uid()`. SELECT
--    USING only allowed `mentioned_user = auth.uid()`. So the
--    inserter (the @mentioner) can never SELECT-after-INSERT their
--    own row → 100% of `.insert(...).select()` calls 42501. Email
--    + bell still fire (writes succeed) but the JS hook treats it
--    as a failure. Fix: `OR mentioned_by = auth.uid()`.
--
-- 3. task_recurrence_assignees INSERT — Bug B (parity gap with task_assignees)
--    Required Admin / creator / Manager-on-team. task_assignees_insert
--    is permissive (`auth.role()='authenticated' AND NOT external`).
--    A Manager who can EDIT a recurring template they didn't create
--    (e.g., re-delegated by Admin) couldn't add assignees. Same
--    cross-team Manager bug class as 098.
--    Fix: match tasks_insert parity. UPDATE/DELETE remain restrictive
--    so an over-eager Manager can't EDIT a roster they shouldn't
--    manage long-term.
-- ─────────────────────────────────────────────

-- ── 1. hub_members SELECT — self-row escape ────────────────
drop policy if exists "hub_members_select" on public.hub_members;

create policy "hub_members_select" on public.hub_members for select
  using (
    -- Member can always see their OWN row (escapes the STABLE-snapshot
    -- bug in is_hub_member when this row is the just-inserted one).
    profile_id = auth.uid()
    -- Other rows in hubs the caller is a member of.
    or public.is_hub_member(hub_id)
    -- Global Admin sees everything.
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  );

-- ── 2. hub_mentions SELECT — inserter (mentioned_by) escape ──
drop policy if exists "hub_mentions_select" on public.hub_mentions;

create policy "hub_mentions_select" on public.hub_mentions for select
  using (
    -- Recipient (the @mentioned user).
    mentioned_user = auth.uid()
    -- Inserter (the @mentioner) — fixes INSERT-RETURNING failures
    -- in RichInput / Campfire / MessageBoard / TodoComments.
    or mentioned_by = auth.uid()
    -- Global Admin.
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  );

-- ── 3. task_recurrence_assignees INSERT — match task_assignees parity ──
drop policy if exists task_recurrence_assignees_insert on public.task_recurrence_assignees;

create policy task_recurrence_assignees_insert on public.task_recurrence_assignees
  for insert
  with check (
    auth.role() = 'authenticated'
    and not coalesce(public.is_external_user(auth.uid()), false)
  );
