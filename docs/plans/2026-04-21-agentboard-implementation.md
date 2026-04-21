# Agentboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two restricted account types (`Agent`, `Client`) that get a narrow UI (to-do list, team chat, hub participation by invite only) while leaving internal Staff/Manager/Admin flows untouched.

**Architecture:** Global roles `Agent`/`Client` are added on `profiles.role`. A new per-team role `TeamLeader` is added on `profile_teams.role`. The existing team-group-chat infrastructure (migration 033) is reused — externals are auto-enrolled via the existing `sync_team_group_membership` trigger, and the chat widget is filtered to show only team groups for externals. The To-Do page is a new `/to-do` route that queries `hub_todo_items` assigned to the current user and scoped to an `activeTeamId` workspace stored in `localStorage`. Routing guards redirect externals away from task pages.

**Tech Stack:** React 18 + Vite, Supabase (Postgres + Auth + Realtime + RLS), Vitest + React Testing Library, Tailwind CSS, Framer Motion, `lucide-react`.

**Design source:** `docs/plans/2026-04-21-agentboard-design.md`

**Relevant skills for executors:**
- `superpowers:test-driven-development` — write failing test first, verify it fails, minimal impl, verify pass
- `superpowers:verification-before-completion` — run tests + manual check before claiming done
- `superpowers:systematic-debugging` — for any RLS surprises (Supabase RLS recursion is common here — see migrations 013, 017, 018)

**Project conventions (read before starting):**
- Path alias: `@/` → `src/`. Always import with `@/lib/...` etc.
- PostgREST FK hints are **mandatory** on `profiles`↔`teams` joins — see `CLAUDE.md` "Critical Gotchas." Example: `teams!profile_teams_team_id_fkey(id,name)`.
- Tests live in `src/lib/__tests__/`, run with Vitest. Existing pattern: `describe`/`it` blocks, `vi.useFakeTimers` for time-dependent code.
- Migrations are applied in filename order. **Next migration number is 038** (037 already exists).
- When adding RLS, never self-reference the same table inside a policy subquery (causes recursion). Use SECURITY DEFINER helper functions.
- Commit after every green test. Commit messages follow Conventional Commits: `feat(...)`, `fix(...)`, `refactor(...)`, `docs(...)`, `test(...)`.

---

## Task 1: Migration 038 — Add `Agent`/`Client`/`TeamLeader` roles + sticky role-rank

**Goal:** Extend role enums; ensure `profiles.role` cannot be silently downgraded to `Agent`/`Client` by the existing role-sync trigger.

**Files:**
- Create: `supabase/migrations/038_agentboard_roles.sql`
- Reference only: `supabase/migrations/010_per_team_role.sql` (existing role-rank trigger — read before editing)

**Step 1: Read the existing role-rank trigger**

Run:
```bash
cat supabase/migrations/010_per_team_role.sql
```

Note the name of the trigger function that syncs `profiles.role` to the max of `profile_teams.role`. The new migration must update *this same function* (do not create a second one).

**Step 2: Write the migration**

Create `supabase/migrations/038_agentboard_roles.sql` with:

```sql
-- ─────────────────────────────────────────────
-- 038 · Agentboard roles
--
-- Adds two new global account types (Agent, Client) and one new per-team
-- role (TeamLeader). Externals are sticky: the role-sync trigger never
-- overwrites an Agent/Client global role based on their per-team rows.
-- ─────────────────────────────────────────────

-- 1. Extend the profiles.role check constraint (or enum, whichever 001 used)
--    NOTE: 001_initial.sql uses a text column with a CHECK. Drop and recreate.
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('Admin', 'Manager', 'Staff', 'Agent', 'Client'));

-- 2. Extend the profile_teams.role check constraint to allow TeamLeader.
--    Also allow Agent/Client as purely descriptive per-team values.
alter table public.profile_teams
  drop constraint if exists profile_teams_role_check;
alter table public.profile_teams
  add constraint profile_teams_role_check
  check (role in ('Manager', 'Staff', 'TeamLeader', 'Agent', 'Client'));

-- 3. Replace the role-sync trigger function so it NEVER downgrades an
--    Admin/Agent/Client global role. Ranks: Admin=4, Manager=2, Staff=1.
--    TeamLeader per-team maps to rank 1.5 but never promotes profiles.role
--    above Staff (TeamLeader is a per-team designation only).
create or replace function public.sync_profile_role_from_teams()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_global text;
  new_role text;
begin
  select role into current_global
    from public.profiles
    where id = coalesce(new.profile_id, old.profile_id);

  -- Sticky roles: never overwrite Admin/Agent/Client via per-team sync.
  if current_global in ('Admin', 'Agent', 'Client') then
    return coalesce(new, old);
  end if;

  -- Pick highest authority across remaining rows (Manager > Staff|TeamLeader).
  select case
    when bool_or(role = 'Manager') then 'Manager'
    else 'Staff'
  end
  into new_role
  from public.profile_teams
  where profile_id = coalesce(new.profile_id, old.profile_id)
    and role in ('Manager', 'Staff', 'TeamLeader');

  if new_role is not null and new_role <> current_global then
    update public.profiles set role = new_role
      where id = coalesce(new.profile_id, old.profile_id);
  end if;

  return coalesce(new, old);
end;
$$;

-- 4. Helper: is this user an external (Agent or Client)?
create or replace function public.is_external_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('Agent', 'Client')
  );
$$;
grant execute on function public.is_external_user(uuid) to authenticated;
```

**Step 3: Apply the migration against the local Supabase instance**

Run:
```bash
npx supabase db push
```
Expected: migration applies cleanly, no errors.

If you hit a CHECK-constraint error because an existing row violates it, that means a seed/test profile has a role outside the new list — investigate before relaxing the constraint. Do NOT drop existing data.

**Step 4: Smoke-test in SQL**

Run (via Supabase Studio SQL editor or `psql`):
```sql
-- Create a fake Agent profile and confirm sync trigger leaves it alone
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'agent.smoke@test.local');
insert into profiles (id, email, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'agent.smoke@test.local', 'Smoke Agent', 'Agent');
insert into profile_teams (profile_id, team_id, role, is_primary)
  select '11111111-1111-1111-1111-111111111111', id, 'Staff', true
  from teams limit 1;
select role from profiles where id = '11111111-1111-1111-1111-111111111111';
-- Expected: 'Agent' (NOT 'Staff' — trigger must leave sticky roles alone)
```
Expected output: `Agent`.

Clean up:
```sql
delete from profile_teams where profile_id = '11111111-1111-1111-1111-111111111111';
delete from profiles where id = '11111111-1111-1111-1111-111111111111';
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
```

**Step 5: Commit**

```bash
git add supabase/migrations/038_agentboard_roles.sql
git commit -m "feat(db): add Agent/Client global roles and TeamLeader per-team role

Migration 038 extends role enums and makes the role-sync trigger
sticky for Admin/Agent/Client so external account types are never
silently downgraded when per-team roles change."
```

---

## Task 2: Migration 039 — RLS hardening for externals

**Goal:** Block externals from reading tasks. Block externals from creating or joining any conversation that is not a team group.

**Files:**
- Create: `supabase/migrations/039_agentboard_rls.sql`
- Reference: `supabase/migrations/001_initial.sql` (existing task RLS), `supabase/migrations/027_direct_messages.sql` (existing DM RLS), `supabase/migrations/033_group_conversations.sql` (team group + existing participant check)

**Step 1: Read existing policies**

```bash
grep -n "policy" supabase/migrations/001_initial.sql | head -20
grep -n "policy" supabase/migrations/027_direct_messages.sql
grep -n "policy" supabase/migrations/033_group_conversations.sql
```

Identify the exact names of SELECT policies on `tasks`, `task_assignees`, `comments`, and INSERT policies on `conversations`, `dm_messages`.

**Step 2: Write the migration**

Create `supabase/migrations/039_agentboard_rls.sql`:

```sql
-- ─────────────────────────────────────────────
-- 039 · Agentboard RLS hardening
--
-- Externals (Agent, Client) must not see any tasks. They can only
-- participate in conversations of kind='group' with team_id set (the
-- team group chats). DM creation and group-DM creation are blocked.
-- ─────────────────────────────────────────────

-- Task-side hardening: add a blanket guard to existing SELECT policies.
-- We wrap each via DROP + CREATE to preserve the original subject clauses.
-- NOTE: policy names below are examples — match the names from 001 exactly.

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select
  using (
    not public.is_external_user(auth.uid())
    and (
      -- Paste the original subject clause from 001 here.
      -- Keep the existing manager/staff/assignee logic intact.
      true  -- PLACEHOLDER: replace with original predicate
    )
  );

-- Repeat the same wrapper for task_assignees and comments.
-- If the original policy already read from tasks, it inherits the guard.

-- Conversation-side hardening for externals.
drop policy if exists "conversations_select_external_guard" on public.conversations;
create policy "conversations_select_external_guard" on public.conversations
  for select
  using (
    -- Non-externals: existing behavior (drop this guard for them).
    not public.is_external_user(auth.uid())
    or (kind = 'group' and team_id is not null)
  );

-- Block externals from inserting new conversations (DMs or custom groups).
drop policy if exists "conversations_insert_external_block" on public.conversations;
create policy "conversations_insert_external_block" on public.conversations
  for insert
  with check (
    not public.is_external_user(auth.uid())
  );

-- Messages: externals can only insert into team-group conversations they're
-- a participant of. The existing is_conversation_participant(cid) function
-- handles participant gating; we layer the external constraint on top.
drop policy if exists "dm_messages_insert_external_guard" on public.dm_messages;
create policy "dm_messages_insert_external_guard" on public.dm_messages
  for insert
  with check (
    (
      -- Non-externals keep the existing path.
      not public.is_external_user(auth.uid())
      and public.is_conversation_participant(conversation_id)
    )
    or
    (
      -- Externals: must be a team-group conversation they're in.
      public.is_external_user(auth.uid())
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and c.kind = 'group'
          and c.team_id is not null
      )
      and public.is_conversation_participant(conversation_id)
    )
  );
```

**IMPORTANT:** The placeholder `-- PLACEHOLDER: replace with original predicate` must be filled with the real predicate from `001_initial.sql` before the migration will work. Read that file first and paste the exact subject expression.

**Step 3: Apply + smoke test**

Run:
```bash
npx supabase db push
```

SQL smoke test (run in Studio or psql as different users):

```sql
-- As an Agent: selecting from tasks must return 0 rows
set local role authenticated;
set local "request.jwt.claim.sub" to '<agent-user-id>';
select count(*) from tasks;  -- Expected: 0

-- As a Staff on the same team as a task: must return >0 rows
set local "request.jwt.claim.sub" to '<staff-user-id>';
select count(*) from tasks;  -- Expected: >0
```

**Step 4: Commit**

```bash
git add supabase/migrations/039_agentboard_rls.sql
git commit -m "feat(db): RLS — externals cannot read tasks or create non-team conversations

Migration 039 layers is_external_user() guards on tasks/task_assignees/
comments SELECT policies and restricts Agent/Client INSERT on conversations
and dm_messages to team group chats only."
```

---

## Task 3: Role helper unit tests (TDD)

**Goal:** Lock in the behavior of `isAgent`, `isClient`, `isExternal` derivations before touching `useAuth`.

**Files:**
- Create: `src/lib/__tests__/externalRoles.test.js`
- Create: `src/lib/roleHelpers.js` (new — small pure helpers to keep `useAuth` thin)
- Modify: `src/hooks/useAuth.jsx` (after tests pass, wire the helpers into context value)

**Step 1: Write the failing test**

Create `src/lib/__tests__/externalRoles.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { isAgent, isClient, isExternal } from '../roleHelpers'

describe('role helpers', () => {
  it('isAgent true only for Agent role', () => {
    expect(isAgent({ role: 'Agent' })).toBe(true)
    expect(isAgent({ role: 'Staff' })).toBe(false)
    expect(isAgent({ role: 'Client' })).toBe(false)
    expect(isAgent(null)).toBe(false)
  })

  it('isClient true only for Client role', () => {
    expect(isClient({ role: 'Client' })).toBe(true)
    expect(isClient({ role: 'Agent' })).toBe(false)
    expect(isClient(null)).toBe(false)
  })

  it('isExternal is true for Agent or Client', () => {
    expect(isExternal({ role: 'Agent' })).toBe(true)
    expect(isExternal({ role: 'Client' })).toBe(true)
    expect(isExternal({ role: 'Staff' })).toBe(false)
    expect(isExternal({ role: 'Manager' })).toBe(false)
    expect(isExternal({ role: 'Admin' })).toBe(false)
    expect(isExternal(null)).toBe(false)
    expect(isExternal(undefined)).toBe(false)
  })
})
```

**Step 2: Run test — verify it fails**

```bash
npx vitest run src/lib/__tests__/externalRoles.test.js
```
Expected: FAIL (`Cannot find module '../roleHelpers'`).

**Step 3: Implement**

Create `src/lib/roleHelpers.js`:

```js
export function isAgent(profile) {
  return profile?.role === 'Agent'
}

export function isClient(profile) {
  return profile?.role === 'Client'
}

export function isExternal(profile) {
  return profile?.role === 'Agent' || profile?.role === 'Client'
}
```

**Step 4: Run test — verify it passes**

```bash
npx vitest run src/lib/__tests__/externalRoles.test.js
```
Expected: PASS (3 tests).

**Step 5: Wire helpers into `useAuth`**

Edit `src/hooks/useAuth.jsx` around line 258 (the `value` object):

```js
import { isAgent, isClient, isExternal } from '../lib/roleHelpers'

// ... inside AuthProvider, in the `value` object:
const value = {
  session,
  profile,
  loading,
  refreshProfile,
  presence,
  isAdmin:    profile?.role === 'Admin',
  isManager:  profile?.role === 'Manager' || profile?.role === 'Admin',
  isStaff:    profile?.role === 'Staff',
  isAgent:    isAgent(profile),
  isClient:   isClient(profile),
  isExternal: isExternal(profile),
  isManagerForTeam
}
```

**Step 6: Commit**

```bash
git add src/lib/roleHelpers.js src/lib/__tests__/externalRoles.test.js src/hooks/useAuth.jsx
git commit -m "feat(auth): isAgent/isClient/isExternal derivation in useAuth"
```

---

## Task 4: `activeTeamId` workspace state + `WorkspaceSwitcher`

**Goal:** Track the current workspace for external users and expose it via `useAuth`. Provide a dropdown to switch.

**Files:**
- Create: `src/hooks/useActiveTeam.js`
- Create: `src/components/layout/WorkspaceSwitcher.jsx`
- Create: `src/lib/__tests__/activeTeam.test.js`
- Modify: `src/hooks/useAuth.jsx` (add `activeTeamId` + `setActiveTeamId` to context)

**Step 1: Write the failing test**

Create `src/lib/__tests__/activeTeam.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { getStoredActiveTeamId, setStoredActiveTeamId, pickDefaultTeam } from '../activeTeamStorage'

describe('activeTeam storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('getStoredActiveTeamId returns null when unset', () => {
    expect(getStoredActiveTeamId('profile-1')).toBeNull()
  })

  it('setStoredActiveTeamId persists per-profile', () => {
    setStoredActiveTeamId('profile-1', 'team-a')
    expect(getStoredActiveTeamId('profile-1')).toBe('team-a')
    expect(getStoredActiveTeamId('profile-2')).toBeNull()
  })

  it('pickDefaultTeam prefers primary team', () => {
    const profile = {
      all_teams: [
        { id: 't1', is_primary: false },
        { id: 't2', is_primary: true },
        { id: 't3', is_primary: false },
      ]
    }
    expect(pickDefaultTeam(profile)).toBe('t2')
  })

  it('pickDefaultTeam falls back to first team', () => {
    const profile = { all_teams: [{ id: 't1' }, { id: 't2' }] }
    expect(pickDefaultTeam(profile)).toBe('t1')
  })

  it('pickDefaultTeam returns null when no teams', () => {
    expect(pickDefaultTeam({ all_teams: [] })).toBeNull()
    expect(pickDefaultTeam({})).toBeNull()
  })
})
```

**Step 2: Run test — verify it fails**

```bash
npx vitest run src/lib/__tests__/activeTeam.test.js
```
Expected: FAIL (`Cannot find module '../activeTeamStorage'`).

**Step 3: Implement storage helpers**

Create `src/lib/activeTeamStorage.js`:

```js
const KEY = (pid) => `pe-active-team-${pid}`

export function getStoredActiveTeamId(profileId) {
  if (!profileId) return null
  try {
    return localStorage.getItem(KEY(profileId)) || null
  } catch {
    return null
  }
}

export function setStoredActiveTeamId(profileId, teamId) {
  if (!profileId) return
  try {
    if (teamId) localStorage.setItem(KEY(profileId), teamId)
    else localStorage.removeItem(KEY(profileId))
  } catch {
    /* noop */
  }
}

export function pickDefaultTeam(profile) {
  const teams = profile?.all_teams || []
  if (teams.length === 0) return null
  const primary = teams.find(t => t?.is_primary)
  return primary?.id || teams[0]?.id || null
}
```

**Step 4: Run test — verify it passes**

```bash
npx vitest run src/lib/__tests__/activeTeam.test.js
```
Expected: PASS (5 tests).

**Step 5: Add `activeTeamId` to AuthContext**

Edit `src/hooks/useAuth.jsx`. Add state and effect inside `AuthProvider`:

```jsx
import { getStoredActiveTeamId, setStoredActiveTeamId, pickDefaultTeam } from '../lib/activeTeamStorage'

// Inside AuthProvider, near other useState hooks:
const [activeTeamId, setActiveTeamIdState] = useState(null)

// After profile loads, ensure activeTeamId is set:
useEffect(() => {
  if (!profile?.id) return
  const stored = getStoredActiveTeamId(profile.id)
  const validStored = stored && (profile.team_ids || []).includes(stored) ? stored : null
  const next = validStored || pickDefaultTeam(profile)
  setActiveTeamIdState(next)
  if (next && next !== stored) setStoredActiveTeamId(profile.id, next)
}, [profile])

const setActiveTeamId = useCallback((teamId) => {
  setActiveTeamIdState(teamId)
  if (profile?.id) setStoredActiveTeamId(profile.id, teamId)
}, [profile?.id])

// Add to the value object:
// activeTeamId,
// setActiveTeamId,
```

**Step 6: Build the WorkspaceSwitcher component**

Create `src/components/layout/WorkspaceSwitcher.jsx`:

```jsx
import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export default function WorkspaceSwitcher() {
  const { profile, activeTeamId, setActiveTeamId } = useAuth()
  const [open, setOpen] = useState(false)

  const teams = profile?.all_teams || []
  if (teams.length === 0) return null

  const active = teams.find(t => t.id === activeTeamId) || teams[0]

  return (
    <div className="relative px-4 py-3 border-b border-slate-100 dark:border-dark-border">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-dark-hover/50 dark:hover:bg-dark-hover text-sm font-medium text-slate-900 dark:text-white transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{active?.name || 'Pick a workspace'}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-4 right-4 mt-1 z-50 bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border rounded-xl shadow-elevated py-1 max-h-72 overflow-y-auto"
        >
          {teams.map(t => (
            <li key={t.id}>
              <button
                role="option"
                aria-selected={t.id === activeTeamId}
                onClick={() => { setActiveTeamId(t.id); setOpen(false) }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dark-hover"
              >
                <span className="truncate">{t.name}</span>
                {t.id === activeTeamId && <Check size={14} className="text-brand-600 dark:text-brand-400" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

**Step 7: Commit**

```bash
git add src/lib/activeTeamStorage.js src/lib/__tests__/activeTeam.test.js src/hooks/useAuth.jsx src/components/layout/WorkspaceSwitcher.jsx
git commit -m "feat(layout): activeTeamId workspace state + WorkspaceSwitcher dropdown"
```

---

## Task 5: Routing guards — redirect externals away from task pages

**Goal:** Externals who hit `/my-tasks`, `/assign`, `/team`, `/admin`, `/reports` get redirected to `/to-do`. Root `/` redirect is role-aware.

**Files:**
- Modify: `src/App.jsx`

**Step 1: Update `AppRoutes`**

Edit `src/App.jsx`. Replace the current `<Routes>` block:

```jsx
import { useAuth } from './hooks/useAuth'

function AppRoutes() {
  const { session, loading, profile, refreshProfile, isExternal } = useAuth()

  // ... keep loading + no-session + no-profile blocks as-is ...

  const rootTarget = isExternal ? '/to-do' : '/my-tasks'

  function InternalOnly({ children }) {
    if (isExternal) return <Navigate to="/to-do" replace />
    return children
  }

  return (
    <>
      <Layout>
        <ErrorBoundary>
          <AnimatePresence mode="wait">
            <Routes>
              <Route path="/"         element={<Navigate to={rootTarget} replace />} />
              <Route path="/my-tasks" element={<InternalOnly><MyTasksPage /></InternalOnly>} />
              <Route path="/assign"   element={<InternalOnly><AssignTaskPage /></InternalOnly>} />
              <Route path="/to-do"    element={<ToDoPage />} />
              <Route path="/hub"        element={<HubPage />} />
              <Route path="/hub/:hubId" element={<HubPage />} />
              <Route path="/hub/:hubId/todos/*" element={<HubTodosPage />} />
              <Route path="/team"     element={<InternalOnly><TeamViewPage /></InternalOnly>} />
              <Route path="/admin"    element={<InternalOnly><AdminOverviewPage /></InternalOnly>} />
              <Route path="/reports"  element={<InternalOnly><ReportsPage /></InternalOnly>} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*"         element={<Navigate to={rootTarget} replace />} />
            </Routes>
          </AnimatePresence>
        </ErrorBoundary>
      </Layout>
      <ChatWidget />
    </>
  )
}
```

Import the new page at the top:

```jsx
import ToDoPage from './pages/ToDoPage'
```

(`ToDoPage` is stubbed in Task 8 — create a placeholder now so the import resolves.)

**Step 2: Create the placeholder**

Create `src/pages/ToDoPage.jsx`:

```jsx
export default function ToDoPage() {
  return <div className="p-6">To-Do (placeholder)</div>
}
```

**Step 3: Manual smoke test**

```bash
npm run dev
```

Open `http://localhost:5173`. Log in as an internal user — root should redirect to `/my-tasks` (unchanged). To truly test external behavior, either temporarily set your profile's `role` to `'Agent'` in the DB or skip this until Task 8.

**Step 4: Commit**

```bash
git add src/App.jsx src/pages/ToDoPage.jsx
git commit -m "feat(routing): redirect externals to /to-do, guard internal-only routes"
```

---

## Task 6: Layout sidebar — external mode

**Goal:** For externals, show only `To-Do`, `Hubs`, `Team Chat`, `Settings` in the sidebar plus the `WorkspaceSwitcher` at the top.

**Files:**
- Modify: `src/components/layout/Layout.jsx`

**Step 1: Update the nav items and mount the switcher**

Edit `src/components/layout/Layout.jsx`:

Import the switcher and the `isExternal` flag:

```jsx
import WorkspaceSwitcher from './WorkspaceSwitcher'
import { CheckSquare, Plus, Users, LayoutDashboard, Boxes, BarChart2, Settings, LogOut, Menu, X, ChevronRight, Moon, Sun, ListChecks, MessageCircle } from 'lucide-react'
// ...
const { profile, isAdmin, isManager, isExternal } = useAuth()
```

Replace the `navItems` definition:

```jsx
const navItems = isExternal
  ? [
      { to: '/to-do',      icon: ListChecks,    label: 'To-Do',      show: true },
      { to: '/hub',        icon: Boxes,         label: 'Hubs',       show: true },
      { to: '/team-chat',  icon: MessageCircle, label: 'Team Chat',  show: true },
      { to: '/settings',   icon: Settings,      label: 'Settings',   show: true },
    ]
  : [
      { to: '/my-tasks', icon: CheckSquare, label: 'My Tasks',       show: true },
      { to: '/assign',   icon: Plus,         label: 'Assign a Task', show: true },
      { to: '/hub',      icon: Boxes,        label: 'Project Hub',   show: true, badge: 'BETA' },
      { to: '/team',     icon: Users,        label: 'Team View',     show: isManager },
      { to: '/admin',    icon: LayoutDashboard, label: 'Admin Overview', show: isAdmin },
      { to: '/reports',  icon: BarChart2,    label: 'Reports',       show: isManager },
      { to: '/settings', icon: Settings,     label: 'Settings',      show: isManager },
    ]
```

Inside `sidebarContent`, right before the `<nav>` element, mount the switcher for externals:

```jsx
{isExternal && <WorkspaceSwitcher />}
```

**Step 2: The `/team-chat` route — inline panel**

The Team Chat nav link goes to a new simple page that opens the team group chat inline. Easiest approach: make `/team-chat` render the existing `ConversationPane` for the active team's group, or — simpler — on click, open the existing `ChatWidget` onto that conversation. For v1, route it to the `ChatWidget` programmatically.

Pragmatic implementation: make `/team-chat` a thin page that uses the RPC `get_or_create_team_group` and renders the existing `ConversationPane` full-screen.

Create `src/pages/TeamChatPage.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import ConversationPane from '../components/chat/ConversationPane'

export default function TeamChatPage() {
  const { activeTeamId } = useAuth()
  const [conversationId, setConversationId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeTeamId) { setConversationId(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    supabase.rpc('get_or_create_team_group', { tid: activeTeamId }).then(({ data, error }) => {
      if (cancelled) return
      if (error) { console.error('team group rpc', error); setConversationId(null) }
      else setConversationId(data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeTeamId])

  if (loading) return <div className="p-6 text-slate-500 text-sm">Loading team chat...</div>
  if (!conversationId) return <div className="p-6 text-slate-500 text-sm">No team chat available for this workspace.</div>

  return (
    <div className="h-full flex flex-col">
      <ConversationPane conversationId={conversationId} />
    </div>
  )
}
```

Add the route in `src/App.jsx`:

```jsx
<Route path="/team-chat" element={<TeamChatPage />} />
```

And `import TeamChatPage from './pages/TeamChatPage'`.

**NOTE:** `ConversationPane` may have props other than `conversationId` — read `src/components/chat/ConversationPane.jsx` before finalizing and pass whatever it actually requires.

**Step 3: Manual smoke test**

```bash
npm run dev
```

Flip your own profile role in the DB to `'Agent'` temporarily, hard-refresh the app. Expect:
- Sidebar shows 4 items + WorkspaceSwitcher at top
- URL `/my-tasks` redirects to `/to-do`
- `/team-chat` loads (may be empty if no team group exists yet — run the RPC manually once)

Flip your role back to the real value when done.

**Step 4: Commit**

```bash
git add src/components/layout/Layout.jsx src/pages/TeamChatPage.jsx src/App.jsx
git commit -m "feat(layout): external-user sidebar with WorkspaceSwitcher + /team-chat route"
```

---

## Task 7: `useMyHubTodos` hook + tests

**Goal:** Fetch all open hub to-do items assigned to the current user, scoped to the active workspace.

**Files:**
- Create: `src/hooks/useMyHubTodos.js`
- Create: `src/hooks/__tests__/useMyHubTodos.test.js`
- Reference: `src/hooks/useHubTodos.js` (same query shape, different filter)

**Step 1: Write the failing test**

Create `src/hooks/__tests__/useMyHubTodos.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { groupTodosByHub, filterTodosByStatus, filterTodosByDue } from '../../lib/myTodos'

describe('groupTodosByHub', () => {
  it('groups items by hub.id preserving hub name + list hierarchy', () => {
    const items = [
      { id: '1', title: 'A', hub_id: 'h1', hub: { id: 'h1', name: 'Hub One' }, list: { id: 'l1', title: 'List 1' } },
      { id: '2', title: 'B', hub_id: 'h1', hub: { id: 'h1', name: 'Hub One' }, list: { id: 'l1', title: 'List 1' } },
      { id: '3', title: 'C', hub_id: 'h2', hub: { id: 'h2', name: 'Hub Two' }, list: { id: 'l2', title: 'List 2' } },
    ]
    const grouped = groupTodosByHub(items)
    expect(grouped).toHaveLength(2)
    expect(grouped[0].hub.id).toBe('h1')
    expect(grouped[0].lists[0].items).toHaveLength(2)
  })

  it('returns empty array for no items', () => {
    expect(groupTodosByHub([])).toEqual([])
  })
})

describe('filterTodosByStatus', () => {
  const items = [
    { id: '1', completed_at: null },
    { id: '2', completed_at: '2026-04-20T00:00:00Z' },
  ]
  it('"all" returns everything', () => {
    expect(filterTodosByStatus(items, 'all')).toHaveLength(2)
  })
  it('"open" excludes completed', () => {
    const r = filterTodosByStatus(items, 'open')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('1')
  })
  it('"completed" excludes open', () => {
    const r = filterTodosByStatus(items, 'completed')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('2')
  })
})

describe('filterTodosByDue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'))
  })
  const items = [
    { id: 'overdue',  due_date: '2026-04-20T00:00:00Z' },
    { id: 'thisweek', due_date: '2026-04-24T00:00:00Z' },
    { id: 'later',    due_date: '2026-05-15T00:00:00Z' },
    { id: 'nodate',   due_date: null },
  ]
  it('"overdue" returns past-due only', () => {
    expect(filterTodosByDue(items, 'overdue').map(i => i.id)).toEqual(['overdue'])
  })
  it('"week" returns items due in next 7 days (inclusive of overdue? no)', () => {
    expect(filterTodosByDue(items, 'week').map(i => i.id)).toEqual(['thisweek'])
  })
  it('"none" returns items without a due date', () => {
    expect(filterTodosByDue(items, 'none').map(i => i.id)).toEqual(['nodate'])
  })
  it('"all" returns everything', () => {
    expect(filterTodosByDue(items, 'all')).toHaveLength(4)
  })
})
```

**Step 2: Run test — verify it fails**

```bash
npx vitest run src/hooks/__tests__/useMyHubTodos.test.js
```
Expected: FAIL (`Cannot find module '../../lib/myTodos'`).

**Step 3: Implement helpers**

Create `src/lib/myTodos.js`:

```js
export function groupTodosByHub(items) {
  if (!items || items.length === 0) return []
  const byHub = new Map()
  for (const it of items) {
    const hubId = it.hub?.id || it.hub_id
    if (!byHub.has(hubId)) byHub.set(hubId, { hub: it.hub || { id: hubId }, lists: new Map() })
    const hub = byHub.get(hubId)
    const listId = it.list?.id || it.list_id
    if (!hub.lists.has(listId)) hub.lists.set(listId, { list: it.list || { id: listId }, items: [] })
    hub.lists.get(listId).items.push(it)
  }
  return Array.from(byHub.values()).map(h => ({
    hub: h.hub,
    lists: Array.from(h.lists.values()),
  }))
}

export function filterTodosByStatus(items, status) {
  if (status === 'all' || !status) return items
  if (status === 'open') return items.filter(i => !i.completed_at)
  if (status === 'completed') return items.filter(i => !!i.completed_at)
  return items
}

export function filterTodosByDue(items, mode) {
  if (mode === 'all' || !mode) return items
  const now = Date.now()
  const weekMs = 7 * 24 * 60 * 60 * 1000
  return items.filter(i => {
    if (mode === 'none') return !i.due_date
    if (!i.due_date) return false
    const t = new Date(i.due_date).getTime()
    if (mode === 'overdue') return t < now
    if (mode === 'week') return t >= now && t <= now + weekMs
    return true
  })
}
```

**Step 4: Run test — verify it passes**

```bash
npx vitest run src/hooks/__tests__/useMyHubTodos.test.js
```
Expected: PASS (8 tests).

**Step 5: Build the hook**

Create `src/hooks/useMyHubTodos.js`:

```js
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useMyHubTodos() {
  const { profile, activeTeamId } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchItems = useCallback(async () => {
    if (!profile?.id) { setItems([]); setLoading(false); return }
    setError(null)

    // Step 1: hub IDs the user is a member of AND whose team matches activeTeamId
    //         (custom hubs with team_id NULL are included only if the user is
    //          explicitly in hub_members — which is already enforced by RLS).
    const { data: memberships, error: mErr } = await supabase
      .from('hub_members')
      .select('hub_id, hubs!inner(id, name, team_id)')
      .eq('profile_id', profile.id)
    if (mErr) { setError(mErr); setLoading(false); return }

    const hubIds = (memberships || [])
      .filter(m => {
        const tid = m.hubs?.team_id
        // Team-scoped hubs: must match active workspace.
        // Custom hubs (tid null): always included.
        return !activeTeamId || tid == null || tid === activeTeamId
      })
      .map(m => m.hub_id)

    if (hubIds.length === 0) { setItems([]); setLoading(false); return }

    // Step 2: fetch items assigned to me in those hubs
    const { data, error: iErr } = await supabase
      .from('hub_todo_items')
      .select(`
        *,
        list:hub_todo_lists!hub_todo_items_list_id_fkey(id, title, color),
        hub:hubs!hub_todo_items_hub_id_fkey(id, name, team_id),
        creator:profiles!hub_todo_items_created_by_fkey(id, full_name, avatar_url),
        hub_todo_item_assignees!inner(profile_id, profiles(id, full_name, avatar_url))
      `)
      .in('hub_id', hubIds)
      .is('deleted_at', null)
      .eq('hub_todo_item_assignees.profile_id', profile.id)
      .order('due_date', { ascending: true, nullsFirst: false })

    if (iErr) setError(iErr)
    setItems(data || [])
    setLoading(false)
  }, [profile?.id, activeTeamId])

  useEffect(() => { setLoading(true); fetchItems() }, [fetchItems])

  // Realtime: any change in hub_todo_items triggers a refetch.
  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase.channel(`my-hub-todos-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hub_todo_items' }, () => fetchItems())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hub_todo_item_assignees' }, () => fetchItems())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.id, fetchItems])

  return { items, loading, error, refetch: fetchItems }
}
```

**Step 6: Commit**

```bash
git add src/lib/myTodos.js src/hooks/useMyHubTodos.js src/hooks/__tests__/useMyHubTodos.test.js
git commit -m "feat(hub): useMyHubTodos — assigned-to-me items scoped to active workspace"
```

---

## Task 8: `ToDoPage` UI

**Goal:** Render assigned to-dos grouped by hub → list, with filters for status and due date.

**Files:**
- Modify: `src/pages/ToDoPage.jsx` (replace placeholder from Task 5)
- Reference: `src/pages/MyTasksPage.jsx` (for page layout conventions), `src/components/ui/index.jsx` (for `PageHeader`, `FilterRow`, shared CSS classes)

**Step 1: Read the MyTasksPage for layout patterns**

```bash
head -80 src/pages/MyTasksPage.jsx
```

Note the use of `<PageHeader>`, `<FilterRow>`, and the shared animation wrapper `<PageTransition>`.

**Step 2: Implement the page**

Replace `src/pages/ToDoPage.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useMyHubTodos } from '../hooks/useMyHubTodos'
import { groupTodosByHub, filterTodosByStatus, filterTodosByDue } from '../lib/myTodos'
import { PageHeader } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import { getPriority } from '../lib/priority'
import { CheckCircle2, Circle, Calendar, Boxes } from 'lucide-react'
import { formatDate } from '../lib/helpers'

export default function ToDoPage() {
  const { profile } = useAuth()
  const { items, loading, error } = useMyHubTodos()
  const [status, setStatus] = useState('open')
  const [due, setDue] = useState('all')

  const filtered = useMemo(() => {
    let out = items
    out = filterTodosByStatus(out, status)
    out = filterTodosByDue(out, due)
    return out
  }, [items, status, due])

  const grouped = useMemo(() => groupTodosByHub(filtered), [filtered])

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <PageHeader
          title="To-Do"
          subtitle={`${profile?.full_name?.split(' ')[0] || 'Hello'}, here are the items assigned to you.`}
        />

        <div className="flex flex-wrap gap-2 mb-4">
          {['open', 'all', 'completed'].map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                status === s
                  ? 'bg-brand-500 text-white'
                  : 'bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
              }`}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
          <span className="mx-2 w-px bg-slate-200 dark:bg-dark-border" />
          {[
            { v: 'all', l: 'All due' },
            { v: 'overdue', l: 'Overdue' },
            { v: 'week', l: 'This week' },
            { v: 'none', l: 'No due date' },
          ].map(d => (
            <button
              key={d.v}
              onClick={() => setDue(d.v)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                due === d.v
                  ? 'bg-brand-500 text-white'
                  : 'bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
              }`}
            >
              {d.l}
            </button>
          ))}
        </div>

        {loading && <div className="text-sm text-slate-500">Loading...</div>}
        {error && <div className="text-sm text-red-500">Failed to load to-dos.</div>}

        {!loading && !error && grouped.length === 0 && (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400">
            <Boxes className="mx-auto mb-3" size={32} />
            <p className="font-medium">No to-dos in this workspace.</p>
            <p className="text-sm mt-1">If you&apos;re expecting some, ask your Team Leader.</p>
          </div>
        )}

        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.hub.id}>
              <Link
                to={`/hub/${group.hub.id}`}
                className="text-xs uppercase tracking-wide font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                {group.hub.name}
              </Link>
              <div className="mt-2 space-y-3">
                {group.lists.map(list => (
                  <div key={list.list.id} className="bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border rounded-2xl overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-100 dark:border-dark-border text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {list.list.title}
                    </div>
                    <ul className="divide-y divide-slate-100 dark:divide-dark-border">
                      {list.items.map(item => {
                        const p = getPriority(item)
                        return (
                          <li key={item.id}>
                            <Link
                              to={`/hub/${group.hub.id}/todos/${list.list.id}/${item.id}`}
                              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-dark-hover"
                            >
                              {item.completed_at
                                ? <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
                                : <Circle size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />}
                              <span className={`flex-1 text-sm ${item.completed_at ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
                                {item.title}
                              </span>
                              {item.due_date && (
                                <span className={`inline-flex items-center gap-1 text-xs font-medium priority-${p} px-2 py-0.5 rounded-full`}>
                                  <Calendar size={12} />
                                  {formatDate(item.due_date)}
                                </span>
                              )}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageTransition>
  )
}
```

**NOTE:** Verify the deep-link URL `/hub/:hubId/todos/:listId/:itemId` matches how `HubTodosPage` routes its inner paths. Read `src/pages/HubTodosPage.jsx` and adjust the link target if needed.

**Step 3: Manual smoke test**

Flip your profile role to `'Agent'` temporarily. Seed a hub, add your agent account to `hub_members`, create a to-do list and assign an item to yourself. Log in → `/to-do` should render the item under the hub name.

**Step 4: Commit**

```bash
git add src/pages/ToDoPage.jsx
git commit -m "feat(todo): ToDoPage groups assigned hub to-dos by hub and list"
```

---

## Task 9: Chat widget — external mode (team-groups only)

**Goal:** For externals, the chat widget shows only team-group conversations, and the "New chat" / group-creation entry points are hidden.

**Files:**
- Modify: `src/components/chat/ChatWidget.jsx`
- Modify: `src/components/chat/ChatLauncher.jsx` (if it has "New chat" UI)
- Modify: `src/hooks/useConversations.js` (filter return value for externals)
- Reference: `src/components/chat/ContactList.jsx`, `src/components/chat/CreateGroupModal.jsx`

**Step 1: Read the widget files**

```bash
head -80 src/components/chat/ChatWidget.jsx
head -80 src/components/chat/ChatLauncher.jsx
head -40 src/hooks/useConversations.js
```

Identify:
- Where the launcher renders the contact list / new-chat button
- Where `useConversations` returns the list that feeds the widget

**Step 2: Filter conversations for externals**

In `src/hooks/useConversations.js`, near the final `return` (after the list is built), add:

```js
import { isExternal } from '../lib/roleHelpers'
// ...
// inside the hook, after conversations are assembled:
const filtered = isExternal(profile)
  ? conversations.filter(c => c.kind === 'group' && c.team_id)
  : conversations
return { conversations: filtered, /* ...other returned values unchanged... */ }
```

If `useConversations` already destructures `profile` from `useAuth`, reuse it; otherwise add `const { profile } = useAuth()`.

**Step 3: Hide "New chat" + "Create group" UI for externals**

In `src/components/chat/ChatLauncher.jsx` (and `ContactList.jsx` if it has the button), import `useAuth` and wrap the action buttons:

```jsx
const { isExternal } = useAuth()
// ...
{!isExternal && <button onClick={openNewChat}>New chat</button>}
{!isExternal && <button onClick={openCreateGroup}>Create group</button>}
```

**Step 4: Manual smoke test**

With role `'Agent'` and membership in one team with a group chat:
- Chat launcher shows only the team group thread
- "New chat" button is hidden
- "Create group" is hidden
- Clicking the team group opens the conversation and messages send/receive correctly

**Step 5: Commit**

```bash
git add src/hooks/useConversations.js src/components/chat/ChatLauncher.jsx src/components/chat/ContactList.jsx src/components/chat/ChatWidget.jsx
git commit -m "feat(chat): external-mode widget shows only team group conversations"
```

---

## Task 10: Invite flow — Agent / Client role options

**Goal:** Admin and Manager can invite a new user with role `Agent` or `Client`. Managers can only invite into their own teams.

**Files:**
- Modify: `src/pages/SettingsPage.jsx` (the user-invite form)
- Reference: `supabase/functions/user-notify/` (email payload)

**Step 1: Read the current invite code in SettingsPage**

```bash
grep -n "inviting\|inviteEmail\|role" src/pages/SettingsPage.jsx | head -30
```

Locate the `<form>` or button that creates/invites a user. It likely inserts into `profiles` + `profile_teams` and calls `supabase.functions.invoke('user-notify', ...)`.

**Step 2: Add role + team selector to the invite UI**

Extend the invite form with:
- A role `<select>` with options: `Staff`, `Manager` (Admin only), `Agent`, `Client`
- A team `<select>` (managers see only their own teams; admins see all)

On submit:
- Insert into `profiles` with the chosen `role` (set `profiles.team_id` to the primary team)
- Insert into `profile_teams` with:
  - `role = 'Staff'` for Staff
  - `role = 'Manager'` for Manager
  - `role = 'Agent'` for Agent
  - `role = 'Client'` for Client
  - `is_primary = true`
- Invoke `user-notify` edge function for the invite email (unchanged payload)

Manager-path validation (client-side): filter team options to `profile.team_ids.filter(tid => profile.team_roles[tid] === 'Manager')`. The RLS policies on `profile_teams` already enforce this server-side (migration 008), but client-side filtering avoids a confusing rejection.

**Step 3: Gate Manager role for Admin only**

```jsx
const roleOptions = isAdmin
  ? ['Staff', 'Manager', 'Agent', 'Client']
  : ['Staff', 'Agent', 'Client']
```

**Step 4: Manual smoke test**

Log in as a Manager. Open Settings → invite form. Confirm only your own teams are visible in the team picker. Invite a test account as `Agent`. Verify:
- `profiles.role = 'Agent'`
- `profile_teams` row exists with `role = 'Agent'`, correct `team_id`, `is_primary = true`
- Invite email sent

**Step 5: Commit**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "feat(settings): invite flow supports Agent and Client roles"
```

---

## Task 11: NotificationBell — filter task-related entries for externals

**Goal:** Externals see only hub/to-do notifications in the bell.

**Files:**
- Modify: `src/components/notifications/NotificationBell.jsx`

**Step 1: Read the current notification-composer function**

```bash
grep -n "notifications.push\|getNotifications" src/components/notifications/NotificationBell.jsx
```

Identify every `notifications.push({ type: '...' })` call. Task-related types: `comment`, any acceptance/due/red-alert types, unsetup-users card, reassignment notices.

**Step 2: Apply role-based filtering at the end of `getNotifications`**

Edit the function so that, right before returning, it filters by role:

```js
function getNotifications(myTasks, profile, unsetupUsers, recentComments, hubInvites, hubMentions, dmConversations) {
  const notifications = []
  // ... existing push calls unchanged ...

  const isExternal = profile?.role === 'Agent' || profile?.role === 'Client'
  const externalAllowedTypes = new Set(['hub-invite', 'hub-mention', 'dm'])
  // NOTE: add 'todo-assignment' and 'todo-due' types if/when those are emitted.

  return (isExternal
    ? notifications.filter(n => externalAllowedTypes.has(n.type))
    : notifications
  ).sort(...)  // keep existing sort
}
```

**Step 3: Suppress upstream queries when irrelevant (perf)**

At the top of the `NotificationBell` component, if `profile?.role` is external, short-circuit the `useTasks` fetch for unsetup users and recent comments:

```jsx
const isExternal = profile?.role === 'Agent' || profile?.role === 'Client'
// Skip task-driven data for externals.
const tasks = useTasks(isExternal ? { skip: true } : undefined)
```

This depends on `useTasks` supporting a `{ skip: true }` option — if it doesn't, leave the upstream queries alone; the final filter is sufficient correctness-wise. Note it as a perf TODO.

**Step 4: Manual smoke test**

With role `'Agent'`:
- Bell shows only hub mentions, hub invites, and DM unreads
- Task-comment notifications don't appear
- Unsetup-users card is hidden

**Step 5: Commit**

```bash
git add src/components/notifications/NotificationBell.jsx
git commit -m "feat(notifications): hide task-related entries for external users"
```

---

## Task 12: Hide externals from assignee picker + other user lists

**Goal:** Agents and Clients never appear as selectable assignees when creating/reassigning tasks.

**Files:**
- Modify: `src/hooks/useProfiles.js`
- Modify: `src/pages/AssignTaskPage.jsx` (or wherever the picker reads profiles)

**Step 1: Add optional filter to `useProfiles`**

Edit `src/hooks/useProfiles.js`. Accept an options argument:

```js
export function useProfiles({ excludeExternals = false } = {}) {
  // ... after fetch, before setting state:
  const filtered = excludeExternals
    ? data.filter(p => p.role !== 'Agent' && p.role !== 'Client')
    : data
  setProfiles(filtered)
  // ...
}
```

Keep backward compatibility: all existing callsites pass no argument and get the old behavior.

**Step 2: Pass the flag from AssignTaskPage**

In `src/pages/AssignTaskPage.jsx`:

```jsx
const { profiles } = useProfiles({ excludeExternals: true })
```

**Step 3: Manual smoke test**

Open Assign a Task. Confirm no Agent/Client accounts appear in the assignee dropdown.

**Step 4: Commit**

```bash
git add src/hooks/useProfiles.js src/pages/AssignTaskPage.jsx
git commit -m "feat(tasks): exclude Agent/Client accounts from assignee picker"
```

---

## Task 13: Verification pass + manual QA run-through

**Goal:** Confirm end-to-end behavior matches the design before handoff.

**Step 1: Run the full test suite**

```bash
npm run test:run
```
Expected: all tests pass. No regressions in existing suites.

**Step 2: Manual QA — follow the design doc checklist**

Walk through each item in `docs/plans/2026-04-21-agentboard-design.md` Section 6 "Manual QA checklist":

1. Invite an Agent into Team A → redirected to `/to-do`, 4-item sidebar, task URLs redirect
2. Assign the agent a to-do in a hub they belong to → appears on `/to-do` and notification bell
3. Switch workspace to Team B (agent belongs to both) → to-dos, hub list, and team chat re-scope
4. Manager posts in the team chat → agent receives realtime message and offline email
5. Client login → full hub access; chat widget shows only team chat
6. Remove agent from Team A → removed from Team A chat immediately (via migration 033 trigger)

For each failure, file a follow-up commit or note before closing the plan.

**Step 3: Final commit + branch ready for review**

```bash
git log --oneline main..HEAD
# Expect ~12 commits corresponding to Tasks 1–12

git status
# Expect clean working tree
```

No commit in this step — just verify the branch is ready.

---

## Out of scope (explicitly deferred)

- **Team Leader assignment UI** — the role exists at the DB level but there's no UI yet for Managers/Admins to designate a Team Leader. Pick the simplest path (role dropdown on `profile_teams` rows in Settings) in a follow-up PR.
- **Client single-client-per-team constraint** — schema permits many clients per team. Enforce in UI only when needed.
- **Per-module hub restrictions for agents** — agents are full hub members by design.
- **Cross-device workspace-switcher sync** — localStorage only.
- **Billing / contract model for client engagements** — out of scope entirely.
