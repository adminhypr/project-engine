# Agentboard — External Account Types (Agent & Client)

**Branch:** `agentboard`
**Date:** 2026-04-21
**Status:** Design approved, ready for implementation plan

## Goal

Introduce two new restricted account types — **Agent** (external VAs, cold callers, EAs) and **Client** (customers) — so external collaborators can participate inside Project Engine without gaining access to the internal task-management surface.

Today the app serves only internal support staff. Agents and clients need a narrow, safe slice: hub participation, to-do work, and a single pod-scoped team chat.

---

## Section 1 — Data Model

### New global roles (`profiles.role`)

- `Agent` — external contractor
- `Client` — external customer

Both sit **outside** the `Admin > Manager > Staff` authority ladder — they're account *types*, not seniority levels.

The existing `role_rank()` trigger that auto-syncs `profiles.role` to the max across `profile_teams.role` must be updated so that `Agent` and `Client` are **sticky** (same treatment as `Admin`): being Staff on any team never overwrites an Agent/Client global role.

### New per-team role (`profile_teams.role`)

- `TeamLeader` — rank between Manager and Staff. Designates the pod lead for a team.

### Team = pod

A team contains Manager(s), Team Leader(s), Agent(s), and typically one Client. Team membership for externals goes through `profile_teams` as usual; their `profile_teams.role` is set to `'Agent'` or `'Client'` (purely descriptive — their **global role** is what gates everything).

### Hub membership for externals

Explicit only. Adding an agent to a team does **not** auto-add them to that team's hubs. They're invited to specific hubs via the existing `hub_members` flow. Matches the existing pattern for custom (non-team) hubs.

### Migration 030

- Extend role enum with `Agent`, `Client`
- Extend per-team role enum with `TeamLeader`
- Update role-rank trigger so Agent/Client are sticky
- RLS carve-outs (see Section 5)
- `is_external_user(uid)` SECURITY DEFINER helper

---

## Section 2 — Team Chat

### One group conversation per team, auto-managed

Reuse existing `conversations` + `conversation_participants` + `dm_messages` tables. No new tables.

Schema additions:
- `conversations.team_id` — nullable FK. Non-null = team chat. Null = regular DM/group.
- Partial unique index `UNIQUE (team_id) WHERE team_id IS NOT NULL` — enforces exactly one team chat per team.

### Membership sync (DB trigger)

- `AFTER INSERT OR DELETE ON profile_teams` → insert/soft-delete the corresponding `conversation_participants` row for that team's chat.
- Team creation → auto-create its conversation row.
- Team deletion → cascade.

All team members (Manager, Team Leader, Client, Agents) are participants — no role filtering.

### Agent/Client chat UI scope

- Chat widget shows **only the team chat** for the active workspace.
- No contact list, no "New chat" button, no group-DM creation.
- Internal users see team chats mixed into their normal DM list, labeled with the team name.

### Reuses existing infra

- `useConversation`, `useDmRealtime` — unchanged
- `dm-offline-notify` edge function — unchanged
- Unread counts, typing indicators, mentions — all work as-is

---

## Section 3 — Agent/Client UI Shell

### `useAuth` additions

- `isAgent`, `isClient`, `isExternal` (= agent || client)
- `activeTeamId` — current workspace, persisted in `localStorage` under `pe-active-team-{profileId}`. Defaults to first team in `profile.all_teams` on first login.

### Routing (`App.jsx`)

Root `/` redirects:
- Internal → `/my-tasks` (unchanged)
- External → `/to-do`

Guard: external users navigating to `/my-tasks`, `/assign`, `/team-view`, `/reports`, `/admin`, or team-management settings redirect to `/to-do`.

### Sidebar (`Layout.jsx`) for externals

```
[Workspace switcher: dropdown of profile.all_teams]
──────────────
📋 To-Do
🏢 Hubs         (filtered to hubs where they're a member AND hub.team_id = activeTeamId, OR custom hubs they belong to)
💬 Team Chat
⚙️  Settings    (profile-only: avatar, name, theme)
```

### Chat widget (`ChatWidget.jsx`)

If `isExternal`: single-thread view of the team chat for `activeTeamId`. "New chat" hidden. Group creation disabled.

### Notification bell

Externals see only:
- Hub @mentions
- To-do item assignments
- To-do due-date reminders
- New hub membership

All task-related notification types are filtered out client-side in `useNotifications` (v1).

### Settings page

External users see only profile section (avatar, display name, theme). No team/user management, no invite flows.

---

## Section 4 — To-Do Page & Workspace Switcher

### `/to-do` route

New page (`src/pages/ToDoPage.jsx`). Replaces "My Tasks" for externals.

Query (new `useMyHubTodos` hook):
- `hub_todo_items` where user is in `hub_todo_item_assignees`, not soft-deleted
- Scoped to hubs matching `activeTeamId` (via `hubs.team_id` or `hub_members` for custom hubs)
- Joins `hub_todo_lists`, `hubs`, mentions/comments counts

Layout:
- Grouped by hub → list → items
- Each item: checkbox, title, due date with priority color (reuses `getPriority()`), assigner, hub/list breadcrumb, co-assignee avatars
- Click → deep-link to the hub's to-do module at that item

Filters:
- Status: All / Open / Completed
- Due: All / Overdue / This week / No due date
- Hub filter chip (multi-select)

Empty state: "No to-dos in this workspace. If you're expecting some, ask your Team Leader."

### Workspace switcher

Component: `WorkspaceSwitcher.jsx`. Dropdown sourced from `profile.all_teams`. Selecting a team:
1. Writes team ID to `localStorage`
2. Updates `useActiveTeam` context (or `AuthProvider` state)
3. All data hooks re-scope to new `activeTeamId`

Internal users don't see the switcher — their views are already multi-team-aware.

---

## Section 5 — RLS, Invites, Notifications

### RLS updates (migration 030)

- `tasks`, `task_assignees`, `comments` — SELECT policies add: `AND (SELECT role FROM profiles WHERE id = auth.uid()) NOT IN ('Agent','Client')`. Externals cannot read any tasks.
- `hub_*` — no changes (existing `hub_members` policies handle it).
- `conversations`, `dm_messages` — externals can only SELECT/INSERT conversations where `team_id IS NOT NULL` AND they're a participant. Blocks creating or joining any non-team conversation via direct API.
- `is_external_user(uid)` SECURITY DEFINER helper for reuse.

### Invite flow

- Extend existing "Add user" UI in Settings (Admin/Manager paths) with role selector including `Agent` and `Client`.
- On invite: create `profiles` row with `role = 'Agent' | 'Client'`, add matching `profile_teams` row, trigger `user-notify` edge function.
- Manager path: can only invite into teams where they have `profile_teams.role = 'Manager'`.
- Admin path: any team.

### Notification filtering

Update `useNotifications` to drop task-related types when `isExternal`. Client-side filter for v1; can move to RLS/query if volume becomes an issue.

### Task visibility

`useProfiles` gains optional `excludeExternals` flag. "Assign a Task" user picker passes it so agents/clients never appear as assignable.

---

## Section 6 — Testing & Rollout

### Tests

- `externalRoles.test.js` — role derivation; sticky role-rank sync
- `filters.test.js` — excluding externals from assignee picker
- `useMyHubTodos.test.js` — active-team scoping, soft-delete filtering, join shape
- SQL RLS tests (`supabase/tests/`) — externals cannot SELECT tasks; cannot INSERT conversation without `team_id`; team-chat participant trigger fires on join/leave

### Manual QA checklist

1. Invite Agent into Team A → redirected to `/to-do`, 4-item sidebar, task pages 404/redirect via URL
2. Assign agent a to-do → appears on `/to-do` and notification bell
3. Switch workspace to Team B → to-dos, hubs, team chat all re-scope
4. Manager posts in team chat → agent receives realtime + offline email
5. Client login → full hub access, chat widget shows only team chat
6. Remove agent from Team A → removed from Team A chat immediately

### Rollout order

1. Migration 030 (schema + RLS)
2. `useAuth` role helpers + routing guards
3. Sidebar + workspace switcher
4. To-Do page + `useMyHubTodos`
5. Chat widget external mode + team chat auto-create
6. Invite flow extensions
7. Notification filtering

### Out of scope for v1

- Client read-only hub mode — Client gets full hub access per design
- Per-module hub restrictions for agents — agents get full hub member access per design
- Cross-device workspace switcher sync — localStorage-only
- Billing / contract model for client engagements

---

## Open questions for implementation

- **Team Leader assignment UI:** where and how Managers/Admins designate a Team Leader on a team. Probably a dropdown on the `profile_teams` row in Settings; decide during implementation.
- **Client count per team:** schema allows many; enforce single-client-per-team in UI only, or add a constraint? Defer.
- **Deactivating an external:** what happens to their team chat participant rows and hub memberships? Likely soft-delete `profiles`, cascade via existing mechanisms. Confirm during Migration 030 work.
