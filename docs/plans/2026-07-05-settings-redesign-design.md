# Settings Page Redesign — Users Table + Edit Drawer

**Date:** 2026-07-05 · **Branch:** `Settings` · **Status:** approved direction, ready to implement

## Problem

The admin Settings page mixes four concepts into micro-controls inside a dense
editable table, and admins can't answer "what can this person do?" from any
single place:

1. **The team chip carries membership, per-team role, primary flag, AND account
   type.** The tiny `Mgr/Staff` dropdown inside each chip also offers
   `Agent`/`Client` — picking one silently converts the user's *global* account
   type (SettingsPage `updateTeamRole`). A per-team control mutating a global
   property is the core confusion.
2. **Access is split across three places**: the Admin shield toggle column, the
   per-chip role dropdowns, and the section header the row sits under. The DB
   trigger (migration 010) syncs the global role to the max team role, so
   changing one chip makes users silently jump between the Admins / Managers /
   Staff sections.
3. **Dangerous/opaque affordances**: the Admin column shows `—` (reads as
   empty) but is a one-click grant-full-admin button with no confirmation. The
   primary-team star has no label. Chips save instantly while name/Reports-To
   need a Save button that appears only when dirty.
4. **No search or filters** for a 27-user list with variable-height rows.
5. (Known, out of scope) Invite role/team intent lives in the inviting admin's
   browser localStorage and is lost if another admin approves.

## Design

**The table becomes a read-only summary; all editing moves to a per-user side
drawer** (pattern used by Slack/Notion/Linear/Google Workspace admin panels).
No DB, trigger, or RLS changes — same Supabase write calls, reorganized
presentation. This is what keeps it non-breaking.

### Users table (read-only)

| Column | Content |
|---|---|
| User | avatar + name, email underneath (2-line cell) |
| Type | badge: `Internal` / `Agent` / `Client` |
| Access | badge: `Admin` / `Manager` / `Staff` (global effective role) |
| Teams | primary team first with ★ + `+N` overflow chip |
| Reports to | name only |
| → | chevron; whole row clickable → opens drawer |

- Search box (name / email / team) + Type filter + Team filter above the table.
- Keep the existing role sections (Admins/Managers/Staff/Agents/Clients) and
  collapse controls; add a **Needs setup (N)** section pinned on top for
  team-less users (replaces the scattered yellow rows).
- Manager (non-admin) view keeps its current scope: unassigned users + self.

### Edit drawer (SlidePanel, right side)

Sections top-to-bottom; every control saves immediately with a toast (one save
model, matching current chip behavior):

1. **Identity** — avatar, editable name, read-only email, You / Needs setup
   badges.
2. **Account type** — radio `Internal` / `External`; when External, sub-select
   `Agent` / `Client` with one-line descriptions ("sees only hubs they're
   invited to; no task views; can't create hubs"). Writes `profiles.role`
   directly (sticky externals per migration 038); switching back to Internal
   writes `Staff` so the role-sync trigger resumes. Admins can't be made
   external (existing guard preserved). Per-team role selects are hidden for
   externals.
3. **Access level** (internal users only) — shows the effective badge with an
   honest explanation: *"Manager access comes from team roles below — make
   them a Manager on at least one team."* The only direct control here is
   **Grant/Remove Admin**, now behind a confirm dialog that states what Admin
   can do. This surfaces the 010 auto-sync rule instead of hiding it.
4. **Teams** — one row per membership: team name · role select
   (Staff/Manager; TeamLeader optional, see below) · `Primary` radio (labeled,
   not a bare star) · remove. `+ Add team` select underneath. Same
   add/remove/primary/role write-paths as today, moved verbatim.
5. **Reports to** — existing select (Managers + Admins, no self, no cycles),
   saves on change.
6. **Danger zone** — Delete user (existing confirm modal).

### Non-goals (explicitly unchanged)

- DB schema, role-sync trigger, sticky-external rules, RLS, edge functions.
- Invite flow mechanics (localStorage pending-invite) — logged as a follow-up
  (needs a `pending_invites` table to fix properly).
- Teams card and Invite card layout (minor copy tweaks only).
- Manager-view permission scope.

## Implementation plan

### Phase 1 — pure logic + tests (TDD)
- `src/lib/userAccess.js`: `getAccountType(profile)` → `Internal|Agent|Client`,
  `getAccessLevel(profile)` → `Admin|Manager|Staff`, `summarizeTeams(profileTeams)`
  → `{ primary, others, overflowCount }`, `filterUsers(profiles, {search, teamId, type})`.
- `src/lib/__tests__/userAccess.test.js` covering externals, admins,
  multi-team, unassigned, search matching.

### Phase 2 — extract mutations into a hook
- `src/hooks/useUserAdmin.js`: move `addTeamToUser`, `removeTeamFromUser`,
  `setPrimaryTeam`, `updateTeamRole`, `toggleAdmin`, `updateProfile`,
  `deleteProfile` + invite-pending handling out of `UserRow` **unchanged**
  (copy the bodies; same queries, same toasts, same `user-notify` calls).

### Phase 3 — drawer component
- `src/components/settings/UserDrawer.jsx` using `SlidePanel` +
  `ModalWrapper` (admin-grant confirm). Consumes `useUserAdmin`.

### Phase 4 — table swap
- Simplify `UserRow` to the read-only summary; row click opens drawer.
- Add search + Type/Team filter row; add pinned "Needs setup" section.
- Delete the in-chip role `<select>`, star buttons, Admin toggle cell,
  Reports-To cell, Save button (all now in the drawer).

### Phase 5 — verify
- `npm run test:run` green; `npm run build` clean.
- Manual QA (localhost): as Admin — change type, grant/revoke admin w/ confirm,
  add/remove/primary team, reports-to, rename, delete; as Manager — unassigned
  user setup flow still works; external user drawer hides internal-only
  sections.

### Rollback
Single squash-revert of the `Settings` branch merge; no data migration to
unwind.
