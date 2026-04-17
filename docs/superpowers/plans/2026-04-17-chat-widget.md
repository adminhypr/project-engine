# Company Chat Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, floating Messenger-style 1:1 chat widget with a Recent → Teammates → Company contact list, global online presence, inline "assign task to this person" flow, and offline-delay email notifications.

**Architecture:** New Postgres tables (`conversations`, `conversation_participants`, `dm_messages`, `pending_dm_emails`, `dm_email_log`) with RLS, a `get_or_create_dm` RPC for atomic 1:1 creation, a single global `dm_messages` realtime subscription routed via a module-level `EventTarget`, a single global Supabase presence channel mounted in `AuthProvider`, and a React widget rendered once in `App.jsx`. Task assignment from a conversation uses a mini-form modal that calls the existing `useTaskActions.assignTask` and a query-string prefill on `AssignTaskPage` for the escape-hatch "Open full form" link. Messages soft-delete.

**Tech Stack:** React 18, Vite, Supabase (Postgres + Auth + Realtime + Storage + Edge Functions), Tailwind CSS, Framer Motion, Resend (email), Vitest + React Testing Library (pure-function tests).

**Spec:** `docs/superpowers/specs/2026-04-17-chat-widget-design.md`

---

## File structure

```
supabase/
  migrations/
    026_direct_messages.sql            NEW — tables, RLS, RPC, triggers, realtime, storage bucket
    027_dm_email_queue.sql             NEW — pending_dm_emails + dm_email_log + trigger
  functions/
    dm-offline-notify/
      index.ts                         NEW — Deno edge function, cron-driven
      deno.json                        NEW

src/
  lib/
    dmContacts.js                      NEW — bucketRecent/Teammates/Company + search filter
    dmUnread.js                        NEW — unread count from last_read_at
    dmPrefillUrl.js                    NEW — encode/decode query string for /assign prefill
    conversationOrdering.js            NEW — sort + pin helpers
    dmWidgetStorage.js                 NEW — localStorage read/write for widget state
    dmEventBus.js                      NEW — module-level EventTarget
    __tests__/
      dmContacts.test.js               NEW
      dmUnread.test.js                 NEW
      dmPrefillUrl.test.js             NEW
      conversationOrdering.test.js     NEW
      dmWidgetStorage.test.js          NEW

  hooks/
    useGlobalPresence.js               NEW
    useDmRealtime.js                   NEW
    useConversations.js                NEW
    useConversation.js                 NEW
    useContactList.js                  NEW

  components/
    chat/
      ChatWidget.jsx                   NEW — orchestrator (mount-point)
      ChatLauncher.jsx                 NEW
      ChatPanel.jsx                    NEW
      ContactSearch.jsx                NEW
      ContactList.jsx                  NEW
      ContactRow.jsx                   NEW
      ConversationStack.jsx            NEW
      ConversationPane.jsx             NEW
      ConversationHeader.jsx           NEW
      MessageList.jsx                  NEW
      DmChatMessage.jsx                NEW
      ChatComposer.jsx                 NEW
      AssignFromChatModal.jsx          NEW
      PresenceDot.jsx                  NEW
      ImageAttachments.jsx             NEW (Task 21)

  pages/
    AssignTaskPage.jsx                 MOD — read query-string prefill params

  components/notifications/
    NotificationBell.jsx               MOD — add "New DM" category

  hooks/
    useAuth.js                         MOD — expose presence Map via context

  App.jsx                              MOD — mount <ChatWidget /> inside auth guard

CLAUDE.md                              MOD — document chat widget
```

---

## Phased overview

- **Phase 1 (Tasks 1–14) — Minimal working DM:** migration, helpers, hooks, widget shell, contact list, single conversation pane with text-only send/delete. Ship-able on its own.
- **Phase 2 (Tasks 15–19) — Polish & integration:** multi-pane stacking, inline Assign-from-chat, NotificationBell integration, offline-email edge function.
- **Phase 3 (Task 20) — Docs:** update `CLAUDE.md`.
- **Phase 4 (Task 21) — Inline images:** upload images from the composer to the `dm-attachments` bucket and render them inline. Can be deferred; the bucket and RLS are already in place after Task 1.

Stop after Task 14 gives you a usable text-only chat. Continue into Phase 2 for full spec compliance.

---

## Task 1: Database migration — conversations, participants, messages, RLS, RPC, triggers, realtime

**Files:**
- Create: `supabase/migrations/026_direct_messages.sql`

Apply migrations locally with whatever workflow you use (`supabase db push` or the Supabase Studio SQL editor against the dev project — the codebase doesn't check in a specific tool). This task produces SQL only; the plan assumes you'll run it before Task 3.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/026_direct_messages.sql
-- 1:1 (and future group) direct messaging.

------------------------------------------------------------
-- Tables
------------------------------------------------------------
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null default 'dm' check (kind in ('dm','group')),
  title                text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  last_message_at      timestamptz not null default now(),
  last_message_preview text
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default 'epoch',
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_participants_user_idx
  on public.conversation_participants(user_id);

create table if not exists public.dm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id       uuid not null references public.profiles(id) on delete cascade,
  kind            text not null default 'user' check (kind in ('user','system')),
  content         text,
  mentions        jsonb not null default '[]'::jsonb,
  inline_images   jsonb not null default '[]'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists dm_messages_conversation_created_idx
  on public.dm_messages(conversation_id, created_at desc);

------------------------------------------------------------
-- Helper: am I a participant in this conversation?
-- SECURITY DEFINER to break RLS recursion between tables.
------------------------------------------------------------
create or replace function public.is_conversation_participant(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = cid and user_id = auth.uid()
  );
$$;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

------------------------------------------------------------
-- RLS
------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.dm_messages enable row level security;

-- conversations
drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant" on public.conversations
  for select using (public.is_conversation_participant(id));

drop policy if exists "conversations_update_participant" on public.conversations;
create policy "conversations_update_participant" on public.conversations
  for update using (public.is_conversation_participant(id));
-- No INSERT or DELETE policy: default-deny. Created exclusively via RPC.

-- conversation_participants
drop policy if exists "conv_participants_select" on public.conversation_participants;
create policy "conv_participants_select" on public.conversation_participants
  for select using (
    user_id = auth.uid() or public.is_conversation_participant(conversation_id)
  );

drop policy if exists "conv_participants_update_own" on public.conversation_participants;
create policy "conv_participants_update_own" on public.conversation_participants
  for update using (user_id = auth.uid());
-- No INSERT or DELETE policy: default-deny. Created exclusively via RPC.

-- dm_messages
drop policy if exists "dm_messages_select_participant" on public.dm_messages;
create policy "dm_messages_select_participant" on public.dm_messages
  for select using (public.is_conversation_participant(conversation_id));

drop policy if exists "dm_messages_insert_participant" on public.dm_messages;
create policy "dm_messages_insert_participant" on public.dm_messages
  for insert with check (
    public.is_conversation_participant(conversation_id)
    and author_id = auth.uid()
  );

drop policy if exists "dm_messages_update_author" on public.dm_messages;
create policy "dm_messages_update_author" on public.dm_messages
  for update using (author_id = auth.uid());
-- No DELETE policy: soft-delete only via UPDATE.

------------------------------------------------------------
-- RPC: atomic get-or-create 1:1 between current user and other
------------------------------------------------------------
create or replace function public.get_or_create_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'invalid other user';
  end if;

  select c.id into existing
  from public.conversations c
  where c.kind = 'dm'
    and exists (select 1 from public.conversation_participants cp
                 where cp.conversation_id = c.id and cp.user_id = me)
    and exists (select 1 from public.conversation_participants cp
                 where cp.conversation_id = c.id and cp.user_id = other_user_id)
    and (select count(*) from public.conversation_participants cp
          where cp.conversation_id = c.id) = 2
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.conversations (kind, created_by)
    values ('dm', me) returning id into new_id;
  insert into public.conversation_participants (conversation_id, user_id)
    values (new_id, me), (new_id, other_user_id);
  return new_id;
end;
$$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

------------------------------------------------------------
-- RPC: mark conversation read
------------------------------------------------------------
create or replace function public.mark_conversation_read(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_participants
    set last_read_at = now()
    where conversation_id = cid and user_id = auth.uid();
end;
$$;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

------------------------------------------------------------
-- Trigger: bump conversation.last_message_at + preview on message insert
------------------------------------------------------------
create or replace function public.bump_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
    set last_message_at      = new.created_at,
        last_message_preview = left(coalesce(new.content, ''), 140)
    where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists dm_messages_bump_last on public.dm_messages;
create trigger dm_messages_bump_last
  after insert on public.dm_messages
  for each row execute function public.bump_conversation_last_message();

------------------------------------------------------------
-- Realtime publication
------------------------------------------------------------
alter publication supabase_realtime add table public.dm_messages;
alter publication supabase_realtime add table public.conversations;

------------------------------------------------------------
-- Storage bucket for DM inline images
------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('dm-attachments', 'dm-attachments', false, 5242880)
on conflict (id) do nothing;

-- Storage RLS: only participants in the referenced conversation can read/write.
-- Object paths are namespaced as: {conversation_id}/{message_id or uuid}/{filename}
drop policy if exists "dm_attachments_read_participant" on storage.objects;
create policy "dm_attachments_read_participant" on storage.objects
  for select using (
    bucket_id = 'dm-attachments'
    and public.is_conversation_participant(
      (storage.foldername(name))[1]::uuid
    )
  );

drop policy if exists "dm_attachments_insert_participant" on storage.objects;
create policy "dm_attachments_insert_participant" on storage.objects
  for insert with check (
    bucket_id = 'dm-attachments'
    and public.is_conversation_participant(
      (storage.foldername(name))[1]::uuid
    )
  );
```

- [ ] **Step 2: Apply the migration**

Use whichever path you normally use for this project. A safe default, using psql against your dev project connection string stored in `SUPABASE_DB_URL`:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/026_direct_messages.sql
```

Expected: no errors. The script is idempotent (uses `if not exists`, `drop policy if exists`, `on conflict do nothing`) so re-running is safe.

- [ ] **Step 3: Smoke-test the RPC and RLS via psql**

```bash
# As a logged-in user A (substitute A's JWT via supabase-js locally). From psql as superuser:
# Confirm that RLS rejects a direct insert into conversations.
psql "$SUPABASE_DB_URL" -c "set role authenticated; insert into public.conversations (kind) values ('dm');"
```

Expected: `ERROR: new row violates row-level security policy`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/026_direct_messages.sql
git commit -m "feat(chat): add direct messaging tables, RLS, RPC, realtime publication"
```

---

## Task 2: Pure helpers with tests — `dmWidgetStorage.js`

**Files:**
- Create: `src/lib/dmWidgetStorage.js`
- Create: `src/lib/__tests__/dmWidgetStorage.test.js`

Stores per-profile widget state in `localStorage` under key `pe-chat-state-{profileId}`. Shape: `{ expanded: boolean, openConversationIds: string[], minimizedIds: string[] }`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/dmWidgetStorage.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { readWidgetState, writeWidgetState, DEFAULT_STATE } from '../dmWidgetStorage'

describe('dmWidgetStorage', () => {
  beforeEach(() => { localStorage.clear() })

  it('returns default state when nothing is stored', () => {
    expect(readWidgetState('user-1')).toEqual(DEFAULT_STATE)
  })

  it('round-trips state for a profile', () => {
    const state = { expanded: true, openConversationIds: ['c1','c2'], minimizedIds: ['c3'] }
    writeWidgetState('user-1', state)
    expect(readWidgetState('user-1')).toEqual(state)
  })

  it('isolates state per profile id', () => {
    writeWidgetState('user-1', { expanded: true, openConversationIds: ['a'], minimizedIds: [] })
    writeWidgetState('user-2', { expanded: false, openConversationIds: [], minimizedIds: ['b'] })
    expect(readWidgetState('user-1').openConversationIds).toEqual(['a'])
    expect(readWidgetState('user-2').minimizedIds).toEqual(['b'])
  })

  it('falls back to default on malformed JSON', () => {
    localStorage.setItem('pe-chat-state-user-1', '{not valid json')
    expect(readWidgetState('user-1')).toEqual(DEFAULT_STATE)
  })

  it('falls back to default on wrong shape', () => {
    localStorage.setItem('pe-chat-state-user-1', JSON.stringify({ foo: 'bar' }))
    expect(readWidgetState('user-1')).toEqual(DEFAULT_STATE)
  })

  it('returns default when profileId is falsy', () => {
    expect(readWidgetState(null)).toEqual(DEFAULT_STATE)
    expect(readWidgetState(undefined)).toEqual(DEFAULT_STATE)
    expect(readWidgetState('')).toEqual(DEFAULT_STATE)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- src/lib/__tests__/dmWidgetStorage.test.js --run`
Expected: 6 failures with `Cannot find module '../dmWidgetStorage'`.

- [ ] **Step 3: Implement**

Create `src/lib/dmWidgetStorage.js`:

```js
export const DEFAULT_STATE = Object.freeze({
  expanded: false,
  openConversationIds: [],
  minimizedIds: [],
})

function storageKey(profileId) {
  return `pe-chat-state-${profileId}`
}

function isValidState(value) {
  return value
    && typeof value === 'object'
    && typeof value.expanded === 'boolean'
    && Array.isArray(value.openConversationIds)
    && Array.isArray(value.minimizedIds)
}

export function readWidgetState(profileId) {
  if (!profileId) return { ...DEFAULT_STATE }
  try {
    const raw = localStorage.getItem(storageKey(profileId))
    if (!raw) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw)
    if (!isValidState(parsed)) return { ...DEFAULT_STATE }
    return parsed
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function writeWidgetState(profileId, state) {
  if (!profileId) return
  try {
    localStorage.setItem(storageKey(profileId), JSON.stringify(state))
  } catch {
    // localStorage can be unavailable (private mode, quota, etc.) — silent fail is fine
  }
}

export function clearWidgetState(profileId) {
  if (!profileId) return
  localStorage.removeItem(storageKey(profileId))
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- src/lib/__tests__/dmWidgetStorage.test.js --run`
Expected: all 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dmWidgetStorage.js src/lib/__tests__/dmWidgetStorage.test.js
git commit -m "feat(chat): add widget state localStorage helper"
```

---

## Task 3: Pure helpers with tests — `dmUnread.js`

**Files:**
- Create: `src/lib/dmUnread.js`
- Create: `src/lib/__tests__/dmUnread.test.js`

Given a `lastReadAt` ISO string and an array of messages `[{ created_at, author_id }]`, returns the number of messages newer than `lastReadAt` authored by someone other than me. Total-unread-across-conversations helper too.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/dmUnread.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { unreadCount, totalUnread } from '../dmUnread'

const me = 'me'
const other = 'other'

describe('unreadCount', () => {
  it('returns 0 for empty messages', () => {
    expect(unreadCount([], '2026-04-17T00:00:00Z', me)).toBe(0)
  })

  it('counts messages newer than lastReadAt authored by others', () => {
    const msgs = [
      { created_at: '2026-04-17T10:00:00Z', author_id: other },
      { created_at: '2026-04-17T11:00:00Z', author_id: other },
      { created_at: '2026-04-17T12:00:00Z', author_id: me },
    ]
    expect(unreadCount(msgs, '2026-04-17T09:00:00Z', me)).toBe(2)
  })

  it('ignores my own messages', () => {
    const msgs = [
      { created_at: '2026-04-17T10:00:00Z', author_id: me },
      { created_at: '2026-04-17T11:00:00Z', author_id: me },
    ]
    expect(unreadCount(msgs, '2026-04-17T09:00:00Z', me)).toBe(0)
  })

  it('ignores messages at or before lastReadAt', () => {
    const msgs = [
      { created_at: '2026-04-17T09:00:00Z', author_id: other },
      { created_at: '2026-04-17T08:00:00Z', author_id: other },
    ]
    expect(unreadCount(msgs, '2026-04-17T09:00:00Z', me)).toBe(0)
  })

  it('treats null lastReadAt as "nothing read yet"', () => {
    const msgs = [{ created_at: '2026-04-17T01:00:00Z', author_id: other }]
    expect(unreadCount(msgs, null, me)).toBe(1)
  })
})

describe('totalUnread', () => {
  it('sums unread counts across conversations', () => {
    const convs = [
      { unread: 3 }, { unread: 0 }, { unread: 1 },
    ]
    expect(totalUnread(convs)).toBe(4)
  })
  it('handles missing unread field as 0', () => {
    expect(totalUnread([{}, { unread: 2 }])).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- src/lib/__tests__/dmUnread.test.js --run`
Expected: failures with `Cannot find module '../dmUnread'`.

- [ ] **Step 3: Implement**

Create `src/lib/dmUnread.js`:

```js
export function unreadCount(messages, lastReadAt, myUserId) {
  if (!messages || messages.length === 0) return 0
  const threshold = lastReadAt ? Date.parse(lastReadAt) : 0
  let count = 0
  for (const m of messages) {
    if (m.author_id === myUserId) continue
    if (Date.parse(m.created_at) > threshold) count++
  }
  return count
}

export function totalUnread(conversations) {
  if (!conversations) return 0
  return conversations.reduce((sum, c) => sum + (c.unread || 0), 0)
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- src/lib/__tests__/dmUnread.test.js --run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dmUnread.js src/lib/__tests__/dmUnread.test.js
git commit -m "feat(chat): add unread message counter helpers"
```

---

## Task 4: Pure helpers with tests — `dmContacts.js`

**Files:**
- Create: `src/lib/dmContacts.js`
- Create: `src/lib/__tests__/dmContacts.test.js`

Buckets a `profiles` array into `{ recent, teammates, company }` for the contact list, excluding self and dedup-ing across buckets. Also provides a fuzzy search filter.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/dmContacts.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { bucketContacts, filterContactsBySearch } from '../dmContacts'

const myId = 'me'
const myTeamIds = ['t1', 't2']

// profile shape mirrors useProfiles enrichment
function p(id, name, teamIds = []) {
  return { id, full_name: name, email: `${id}@x`, avatar_url: null, team_ids: teamIds }
}

// conversation shape from useConversations
function c(convId, otherId, lastAt, unread = 0) {
  return { id: convId, other_user_id: otherId, last_message_at: lastAt, unread }
}

describe('bucketContacts', () => {
  const profiles = [
    p('me', 'Me', ['t1']),
    p('u1', 'Alice',   ['t1']),       // teammate
    p('u2', 'Bob',     ['t2']),       // teammate (other team I'm on)
    p('u3', 'Carol',   ['t3']),       // company, not teammate
    p('u4', 'Dan',     ['t1']),       // teammate, but also in Recent
    p('u5', 'Eve',     ['t4']),       // company, also in Recent
  ]
  const conversations = [
    c('cvA', 'u4', '2026-04-17T10:00:00Z', 1),
    c('cvB', 'u5', '2026-04-17T09:00:00Z', 0),
  ]

  it('excludes self from every bucket', () => {
    const { recent, teammates, company } = bucketContacts({ profiles, conversations, myId, myTeamIds })
    const ids = [...recent, ...teammates, ...company].map(r => r.profile.id)
    expect(ids).not.toContain(myId)
  })

  it('puts conversation partners in Recent, sorted by last_message_at desc', () => {
    const { recent } = bucketContacts({ profiles, conversations, myId, myTeamIds })
    expect(recent.map(r => r.profile.id)).toEqual(['u4', 'u5'])
    expect(recent[0].conversation.id).toBe('cvA')
  })

  it('caps Recent at 8 entries', () => {
    const many = Array.from({ length: 12 }, (_, i) => c(`cv${i}`, `u${i}`, `2026-04-17T${10+i}:00:00Z`))
    const profs = [
      p('me', 'Me', ['t1']),
      ...Array.from({ length: 12 }, (_, i) => p(`u${i}`, `User${i}`, [])),
    ]
    const { recent } = bucketContacts({ profiles: profs, conversations: many, myId, myTeamIds })
    expect(recent).toHaveLength(8)
  })

  it('puts profiles sharing any of my teams in Teammates, minus Recent', () => {
    const { teammates } = bucketContacts({ profiles, conversations, myId, myTeamIds })
    // u1, u2 are teammates. u4 is a teammate but in Recent → excluded.
    expect(teammates.map(r => r.profile.id).sort()).toEqual(['u1', 'u2'])
  })

  it('puts everyone else in Company', () => {
    const { company } = bucketContacts({ profiles, conversations, myId, myTeamIds })
    // u3 is the only non-self, non-teammate, non-recent profile.
    expect(company.map(r => r.profile.id)).toEqual(['u3'])
  })

  it('handles profiles with missing team_ids as empty array', () => {
    const profs = [p('me', 'Me', ['t1']), { id: 'u1', full_name: 'NoTeams', email: 'x', avatar_url: null }]
    const { company, teammates } = bucketContacts({ profiles: profs, conversations: [], myId, myTeamIds })
    expect(teammates).toEqual([])
    expect(company.map(r => r.profile.id)).toEqual(['u1'])
  })
})

describe('filterContactsBySearch', () => {
  const sections = {
    recent:    [{ profile: p('u1', 'Alice Smith') }],
    teammates: [{ profile: p('u2', 'Bob Brown') }, { profile: p('u3', 'Alice Jones') }],
    company:   [{ profile: p('u4', 'Carol Davis') }],
  }

  it('returns all sections when query is empty', () => {
    const out = filterContactsBySearch(sections, '')
    expect(out).toEqual(sections)
  })

  it('matches case-insensitively by name, preserving sections', () => {
    const out = filterContactsBySearch(sections, 'alice')
    expect(out.recent.map(r => r.profile.id)).toEqual(['u1'])
    expect(out.teammates.map(r => r.profile.id)).toEqual(['u3'])
    expect(out.company).toEqual([])
  })

  it('trims whitespace and ignores pure-whitespace queries', () => {
    const out = filterContactsBySearch(sections, '   ')
    expect(out).toEqual(sections)
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- src/lib/__tests__/dmContacts.test.js --run`
Expected: failures with module not found.

- [ ] **Step 3: Implement**

Create `src/lib/dmContacts.js`:

```js
const RECENT_CAP = 8

export function bucketContacts({ profiles, conversations, myId, myTeamIds }) {
  const myTeamSet = new Set(myTeamIds || [])

  // Build Recent from conversations, sorted desc, capped
  const sortedConvs = [...(conversations || [])]
    .filter(c => c.other_user_id && c.other_user_id !== myId)
    .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at))
    .slice(0, RECENT_CAP)

  const profileById = new Map(profiles.map(p => [p.id, p]))
  const recent = []
  const recentIdSet = new Set()
  for (const c of sortedConvs) {
    const prof = profileById.get(c.other_user_id)
    if (!prof) continue
    recent.push({ profile: prof, conversation: c })
    recentIdSet.add(prof.id)
  }

  const teammates = []
  const company = []
  for (const prof of profiles) {
    if (prof.id === myId) continue
    if (recentIdSet.has(prof.id)) continue
    const teamIds = Array.isArray(prof.team_ids) ? prof.team_ids : []
    const sharesTeam = teamIds.some(tid => myTeamSet.has(tid))
    if (sharesTeam) teammates.push({ profile: prof })
    else company.push({ profile: prof })
  }

  // Alpha sort within Teammates and Company for stability
  const byName = (a, b) => (a.profile.full_name || '').localeCompare(b.profile.full_name || '')
  teammates.sort(byName)
  company.sort(byName)

  return { recent, teammates, company }
}

export function filterContactsBySearch(sections, rawQuery) {
  const q = (rawQuery || '').trim().toLowerCase()
  if (!q) return sections
  const match = row => (row.profile.full_name || '').toLowerCase().includes(q)
  return {
    recent:    sections.recent.filter(match),
    teammates: sections.teammates.filter(match),
    company:   sections.company.filter(match),
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- src/lib/__tests__/dmContacts.test.js --run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dmContacts.js src/lib/__tests__/dmContacts.test.js
git commit -m "feat(chat): add contact list bucketing + search filter"
```

---

## Task 5: Pure helpers with tests — `conversationOrdering.js` and `dmPrefillUrl.js`

**Files:**
- Create: `src/lib/conversationOrdering.js`
- Create: `src/lib/dmPrefillUrl.js`
- Create: `src/lib/__tests__/conversationOrdering.test.js`
- Create: `src/lib/__tests__/dmPrefillUrl.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/conversationOrdering.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { sortByLastMessage, upsertConversation } from '../conversationOrdering'

describe('sortByLastMessage', () => {
  it('sorts descending by last_message_at', () => {
    const input = [
      { id: 'a', last_message_at: '2026-04-17T10:00:00Z' },
      { id: 'b', last_message_at: '2026-04-17T12:00:00Z' },
      { id: 'c', last_message_at: '2026-04-17T11:00:00Z' },
    ]
    expect(sortByLastMessage(input).map(c => c.id)).toEqual(['b', 'c', 'a'])
  })
  it('does not mutate the input', () => {
    const input = [{ id: 'a', last_message_at: '2026-04-17T10:00:00Z' }]
    sortByLastMessage(input)
    expect(input[0].id).toBe('a')
  })
})

describe('upsertConversation', () => {
  const conv = (id, t, preview) => ({ id, last_message_at: t, last_message_preview: preview, unread: 0 })

  it('adds a new conversation at the top', () => {
    const list = [conv('a', '2026-04-17T10:00:00Z', 'old')]
    const out = upsertConversation(list, conv('b', '2026-04-17T11:00:00Z', 'new'))
    expect(out.map(c => c.id)).toEqual(['b', 'a'])
  })
  it('updates an existing conversation and re-sorts', () => {
    const list = [
      conv('a', '2026-04-17T10:00:00Z', 'old'),
      conv('b', '2026-04-17T09:00:00Z', 'older'),
    ]
    const out = upsertConversation(list, { ...conv('b', '2026-04-17T12:00:00Z', 'newest'), unread: 5 })
    expect(out[0].id).toBe('b')
    expect(out[0].last_message_preview).toBe('newest')
    expect(out[0].unread).toBe(5)
  })
})
```

Create `src/lib/__tests__/dmPrefillUrl.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildPrefillUrl, parsePrefillParams } from '../dmPrefillUrl'

describe('buildPrefillUrl', () => {
  it('builds an /assign URL with encoded params', () => {
    const url = buildPrefillUrl({
      assigneeId: 'u1', teamId: 't1', title: 'Q1 report', urgency: 'High',
      dueDate: '2026-04-20', notes: 'hello & goodbye',
    })
    expect(url).toBe(
      '/assign?assignee=u1&team=t1&title=Q1+report&urgency=High&due=2026-04-20&notes=hello+%26+goodbye'
    )
  })
  it('omits undefined/null/empty params', () => {
    const url = buildPrefillUrl({ assigneeId: 'u1' })
    expect(url).toBe('/assign?assignee=u1')
  })
})

describe('parsePrefillParams', () => {
  it('extracts all known keys', () => {
    const params = new URLSearchParams(
      'assignee=u1&team=t1&title=Q1+report&urgency=High&due=2026-04-20&notes=hi'
    )
    expect(parsePrefillParams(params)).toEqual({
      assigneeId: 'u1', teamId: 't1', title: 'Q1 report',
      urgency: 'High', dueDate: '2026-04-20', notes: 'hi',
    })
  })
  it('returns an object with undefined fields for missing keys', () => {
    const params = new URLSearchParams('assignee=u1')
    const parsed = parsePrefillParams(params)
    expect(parsed.assigneeId).toBe('u1')
    expect(parsed.title).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- src/lib/__tests__/conversationOrdering.test.js src/lib/__tests__/dmPrefillUrl.test.js --run`
Expected: failures, module not found for both.

- [ ] **Step 3: Implement `conversationOrdering.js`**

Create `src/lib/conversationOrdering.js`:

```js
export function sortByLastMessage(conversations) {
  return [...(conversations || [])].sort(
    (a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at)
  )
}

export function upsertConversation(list, updated) {
  const others = (list || []).filter(c => c.id !== updated.id)
  return sortByLastMessage([updated, ...others])
}
```

- [ ] **Step 4: Implement `dmPrefillUrl.js`**

Create `src/lib/dmPrefillUrl.js`:

```js
const KEY_TO_PARAM = {
  assigneeId: 'assignee',
  teamId:     'team',
  title:      'title',
  urgency:    'urgency',
  dueDate:    'due',
  notes:      'notes',
}

export function buildPrefillUrl(fields) {
  const params = new URLSearchParams()
  for (const [key, param] of Object.entries(KEY_TO_PARAM)) {
    const val = fields?.[key]
    if (val == null || val === '') continue
    params.append(param, val)
  }
  const qs = params.toString()
  return qs ? `/assign?${qs}` : '/assign'
}

export function parsePrefillParams(urlSearchParams) {
  const out = {}
  for (const [key, param] of Object.entries(KEY_TO_PARAM)) {
    const val = urlSearchParams.get(param)
    if (val !== null) out[key] = val
  }
  return out
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- src/lib/__tests__/conversationOrdering.test.js src/lib/__tests__/dmPrefillUrl.test.js --run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/conversationOrdering.js src/lib/dmPrefillUrl.js src/lib/__tests__/conversationOrdering.test.js src/lib/__tests__/dmPrefillUrl.test.js
git commit -m "feat(chat): add conversation sort + /assign prefill URL helpers"
```

---

## Task 6: Module-level event bus — `dmEventBus.js`

**Files:**
- Create: `src/lib/dmEventBus.js`

This is a trivial wrapper; no dedicated test file — it gets exercised by the hooks that consume it.

- [ ] **Step 1: Create the file**

Create `src/lib/dmEventBus.js`:

```js
// Module-level EventTarget that bridges the single global dm_messages
// subscription (in useDmRealtime) to per-conversation consumers
// (useConversation) and the conversation list (useConversations).
//
// Events:
//   "message"  detail: { conversationId, message }
//   "read"     detail: { conversationId, userId, readAt }

const bus = new EventTarget()

export function emitMessage(conversationId, message) {
  bus.dispatchEvent(new CustomEvent('message', { detail: { conversationId, message } }))
}

export function emitRead(conversationId, userId, readAt) {
  bus.dispatchEvent(new CustomEvent('read', { detail: { conversationId, userId, readAt } }))
}

export function onMessage(handler) {
  const wrapped = (e) => handler(e.detail)
  bus.addEventListener('message', wrapped)
  return () => bus.removeEventListener('message', wrapped)
}

export function onRead(handler) {
  const wrapped = (e) => handler(e.detail)
  bus.addEventListener('read', wrapped)
  return () => bus.removeEventListener('read', wrapped)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/dmEventBus.js
git commit -m "feat(chat): add module-level event bus for realtime fan-out"
```

---

## Task 7: `useGlobalPresence` hook

**Files:**
- Create: `src/hooks/useGlobalPresence.js`

One Supabase presence channel per authenticated session, joined for the whole app lifecycle. Returns a `Map<userId, { online: true, onlineAt: string }>`.

- [ ] **Step 1: Create the hook**

Create `src/hooks/useGlobalPresence.js`:

```js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const CHANNEL = 'pe-global-presence'

export function useGlobalPresence(profile) {
  const [presence, setPresence] = useState(() => new Map())

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase.channel(CHANNEL, {
      config: { presence: { key: profile.id } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const next = new Map()
        for (const [userId, metas] of Object.entries(state)) {
          const latest = metas[metas.length - 1]
          next.set(userId, { online: true, onlineAt: latest?.online_at })
        }
        setPresence(next)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: profile.id,
            full_name: profile.full_name,
            avatar_url: profile.avatar_url,
            online_at: new Date().toISOString(),
          })
        }
      })

    return () => {
      channel.untrack()
      supabase.removeChannel(channel)
    }
  }, [profile?.id, profile?.full_name, profile?.avatar_url])

  return presence
}
```

- [ ] **Step 2: Smoke check via dev server**

Run `npm run dev` and temporarily call `useGlobalPresence(profile)` in a dev-only sandbox (or skip — this hook is tested indirectly once wired in Task 15). No visible output yet. Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGlobalPresence.js
git commit -m "feat(chat): add app-wide presence hook"
```

---

## Task 8: `useDmRealtime` hook (single global subscription)

**Files:**
- Create: `src/hooks/useDmRealtime.js`

Subscribes once to `dm_messages` INSERT events. RLS limits delivery to rows from conversations the current user participates in. Fetches the enriched row (with author profile), then emits on the event bus.

- [ ] **Step 1: Create the hook**

Create `src/hooks/useDmRealtime.js`:

```js
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { emitMessage } from '../lib/dmEventBus'

export function useDmRealtime(profileId) {
  useEffect(() => {
    if (!profileId) return

    const channel = supabase
      .channel(`pe-dm-global-${profileId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages' },
        async (payload) => {
          const { data, error } = await supabase
            .from('dm_messages')
            .select('*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url)')
            .eq('id', payload.new.id)
            .maybeSingle()
          if (error || !data) return
          emitMessage(data.conversation_id, data)
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [profileId])
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useDmRealtime.js
git commit -m "feat(chat): add single global DM realtime subscription hook"
```

---

## Task 9: `useConversations` hook

**Files:**
- Create: `src/hooks/useConversations.js`

Fetches the current user's conversations with the "other participant" profile joined in, plus a computed unread count. Listens to the event bus and upserts on incoming messages. Exposes `createOrOpen(otherUserId)` which calls the RPC and refetches.

- [ ] **Step 1: Create the hook**

Create `src/hooks/useConversations.js`:

```js
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { upsertConversation, sortByLastMessage } from '../lib/conversationOrdering'
import { onMessage } from '../lib/dmEventBus'

// Row shape returned by this hook:
//   { id, kind, last_message_at, last_message_preview,
//     last_read_at, other_user_id, other_profile, unread }

async function fetchConversationsForUser(userId) {
  // 1. All participant rows for me, plus the conversation row
  const { data: myRows, error: myErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at, muted, conversation:conversations!inner(id, kind, last_message_at, last_message_preview)')
    .eq('user_id', userId)
  if (myErr) throw myErr
  if (!myRows || myRows.length === 0) return []

  const convIds = myRows.map(r => r.conversation_id)

  // 2. All other participants for those conversations
  const { data: allParts, error: partsErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id')
    .in('conversation_id', convIds)
    .neq('user_id', userId)
  if (partsErr) throw partsErr

  const otherIds = [...new Set(allParts.map(p => p.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, email, team_id')
    .in('id', otherIds)
  const profileById = new Map((profiles || []).map(p => [p.id, p]))

  // 3. Per-conversation unread count (messages newer than my last_read_at, not authored by me)
  const unreadCounts = new Map()
  await Promise.all(myRows.map(async (row) => {
    const { count } = await supabase
      .from('dm_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', row.conversation_id)
      .neq('author_id', userId)
      .gt('created_at', row.last_read_at)
    unreadCounts.set(row.conversation_id, count || 0)
  }))

  // 4. Stitch together
  const out = myRows.map(row => {
    const otherId = allParts.find(p => p.conversation_id === row.conversation_id)?.user_id
    const otherProfile = otherId ? profileById.get(otherId) : null
    return {
      id: row.conversation_id,
      kind: row.conversation.kind,
      last_message_at: row.conversation.last_message_at,
      last_message_preview: row.conversation.last_message_preview,
      last_read_at: row.last_read_at,
      muted: row.muted,
      other_user_id: otherId,
      other_profile: otherProfile,
      unread: unreadCounts.get(row.conversation_id) || 0,
    }
  })

  return sortByLastMessage(out)
}

export function useConversations() {
  const { profile } = useAuth()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const convsRef = useRef([])
  convsRef.current = conversations

  const refetch = useCallback(async () => {
    if (!profile?.id) return
    try {
      const data = await fetchConversationsForUser(profile.id)
      setConversations(data)
    } catch (e) {
      showToast('Failed to load conversations', 'error')
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) { setConversations([]); setLoading(false); return }
    setLoading(true)
    refetch()
  }, [profile?.id, refetch])

  // React to incoming messages via event bus
  useEffect(() => {
    if (!profile?.id) return
    return onMessage(({ conversationId, message }) => {
      const existing = convsRef.current.find(c => c.id === conversationId)
      if (!existing) {
        // New conversation someone started with me — do a full refetch
        refetch()
        return
      }
      const updated = {
        ...existing,
        last_message_at: message.created_at,
        last_message_preview: (message.content || '').slice(0, 140),
        unread: message.author_id === profile.id
          ? existing.unread
          : (existing.unread + 1),
      }
      setConversations(prev => upsertConversation(prev, updated))
    })
  }, [profile?.id, refetch])

  const createOrOpen = useCallback(async (otherUserId) => {
    if (!profile?.id || !otherUserId) return null
    const { data, error } = await supabase.rpc('get_or_create_dm', { other_user_id: otherUserId })
    if (error) { showToast('Failed to open conversation', 'error'); return null }
    // Make sure it's in our list
    if (!convsRef.current.find(c => c.id === data)) {
      await refetch()
    }
    return data
  }, [profile?.id, refetch])

  const markRead = useCallback(async (conversationId) => {
    const { error } = await supabase.rpc('mark_conversation_read', { cid: conversationId })
    if (error) return
    setConversations(prev => prev.map(c =>
      c.id === conversationId
        ? { ...c, last_read_at: new Date().toISOString(), unread: 0 }
        : c
    ))
  }, [])

  return { conversations, loading, refetch, createOrOpen, markRead }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useConversations.js
git commit -m "feat(chat): add useConversations hook with realtime fan-out"
```

---

## Task 10: `useConversation` hook (single-thread message stream)

**Files:**
- Create: `src/hooks/useConversation.js`

Handles fetching paginated messages for one conversation, sending, soft-deleting, and listening to the event bus for inbound messages.

- [ ] **Step 1: Create the hook**

Create `src/hooks/useConversation.js`:

```js
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { onMessage } from '../lib/dmEventBus'

const PAGE_SIZE = 50

const MSG_SELECT =
  '*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url)'

export function useConversation(conversationId) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const cidRef = useRef(conversationId)
  cidRef.current = conversationId

  const fetchPage = useCallback(async (cursor) => {
    if (!cidRef.current) return []
    let q = supabase
      .from('dm_messages')
      .select(MSG_SELECT)
      .eq('conversation_id', cidRef.current)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (cursor) q = q.lt('created_at', cursor)
    const { data, error } = await q
    if (error) { showToast('Failed to load messages', 'error'); return [] }
    return (data || []).reverse()
  }, [])

  useEffect(() => {
    if (!conversationId) { setMessages([]); setLoading(false); return }
    setLoading(true)
    setMessages([])
    setHasMore(true)
    fetchPage().then(rows => {
      setMessages(rows)
      setHasMore(rows.length === PAGE_SIZE)
      setLoading(false)
    })
  }, [conversationId, fetchPage])

  // Listen to the event bus for new messages in this conversation
  useEffect(() => {
    if (!conversationId) return
    return onMessage(({ conversationId: cid, message }) => {
      if (cid !== conversationId) return
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev
        return [...prev, message]
      })
    })
  }, [conversationId])

  const sendMessage = useCallback(async (content, inlineImages = []) => {
    const cid = cidRef.current
    if (!cid || !profile?.id || !content.trim()) return false
    const { error } = await supabase.from('dm_messages').insert({
      conversation_id: cid,
      author_id: profile.id,
      kind: 'user',
      content: content.trim(),
      inline_images: inlineImages.map(({ preview, ...rest }) => rest),
    })
    if (error) { showToast('Failed to send message', 'error'); return false }
    return true
  }, [profile?.id])

  const sendSystemMessage = useCallback(async (content) => {
    const cid = cidRef.current
    if (!cid || !profile?.id) return false
    const { error } = await supabase.from('dm_messages').insert({
      conversation_id: cid,
      author_id: profile.id,
      kind: 'system',
      content,
    })
    if (error) { showToast('Failed to post system message', 'error'); return false }
    return true
  }, [profile?.id])

  const deleteMessage = useCallback(async (messageId) => {
    const { error } = await supabase
      .from('dm_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)
    if (error) { showToast('Failed to delete message', 'error'); return }
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
    ))
  }, [])

  const loadMore = useCallback(async () => {
    if (!hasMore || messages.length === 0) return
    const cursor = messages[0].created_at
    const older = await fetchPage(cursor)
    setMessages(prev => [...older, ...prev])
    setHasMore(older.length === PAGE_SIZE)
  }, [hasMore, messages, fetchPage])

  return { messages, loading, hasMore, sendMessage, sendSystemMessage, deleteMessage, loadMore }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useConversation.js
git commit -m "feat(chat): add useConversation hook for single-thread stream"
```

---

## Task 11: `useContactList` hook + mount `useDmRealtime` and `useGlobalPresence` in `AuthProvider`

**Files:**
- Create: `src/hooks/useContactList.js`
- Modify: `src/hooks/useAuth.js` (see context below — mount presence + realtime there so every authenticated page benefits)

The contact list hook composes `useProfiles`, `useConversations`, and presence.

- [ ] **Step 1: Read the existing AuthProvider to pick a mount point**

Read `src/hooks/useAuth.js`. Identify where `profile` becomes available inside the provider and where its `return` value is assembled. We'll add two effects after `profile` resolves.

- [ ] **Step 2: Add presence + realtime mounts to AuthProvider**

In `src/hooks/useAuth.js`, inside `AuthProvider`, after `profile` is resolved and before the `return`, call the two hooks and expose the presence Map through context. **Exact diff sketch** — the existing file's structure dictates placement, but the adds are:

```js
// new imports at top
import { useGlobalPresence } from './useGlobalPresence'
import { useDmRealtime } from './useDmRealtime'

// inside AuthProvider, after `profile` state exists:
const presence = useGlobalPresence(profile)
useDmRealtime(profile?.id)

// in the context value object, add:
// presence,
```

- [ ] **Step 3: Expose `presence` in the `useAuth()` return**

In the same file, make sure the `value` passed to `AuthContext.Provider` includes `presence`. Consumers call `const { presence } = useAuth()` to read the Map.

- [ ] **Step 4: Create `useContactList`**

Create `src/hooks/useContactList.js`:

```js
import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { useProfiles } from './useTasks'
import { useConversations } from './useConversations'
import { bucketContacts, filterContactsBySearch } from '../lib/dmContacts'

export function useContactList(searchQuery = '') {
  const { profile, presence } = useAuth()
  const { profiles, loading: profilesLoading } = useProfiles()
  const { conversations, loading: convsLoading, createOrOpen, markRead } = useConversations()

  const sections = useMemo(() => {
    if (!profile?.id) return { recent: [], teammates: [], company: [] }
    const myTeamIds = profile.team_ids || (profile.team_id ? [profile.team_id] : [])
    return bucketContacts({ profiles, conversations, myId: profile.id, myTeamIds })
  }, [profile?.id, profile?.team_ids, profile?.team_id, profiles, conversations])

  const filtered = useMemo(
    () => filterContactsBySearch(sections, searchQuery),
    [sections, searchQuery]
  )

  return {
    sections: filtered,
    conversations,
    presence: presence || new Map(),
    loading: profilesLoading || convsLoading,
    createOrOpen,
    markRead,
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useContactList.js src/hooks/useAuth.js
git commit -m "feat(chat): mount global presence + DM realtime in AuthProvider; add useContactList"
```

---

## Task 12: Chat widget shell — launcher, panel, localStorage wiring

**Files:**
- Create: `src/components/chat/ChatWidget.jsx`
- Create: `src/components/chat/ChatLauncher.jsx`
- Create: `src/components/chat/ChatPanel.jsx`
- Create: `src/components/chat/PresenceDot.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Create `PresenceDot.jsx`**

Create `src/components/chat/PresenceDot.jsx`:

```jsx
export default function PresenceDot({ online, className = '' }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-dark-card ${
        online ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'
      } ${className}`}
      aria-label={online ? 'Online' : 'Offline'}
    />
  )
}
```

- [ ] **Step 2: Create `ChatLauncher.jsx`**

Create `src/components/chat/ChatLauncher.jsx`:

```jsx
import { MessageCircle } from 'lucide-react'

export default function ChatLauncher({ totalUnread, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-14 h-14 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-elevated flex items-center justify-center transition-colors"
      aria-label="Open chat"
    >
      <MessageCircle className="w-6 h-6" />
      {totalUnread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-semibold flex items-center justify-center">
          {totalUnread > 99 ? '99+' : totalUnread}
        </span>
      )}
    </button>
  )
}
```

- [ ] **Step 3: Create `ChatPanel.jsx` (shell only, ContactList wired in Task 13)**

Create `src/components/chat/ChatPanel.jsx`:

```jsx
import { X } from 'lucide-react'

export default function ChatPanel({ onClose, children }) {
  return (
    <div className="w-[360px] h-[520px] bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 dark:border-dark-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Chat</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `ChatWidget.jsx` (orchestrator)**

Create `src/components/chat/ChatWidget.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useContactList } from '../../hooks/useContactList'
import { totalUnread as sumUnread } from '../../lib/dmUnread'
import { readWidgetState, writeWidgetState } from '../../lib/dmWidgetStorage'
import ChatLauncher from './ChatLauncher'
import ChatPanel from './ChatPanel'

export default function ChatWidget() {
  const { profile } = useAuth()
  const [state, setState] = useState(() => readWidgetState(profile?.id))

  // Re-hydrate whenever profile id changes (login/logout)
  useEffect(() => { setState(readWidgetState(profile?.id)) }, [profile?.id])

  // Persist every change
  useEffect(() => { writeWidgetState(profile?.id, state) }, [profile?.id, state])

  const { conversations } = useContactList('')
  const total = sumUnread(conversations)

  if (!profile?.id) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-end gap-3">
      {state.expanded && (
        <ChatPanel onClose={() => setState(s => ({ ...s, expanded: false }))}>
          <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
            Contact list will go here (Task 13).
          </div>
        </ChatPanel>
      )}
      <ChatLauncher
        totalUnread={total}
        onClick={() => setState(s => ({ ...s, expanded: !s.expanded }))}
      />
    </div>
  )
}
```

- [ ] **Step 5: Mount `ChatWidget` in `App.jsx`**

In `src/App.jsx`, change the return of `AppRoutes` (when the user is authenticated) to render the widget alongside the main content. Replace:

```jsx
  return (
    <Layout>
      <ErrorBoundary>
        <AnimatePresence mode="wait">
          <Routes>
```

with:

```jsx
  return (
    <>
      <Layout>
        <ErrorBoundary>
          <AnimatePresence mode="wait">
            <Routes>
```

and the matching closing tags change from:

```jsx
          </Routes>
        </AnimatePresence>
      </ErrorBoundary>
    </Layout>
  )
```

to:

```jsx
            </Routes>
          </AnimatePresence>
        </ErrorBoundary>
      </Layout>
      <ChatWidget />
    </>
  )
```

Add this import at the top of `src/App.jsx`:

```jsx
import ChatWidget from './components/chat/ChatWidget'
```

- [ ] **Step 6: Smoke-test in the browser**

Run: `npm run dev`
- Log in. Confirm the round launcher is visible in the bottom-right.
- Click it. Confirm a placeholder panel opens. Click X. Confirm it closes.
- Reload the page with the panel expanded — confirm it stays expanded (localStorage persisted).
- Kill the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/ src/App.jsx
git commit -m "feat(chat): add widget shell with launcher, panel, and localStorage persistence"
```

---

## Task 13: Contact list UI — search, three sections, click-to-open

**Files:**
- Create: `src/components/chat/ContactSearch.jsx`
- Create: `src/components/chat/ContactList.jsx`
- Create: `src/components/chat/ContactRow.jsx`
- Modify: `src/components/chat/ChatWidget.jsx` (replace placeholder with ContactList, track open conversations)

- [ ] **Step 1: Create `ContactSearch.jsx`**

Create `src/components/chat/ContactSearch.jsx`:

```jsx
import { Search } from 'lucide-react'

export default function ContactSearch({ value, onChange }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search people"
        className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  )
}
```

- [ ] **Step 2: Create `ContactRow.jsx`**

Create `src/components/chat/ContactRow.jsx`:

```jsx
import PresenceDot from './PresenceDot'

export default function ContactRow({ row, online, onClick }) {
  const { profile, conversation } = row
  const initial = (profile.full_name || '?').charAt(0).toUpperCase()
  const unread = conversation?.unread || 0
  const preview = conversation?.last_message_preview
  return (
    <button
      type="button"
      onClick={() => onClick(profile.id)}
      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
    >
      <div className="relative w-9 h-9 flex-shrink-0">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 font-semibold flex items-center justify-center">
            {initial}
          </div>
        )}
        <span className="absolute bottom-0 right-0">
          <PresenceDot online={online} />
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {profile.full_name || profile.email}
          </span>
          {unread > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        {preview && (
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{preview}</div>
        )}
      </div>
    </button>
  )
}
```

- [ ] **Step 3: Create `ContactList.jsx`**

Create `src/components/chat/ContactList.jsx`:

```jsx
import ContactRow from './ContactRow'

function Section({ title, rows, presence, onOpen }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="mb-2">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {rows.map(row => (
        <ContactRow
          key={row.profile.id}
          row={row}
          online={presence.get(row.profile.id)?.online || false}
          onClick={onOpen}
        />
      ))}
    </div>
  )
}

export default function ContactList({ sections, presence, onOpen }) {
  const empty =
    sections.recent.length === 0 &&
    sections.teammates.length === 0 &&
    sections.company.length === 0

  if (empty) {
    return (
      <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        No people to show.
      </div>
    )
  }

  return (
    <div className="py-1">
      <Section title="Recent"    rows={sections.recent}    presence={presence} onOpen={onOpen} />
      <Section title="Teammates" rows={sections.teammates} presence={presence} onOpen={onOpen} />
      <Section title="Company"   rows={sections.company}   presence={presence} onOpen={onOpen} />
    </div>
  )
}
```

- [ ] **Step 4: Wire ContactList into `ChatWidget.jsx`**

Replace the `<ChatPanel>...</ChatPanel>` block in `src/components/chat/ChatWidget.jsx` with the full flow:

```jsx
import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useContactList } from '../../hooks/useContactList'
import { totalUnread as sumUnread } from '../../lib/dmUnread'
import { readWidgetState, writeWidgetState } from '../../lib/dmWidgetStorage'
import ChatLauncher from './ChatLauncher'
import ChatPanel from './ChatPanel'
import ContactSearch from './ContactSearch'
import ContactList from './ContactList'

export default function ChatWidget() {
  const { profile } = useAuth()
  const [state, setState] = useState(() => readWidgetState(profile?.id))
  const [query, setQuery] = useState('')

  useEffect(() => { setState(readWidgetState(profile?.id)) }, [profile?.id])
  useEffect(() => { writeWidgetState(profile?.id, state) }, [profile?.id, state])

  const { sections, conversations, presence, createOrOpen } = useContactList(query)
  const total = sumUnread(conversations)

  const handleOpen = useCallback(async (otherUserId) => {
    const convId = await createOrOpen(otherUserId)
    if (!convId) return
    setState(s => {
      if (s.openConversationIds.includes(convId)) return s
      return { ...s, openConversationIds: [...s.openConversationIds, convId] }
    })
  }, [createOrOpen])

  if (!profile?.id) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-end gap-3">
      {state.expanded && (
        <ChatPanel onClose={() => setState(s => ({ ...s, expanded: false }))}>
          <div className="p-3">
            <ContactSearch value={query} onChange={setQuery} />
          </div>
          <ContactList
            sections={sections}
            presence={presence}
            onOpen={handleOpen}
          />
        </ChatPanel>
      )}
      <ChatLauncher
        totalUnread={total}
        onClick={() => setState(s => ({ ...s, expanded: !s.expanded }))}
      />
    </div>
  )
}
```

- [ ] **Step 5: Smoke-test**

Run: `npm run dev`. With two browser sessions (one for you, one for a teammate test user, or two incognito windows logged in as different users):

- Open the panel. Confirm three sections appear (at least Teammates and Company).
- Type in the search — confirm filtering within sections.
- Click a teammate's row. Confirm `handleOpen` runs without error (check devtools console — no errors). The conversation ID is added to `openConversationIds` in localStorage; verify via devtools Application tab.
- No visible conversation pane yet (Task 14).

Kill the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/
git commit -m "feat(chat): render contact list with search, presence, and unread badges"
```

---

## Task 14: Conversation pane — header, message list, composer, delete

**Files:**
- Create: `src/components/chat/ConversationHeader.jsx`
- Create: `src/components/chat/MessageList.jsx`
- Create: `src/components/chat/DmChatMessage.jsx`
- Create: `src/components/chat/ChatComposer.jsx`
- Create: `src/components/chat/ConversationPane.jsx`
- Modify: `src/components/chat/ChatWidget.jsx` (render ConversationPane for each open conversation; cap to 3 — multi-stack is Task 15 but we render 1 now)

This task renders exactly one conversation pane (the last one opened), ignoring stacking. Task 15 extends to the full stack.

- [ ] **Step 1: Create `ConversationHeader.jsx`**

Create `src/components/chat/ConversationHeader.jsx`:

```jsx
import { Minus, X, ClipboardList } from 'lucide-react'
import PresenceDot from './PresenceDot'

export default function ConversationHeader({
  otherProfile, online, onMinimize, onClose, onAssignTask, canAssignTask,
}) {
  const name = otherProfile?.full_name || otherProfile?.email || 'Unknown'
  return (
    <header className="px-3 py-2 border-b border-slate-200 dark:border-dark-border flex items-center gap-2">
      <PresenceDot online={online} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {online ? 'Online' : 'Offline'}
        </div>
      </div>
      {canAssignTask && (
        <button
          type="button"
          onClick={onAssignTask}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-900/50"
          title="Assign task"
        >
          <ClipboardList className="w-3.5 h-3.5" />
          Assign task
        </button>
      )}
      <button type="button" onClick={onMinimize} className="text-slate-400 hover:text-slate-600" aria-label="Minimize">
        <Minus className="w-4 h-4" />
      </button>
      <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
        <X className="w-4 h-4" />
      </button>
    </header>
  )
}
```

- [ ] **Step 2: Create `DmChatMessage.jsx`**

Create `src/components/chat/DmChatMessage.jsx`:

```jsx
import { Trash2 } from 'lucide-react'
import RichContentRenderer from '../ui/RichContentRenderer'

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

export default function DmChatMessage({ message, isMine, onDelete }) {
  const isSystem = message.kind === 'system'
  const isDeleted = !!message.deleted_at

  if (isSystem) {
    return (
      <div className="my-2 text-center">
        <span className="inline-block px-3 py-1 text-xs rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`group flex my-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isMine && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
            {message.author?.full_name}
          </div>
        )}
        <div className={`px-3 py-2 rounded-2xl text-sm ${
          isMine
            ? 'bg-brand-500 text-white'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
        }`}>
          {isDeleted ? (
            <span className="italic opacity-70">message deleted</span>
          ) : (
            <RichContentRenderer
              content={message.content || ''}
              mentions={message.mentions || []}
              inlineImages={message.inline_images || []}
            />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-slate-400">{formatTime(message.created_at)}</span>
          {isMine && !isDeleted && (
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
              aria-label="Delete message"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `MessageList.jsx`**

Create `src/components/chat/MessageList.jsx`:

```jsx
import { useEffect, useRef } from 'react'
import DmChatMessage from './DmChatMessage'

export default function MessageList({ messages, myId, loading, hasMore, onLoadMore, onDelete }) {
  const bottomRef = useRef(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages.length])

  if (loading) {
    return <div className="p-4 text-center text-sm text-slate-500">Loading…</div>
  }
  if (messages.length === 0) {
    return <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">Say hi 👋</div>
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {hasMore && (
        <div className="text-center mb-2">
          <button
            type="button"
            onClick={onLoadMore}
            className="text-xs text-brand-500 hover:underline"
          >
            Load earlier
          </button>
        </div>
      )}
      {messages.map(m => (
        <DmChatMessage
          key={m.id}
          message={m}
          isMine={m.author_id === myId}
          onDelete={onDelete}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 4: Create `ChatComposer.jsx`**

Create `src/components/chat/ChatComposer.jsx`:

```jsx
import { useState } from 'react'
import { Send } from 'lucide-react'

const MAX_LEN = 4000

export default function ChatComposer({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed || busy || disabled) return
    setBusy(true)
    const ok = await onSend(trimmed)
    setBusy(false)
    if (ok) setValue('')
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-slate-200 dark:border-dark-border p-2 flex items-end gap-2">
      <textarea
        value={value}
        onChange={e => setValue(e.target.value.slice(0, MAX_LEN))}
        onKeyDown={handleKey}
        placeholder="Type a message…"
        rows={1}
        className="flex-1 resize-none rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 max-h-32"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || disabled || !value.trim()}
        className="w-9 h-9 rounded-full bg-brand-500 hover:bg-brand-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center"
        aria-label="Send"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Create `ConversationPane.jsx`**

Create `src/components/chat/ConversationPane.jsx`:

```jsx
import { useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useConversation } from '../../hooks/useConversation'
import ConversationHeader from './ConversationHeader'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'

export default function ConversationPane({
  conversation,
  online,
  onClose,
  onMinimize,
  onMarkRead,
  onAssignTask,
}) {
  const { profile } = useAuth()
  const { messages, loading, hasMore, sendMessage, deleteMessage, loadMore } =
    useConversation(conversation.id)

  useEffect(() => {
    onMarkRead?.(conversation.id)
  }, [conversation.id, messages.length, onMarkRead])

  return (
    <div className="w-[320px] h-[440px] bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated flex flex-col overflow-hidden">
      <ConversationHeader
        otherProfile={conversation.other_profile}
        online={online}
        canAssignTask={conversation.kind === 'dm'}
        onAssignTask={() => onAssignTask?.(conversation)}
        onMinimize={() => onMinimize?.(conversation.id)}
        onClose={() => onClose?.(conversation.id)}
      />
      <MessageList
        messages={messages}
        myId={profile?.id}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        onDelete={deleteMessage}
      />
      <ChatComposer onSend={sendMessage} />
    </div>
  )
}
```

- [ ] **Step 6: Update `ChatWidget.jsx` to render the last open conversation as a pane**

Replace the render block in `src/components/chat/ChatWidget.jsx`:

```jsx
import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useContactList } from '../../hooks/useContactList'
import { totalUnread as sumUnread } from '../../lib/dmUnread'
import { readWidgetState, writeWidgetState } from '../../lib/dmWidgetStorage'
import ChatLauncher from './ChatLauncher'
import ChatPanel from './ChatPanel'
import ContactSearch from './ContactSearch'
import ContactList from './ContactList'
import ConversationPane from './ConversationPane'

export default function ChatWidget() {
  const { profile } = useAuth()
  const [state, setState] = useState(() => readWidgetState(profile?.id))
  const [query, setQuery] = useState('')

  useEffect(() => { setState(readWidgetState(profile?.id)) }, [profile?.id])
  useEffect(() => { writeWidgetState(profile?.id, state) }, [profile?.id, state])

  const { sections, conversations, presence, createOrOpen, markRead } = useContactList(query)
  const total = sumUnread(conversations)

  const openOne = useCallback(async (otherUserId) => {
    const convId = await createOrOpen(otherUserId)
    if (!convId) return
    setState(s => {
      const openIds = s.openConversationIds.includes(convId)
        ? s.openConversationIds
        : [...s.openConversationIds, convId]
      return { ...s, expanded: true, openConversationIds: openIds }
    })
  }, [createOrOpen])

  const closeOne = useCallback((convId) => {
    setState(s => ({
      ...s,
      openConversationIds: s.openConversationIds.filter(id => id !== convId),
      minimizedIds:        s.minimizedIds.filter(id => id !== convId),
    }))
  }, [])

  if (!profile?.id) return null

  // For this task we show at most the last open conversation. Task 15 handles multi-stack.
  const visibleId = state.openConversationIds[state.openConversationIds.length - 1]
  const visibleConversation = visibleId ? conversations.find(c => c.id === visibleId) : null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-end gap-3">
      {visibleConversation && (
        <ConversationPane
          conversation={visibleConversation}
          online={presence.get(visibleConversation.other_user_id)?.online || false}
          onClose={closeOne}
          onMinimize={() => { /* Task 15 */ }}
          onMarkRead={markRead}
        />
      )}
      {state.expanded && (
        <ChatPanel onClose={() => setState(s => ({ ...s, expanded: false }))}>
          <div className="p-3">
            <ContactSearch value={query} onChange={setQuery} />
          </div>
          <ContactList
            sections={sections}
            presence={presence}
            onOpen={openOne}
          />
        </ChatPanel>
      )}
      <ChatLauncher
        totalUnread={total}
        onClick={() => setState(s => ({ ...s, expanded: !s.expanded }))}
      />
    </div>
  )
}
```

- [ ] **Step 7: Smoke-test end-to-end with two sessions**

Run: `npm run dev`. In two browser profiles (or incognito windows), log in as two different users who share a team:

1. User A opens chat, clicks User B. Confirm: conversation pane appears to the left of the panel.
2. User A types "hi" and presses Enter. Confirm: message appears in User A's pane with a right-aligned brand-color bubble.
3. User B (other window) opens chat. Confirm: a "Recent" section now contains User A with an unread badge "1". Click User A → pane opens → message "hi" shows as a left-aligned gray bubble.
4. User B replies. User A's pane updates via realtime.
5. User A deletes a message. Both users now see "message deleted" italic placeholder.
6. Refresh User A. Confirm: widget re-opens to same state; message history loads.
7. Click "Load earlier" after seeding >50 messages (optional).

Kill the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/
git commit -m "feat(chat): render conversation pane with send, delete, realtime"
```

---

## Task 15: Multi-pane stacking with overflow

**Files:**
- Create: `src/components/chat/ConversationStack.jsx`
- Modify: `src/components/chat/ChatWidget.jsx`

Up to 3 conversation panes visible at once. Additional open conversations collapse into avatar tabs left of the stack. Minimized panes live in the same tabs area. Click an avatar tab to restore.

- [ ] **Step 1: Create `ConversationStack.jsx`**

Create `src/components/chat/ConversationStack.jsx`:

```jsx
import ConversationPane from './ConversationPane'
import PresenceDot from './PresenceDot'

const VISIBLE_CAP = 3

export default function ConversationStack({
  openConversationIds,
  minimizedIds,
  conversations,
  presence,
  onClose,
  onMinimize,
  onRestore,
  onMarkRead,
  onAssignTask,
}) {
  // Non-minimized, in open order, most recent last; keep last VISIBLE_CAP visible
  const activeIds = openConversationIds.filter(id => !minimizedIds.includes(id))
  const visibleIds = activeIds.slice(-VISIBLE_CAP)
  const overflowIds = [
    ...activeIds.slice(0, Math.max(0, activeIds.length - VISIBLE_CAP)),
    ...minimizedIds,
  ]

  const byId = new Map(conversations.map(c => [c.id, c]))

  function Tab({ id }) {
    const conv = byId.get(id)
    if (!conv) return null
    const other = conv.other_profile
    const online = presence.get(conv.other_user_id)?.online || false
    const initial = (other?.full_name || '?').charAt(0).toUpperCase()
    return (
      <button
        type="button"
        onClick={() => onRestore(id)}
        className="relative w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold flex items-center justify-center shadow-soft"
        aria-label={`Restore conversation with ${other?.full_name || 'contact'}`}
      >
        {other?.avatar_url
          ? <img src={other.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
          : <span>{initial}</span>}
        <span className="absolute bottom-0 right-0"><PresenceDot online={online} /></span>
        {conv.unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {conv.unread > 9 ? '9+' : conv.unread}
          </span>
        )}
      </button>
    )
  }

  return (
    <>
      {overflowIds.length > 0 && (
        <div className="flex flex-col gap-2 mr-1">
          {overflowIds.map(id => <Tab key={id} id={id} />)}
        </div>
      )}
      {visibleIds.map(id => {
        const conv = byId.get(id)
        if (!conv) return null
        return (
          <ConversationPane
            key={id}
            conversation={conv}
            online={presence.get(conv.other_user_id)?.online || false}
            onClose={onClose}
            onMinimize={onMinimize}
            onMarkRead={onMarkRead}
            onAssignTask={onAssignTask}
          />
        )
      })}
    </>
  )
}
```

- [ ] **Step 2: Update `ChatWidget.jsx` to use the stack**

Replace the section in `src/components/chat/ChatWidget.jsx` that currently renders `visibleConversation` with:

```jsx
import ConversationStack from './ConversationStack'
// …

const minimizeOne = useCallback((convId) => {
  setState(s => ({
    ...s,
    minimizedIds: s.minimizedIds.includes(convId) ? s.minimizedIds : [...s.minimizedIds, convId],
  }))
}, [])

const restoreOne = useCallback((convId) => {
  setState(s => ({
    ...s,
    minimizedIds: s.minimizedIds.filter(id => id !== convId),
    openConversationIds: s.openConversationIds.includes(convId)
      ? s.openConversationIds
      : [...s.openConversationIds, convId],
  }))
}, [])

// render:
<ConversationStack
  openConversationIds={state.openConversationIds}
  minimizedIds={state.minimizedIds}
  conversations={conversations}
  presence={presence}
  onClose={closeOne}
  onMinimize={minimizeOne}
  onRestore={restoreOne}
  onMarkRead={markRead}
  onAssignTask={() => { /* Task 17 */ }}
/>
```

(Remove the old `visibleConversation` block.)

- [ ] **Step 3: Smoke-test**

Run `npm run dev`. Open 4 different conversations. Confirm: 3 panes visible; 4th collapses to an avatar tab left of them. Minimize one; confirm it moves into tabs. Click an avatar tab to restore.

Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ConversationStack.jsx src/components/chat/ChatWidget.jsx
git commit -m "feat(chat): stack up to 3 conversation panes with overflow avatar tabs"
```

---

## Task 16: `AssignTaskPage` query-string prefill

**Files:**
- Modify: `src/pages/AssignTaskPage.jsx`

Read the prefill params from the URL on mount and seed the form. Existing behavior when no params present is unchanged.

- [ ] **Step 1: Update `AssignTaskPage.jsx`**

Add imports at the top of `src/pages/AssignTaskPage.jsx`:

```jsx
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parsePrefillParams } from '../lib/dmPrefillUrl'
```

Inside the component body, after `useState` for `form` / `selectedTeamId` / etc., add:

```jsx
const [searchParams, setSearchParams] = useSearchParams()

useEffect(() => {
  if (profilesLoading) return
  const pre = parsePrefillParams(searchParams)
  if (!pre.assigneeId && !pre.title) return

  setForm(f => ({
    ...f,
    assigneeIds: pre.assigneeId ? [pre.assigneeId] : f.assigneeIds,
    title:       pre.title    ?? f.title,
    urgency:     pre.urgency  ?? f.urgency,
    dueDate:     pre.dueDate  ?? f.dueDate,
    notes:       pre.notes    ?? f.notes,
  }))
  if (pre.teamId) setSelectedTeamId(pre.teamId)

  // Clear params so refresh doesn't re-apply
  setSearchParams({}, { replace: true })
}, [profilesLoading, searchParams, setSearchParams])
```

- [ ] **Step 2: Smoke-test**

Run `npm run dev`. Manually navigate to `/assign?assignee={some-valid-id}&title=Hello&urgency=High&due=2026-04-25&notes=test`. Confirm the form is pre-filled. Submit a task to confirm the flow still works. Kill the server.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AssignTaskPage.jsx
git commit -m "feat(chat): prefill AssignTaskPage from query-string params"
```

---

## Task 17: `AssignFromChatModal` — inline quick-create form

**Files:**
- Create: `src/components/chat/AssignFromChatModal.jsx`
- Modify: `src/components/chat/ChatWidget.jsx` (wire `onAssignTask` state; pass into stack)

- [ ] **Step 1: Create the modal**

Create `src/components/chat/AssignFromChatModal.jsx`:

```jsx
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ExternalLink } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTaskActions, useProfiles } from '../../hooks/useTasks'
import { showToast } from '../ui'
import { buildPrefillUrl } from '../../lib/dmPrefillUrl'

export default function AssignFromChatModal({ conversation, onClose, onPosted }) {
  const { profile } = useAuth()
  const { profiles } = useProfiles()
  const { assignTask } = useTaskActions()
  const navigate = useNavigate()

  const otherProfile = conversation.other_profile
  const otherId = conversation.other_user_id

  const teams = useMemo(() => {
    const assignee = profiles.find(p => p.id === otherId)
    if (!assignee) return []
    return assignee.all_teams || (assignee.teams
      ? [{ id: assignee.team_id, name: assignee.teams.name, is_primary: true }]
      : [])
  }, [profiles, otherId])

  const defaultTeamId = teams.find(t => t.is_primary)?.id || teams[0]?.id || ''

  const [form, setForm] = useState({
    title: '', urgency: 'Med', dueDate: '', notes: '',
    teamId: defaultTeamId,
  })
  const [busy, setBusy] = useState(false)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.title.trim() || busy) return
    setBusy(true)
    const result = await assignTask({
      assigneeIds: [otherId],
      title: form.title.trim(),
      urgency: form.urgency,
      dueDate: form.dueDate || null,
      whoTo: '',
      notes: form.notes.trim(),
      icon: '',
      allProfiles: profiles,
      teamId: form.teamId,
    })
    setBusy(false)

    if (!result?.ok) {
      showToast('Failed to assign task', 'error')
      return
    }
    const sysMsg = `${profile.full_name} assigned a task: **${form.title.trim()}**` +
      (form.dueDate ? ` (due ${form.dueDate})` : '')
    await onPosted?.(sysMsg, result.taskId)
    showToast('Task assigned', 'success')
    onClose()
  }

  function openFullForm() {
    const url = buildPrefillUrl({
      assigneeId: otherId,
      teamId:     form.teamId,
      title:      form.title,
      urgency:    form.urgency,
      dueDate:    form.dueDate,
      notes:      form.notes,
    })
    navigate(url)
    onClose()
  }

  return (
    <div className="absolute inset-0 z-50 bg-black/30 flex items-center justify-center p-3 rounded-2xl">
      <div className="bg-white dark:bg-dark-card rounded-xl w-full max-w-sm p-4 shadow-elevated">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Assign a task to {otherProfile?.full_name}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            autoFocus
            placeholder="Task title"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.urgency}
              onChange={e => set('urgency', e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            >
              <option value="Low">Low</option>
              <option value="Med">Medium</option>
              <option value="High">High</option>
            </select>
            <input
              type="date"
              value={form.dueDate}
              onChange={e => set('dueDate', e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            />
          </div>
          {teams.length > 1 && (
            <select
              value={form.teamId}
              onChange={e => set('teamId', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            >
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <textarea
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={openFullForm}
            className="flex items-center gap-1 text-xs text-brand-500 hover:underline"
          >
            <ExternalLink className="w-3 h-3" /> Open full form
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!form.title.trim() || busy}
              onClick={submit}
              className="px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the modal into the widget**

In `src/components/chat/ChatWidget.jsx`:

1. Add state for the modal's target conversation:

```jsx
const [assignForConversation, setAssignForConversation] = useState(null)
```

2. Pass `onAssignTask` to `ConversationStack`:

```jsx
onAssignTask={conv => setAssignForConversation(conv)}
```

3. At the bottom of the returned JSX (inside the fixed container), add:

```jsx
{assignForConversation && (
  <div className="absolute inset-0 pointer-events-none">
    {/* positioned inside whichever pane is visible — since stack uses flex items-end,
        the modal overlays the entire widget area; participants see it over the pane. */}
    <AssignFromChatModal
      conversation={assignForConversation}
      onClose={() => setAssignForConversation(null)}
      onPosted={async (sysText) => {
        // Post a system message in the conversation so both participants see it
        // We need the sendSystemMessage on the open conversation; use a one-shot insert.
        const { supabase } = await import('../../lib/supabase')
        await supabase.from('dm_messages').insert({
          conversation_id: assignForConversation.id,
          author_id: profile.id,
          kind: 'system',
          content: sysText,
        })
      }}
    />
  </div>
)}
```

And add the import:

```jsx
import AssignFromChatModal from './AssignFromChatModal'
```

- [ ] **Step 3: Smoke-test**

Run `npm run dev`. Open a conversation with a teammate. Click "Assign task" in the header. Fill in a title and urgency. Submit. Confirm:
- A task appears in `/my-tasks` for the recipient.
- A "system" style message appears in the conversation: "You assigned a task: ..."
- The recipient's window shows the system message via realtime.

Also test "Open full form": fill in title, click "Open full form", confirm `/assign` opens with fields pre-populated.

Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/AssignFromChatModal.jsx src/components/chat/ChatWidget.jsx
git commit -m "feat(chat): assign task inline from conversation header with full-form escape hatch"
```

---

## Task 18: NotificationBell integration — "New DM" category

**Files:**
- Modify: `src/components/notifications/NotificationBell.jsx`
- Read-only reference: `src/hooks/useMentionNotifications.js` (pattern)

Add a new category to the bell that shows a single aggregated entry per sender: "You have N new messages from {name}".

- [ ] **Step 1: Read the current bell implementation**

Read `src/components/notifications/NotificationBell.jsx` end to end so you understand the existing categories (pending acceptance, overdue, recent assignments, hub invites, hub mentions) and how items are rendered.

- [ ] **Step 2: Add a DM-unread category**

Inside `NotificationBell.jsx`, after the existing `useMentionNotifications()` hook call, add:

```jsx
import { useConversations } from '../../hooks/useConversations'
// …
const { conversations } = useConversations()
const dmNotifs = conversations
  .filter(c => c.unread > 0 && c.other_profile)
  .map(c => ({
    id: `dm-${c.id}`,
    kind: 'dm',
    title: `${c.unread} new message${c.unread > 1 ? 's' : ''} from ${c.other_profile.full_name}`,
    onClick: () => {
      // Dispatch a window event the widget listens for, to pop this conversation open.
      window.dispatchEvent(new CustomEvent('pe-chat-open', { detail: { conversationId: c.id } }))
    },
  }))
```

Merge `dmNotifs` into whatever data structure the bell renders (follow the existing pattern for `hub-mention` entries). Add the total to the badge count.

- [ ] **Step 3: Listen for the open event in `ChatWidget.jsx`**

Add to `ChatWidget.jsx`:

```jsx
useEffect(() => {
  function handler(e) {
    const convId = e.detail?.conversationId
    if (!convId) return
    setState(s => ({
      ...s,
      expanded: true,
      openConversationIds: s.openConversationIds.includes(convId)
        ? s.openConversationIds
        : [...s.openConversationIds, convId],
      minimizedIds: s.minimizedIds.filter(id => id !== convId),
    }))
  }
  window.addEventListener('pe-chat-open', handler)
  return () => window.removeEventListener('pe-chat-open', handler)
}, [])
```

- [ ] **Step 4: Smoke-test**

Run `npm run dev`. As user B, send messages to user A while A's chat is closed. As A, observe: the NotificationBell badge increments and the dropdown lists the DM entry. Click it → the chat widget pops open with that conversation.

Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/NotificationBell.jsx src/components/chat/ChatWidget.jsx
git commit -m "feat(chat): surface unread DMs in NotificationBell with click-to-open"
```

---

## Task 19: Offline-delay email edge function

**Files:**
- Create: `supabase/migrations/027_dm_email_queue.sql`
- Create: `supabase/functions/dm-offline-notify/index.ts`
- Create: `supabase/functions/dm-offline-notify/deno.json`

The flow: a DB trigger enqueues one row per recipient on every `dm_messages` INSERT. A cron-scheduled function (every 60 s) flushes rows older than 3 minutes, skipping any where the recipient has read the conversation since or has a presence heartbeat in the last 60 s. A 15-minute per-(recipient, conversation) debounce is enforced via `dm_email_log`.

Presence heartbeat signal: we don't have a server-side persistent record of presence (the channel is client-driven). Proxy: treat "recipient has read the conversation since the message was sent" as the sole liveness signal. If they've read it, skip; otherwise send. (Note: if this is too aggressive in practice, a later enhancement can add a server-side heartbeat row.)

- [ ] **Step 1: Create migration 027**

Create `supabase/migrations/027_dm_email_queue.sql`:

```sql
create table if not exists public.pending_dm_emails (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.dm_messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  enqueued_at     timestamptz not null default now(),
  sent_at         timestamptz,
  skipped_reason  text
);
create index if not exists pending_dm_emails_pending_idx
  on public.pending_dm_emails(enqueued_at)
  where sent_at is null and skipped_reason is null;

create table if not exists public.dm_email_log (
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sent_at         timestamptz not null default now(),
  primary key (recipient_id, conversation_id, sent_at)
);
create index if not exists dm_email_log_recipient_conv_idx
  on public.dm_email_log(recipient_id, conversation_id, sent_at desc);

-- Trigger: on dm_messages INSERT, enqueue one row per other participant
create or replace function public.enqueue_dm_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'user' then return new; end if;
  insert into public.pending_dm_emails (message_id, conversation_id, recipient_id)
    select new.id, new.conversation_id, cp.user_id
    from public.conversation_participants cp
    where cp.conversation_id = new.conversation_id
      and cp.user_id <> new.author_id
      and cp.muted = false;
  return new;
end;
$$;

drop trigger if exists dm_messages_enqueue_email on public.dm_messages;
create trigger dm_messages_enqueue_email
  after insert on public.dm_messages
  for each row execute function public.enqueue_dm_email();
```

Apply with:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/027_dm_email_queue.sql
```

- [ ] **Step 2: Create the Deno function**

Create `supabase/functions/dm-offline-notify/deno.json`:

```json
{
  "tasks": {
    "start": "deno run --allow-all index.ts"
  }
}
```

Create `supabase/functions/dm-offline-notify/index.ts`:

```ts
// Offline-delay email notifier for unread direct messages.
// Scheduled to run every 60s. Flushes pending_dm_emails rows older than 3 minutes
// to Resend, skipping rows where the recipient has read the conversation since.
// Enforces a 15-minute debounce per (recipient, conversation) via dm_email_log.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL        = Deno.env.get('DM_FROM_EMAIL') ?? 'chat@example.com'
const APP_URL           = Deno.env.get('APP_URL') ?? 'https://example.com'

const DELAY_MIN         = 3
const DEBOUNCE_MIN      = 15

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) {
    console.error('Resend failed', res.status, await res.text())
    return false
  }
  return true
}

async function flush() {
  const threshold = new Date(Date.now() - DELAY_MIN * 60_000).toISOString()

  const { data: pending, error } = await supabase
    .from('pending_dm_emails')
    .select(`
      id, message_id, conversation_id, recipient_id, enqueued_at,
      message:dm_messages(id, content, author_id, created_at,
                         author:profiles!dm_messages_author_id_fkey(id, full_name)),
      recipient:profiles!pending_dm_emails_recipient_id_fkey(id, email, full_name)
    `)
    .is('sent_at', null)
    .is('skipped_reason', null)
    .lte('enqueued_at', threshold)
    .limit(200)

  if (error) { console.error(error); return { flushed: 0 } }
  if (!pending || pending.length === 0) return { flushed: 0 }

  let sent = 0

  // Group by (recipient, conversation) so one email covers a burst.
  const groups = new Map<string, typeof pending>()
  for (const row of pending) {
    const k = `${row.recipient_id}::${row.conversation_id}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(row)
  }

  for (const [, rows] of groups) {
    const first = rows[0]
    const recipient = first.recipient
    const conversationId = first.conversation_id

    // Skip if recipient has read the conversation since the earliest queued message
    const { data: partRow } = await supabase
      .from('conversation_participants')
      .select('last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', recipient.id)
      .maybeSingle()

    const earliestMessageAt = rows.reduce(
      (acc, r) => Math.min(acc, Date.parse(r.message.created_at)),
      Infinity
    )
    const readAtMs = partRow?.last_read_at ? Date.parse(partRow.last_read_at) : 0

    if (readAtMs >= earliestMessageAt) {
      await supabase.from('pending_dm_emails').update({
        skipped_reason: 'read',
        sent_at: new Date().toISOString(),
      }).in('id', rows.map(r => r.id))
      continue
    }

    // Debounce: was an email sent to this (recipient, conversation) in the last 15 min?
    const debounceThreshold = new Date(Date.now() - DEBOUNCE_MIN * 60_000).toISOString()
    const { data: recent } = await supabase
      .from('dm_email_log')
      .select('sent_at')
      .eq('recipient_id', recipient.id)
      .eq('conversation_id', conversationId)
      .gte('sent_at', debounceThreshold)
      .limit(1)

    if (recent && recent.length > 0) {
      await supabase.from('pending_dm_emails').update({
        skipped_reason: 'debounced',
        sent_at: new Date().toISOString(),
      }).in('id', rows.map(r => r.id))
      continue
    }

    const senderName = first.message.author?.full_name || 'A coworker'
    const subject = `New messages from ${senderName}`
    const lines = rows.map(r =>
      `<div style="margin:6px 0;padding:6px 10px;background:#f3f4f6;border-radius:8px;">
        <div style="font-size:11px;color:#6b7280;">${new Date(r.message.created_at).toLocaleTimeString()}</div>
        <div>${escapeHtml(r.message.content || '')}</div>
      </div>`
    ).join('')
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px;">
        <h2 style="font-size:16px;">You have unread messages from ${escapeHtml(senderName)}</h2>
        ${lines}
        <p><a href="${APP_URL}" style="color:#3b82f6;">Open Project Engine</a></p>
      </div>`

    const ok = await sendEmail(recipient.email, subject, html)

    if (ok) {
      await supabase.from('pending_dm_emails').update({
        sent_at: new Date().toISOString(),
      }).in('id', rows.map(r => r.id))
      await supabase.from('dm_email_log').insert({
        recipient_id: recipient.id,
        conversation_id: conversationId,
      })
      sent += rows.length
    } else {
      await supabase.from('pending_dm_emails').update({
        skipped_reason: 'resend_failed',
        sent_at: new Date().toISOString(),
      }).in('id', rows.map(r => r.id))
    }
  }

  return { flushed: sent }
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

Deno.serve(async () => {
  const result = await flush()
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 3: Deploy and schedule**

```bash
supabase functions deploy dm-offline-notify --no-verify-jwt
# Schedule via Supabase Dashboard > Database > Cron: every 1 minute, invoke HTTPS at
# https://<project>.functions.supabase.co/dm-offline-notify
```

- [ ] **Step 4: Smoke-test**

From user A, send a message to user B while B is logged out. Wait 3+ minutes. Confirm B receives an email digest. Send a second message within 15 min — confirm no duplicate email (debounced). Have B log in and read the conversation before the 3 min elapses for a third message — confirm no email is sent for that one (skipped due to read).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/027_dm_email_queue.sql supabase/functions/dm-offline-notify/
git commit -m "feat(chat): offline-delay email notifications for unread DMs"
```

---

## Task 20: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the chat widget in the architecture section**

In `CLAUDE.md`, under the `**Project Hubs data layer:**` bullet, insert a new sibling bullet below it:

```markdown
- **Direct messaging (chat widget) data layer:** `useConversations` lists 1:1 conversations with unread counts + realtime upserts via a module-level `EventTarget`. `useConversation(id)` streams messages for one thread (pattern mirrors `useHubChat`). `useDmRealtime` is one global `dm_messages` subscription mounted in `AuthProvider`; RLS limits delivery. `useGlobalPresence` is one app-wide Supabase presence channel, also mounted in `AuthProvider` — returns a `Map<userId, {online, onlineAt}>` exposed via `useAuth().presence`. `useContactList` composes `useProfiles` + `useConversations` + presence into `{ recent, teammates, company }` sections.
```

In the Database section, append to the list:

```markdown
- **026_direct_messages.sql** — `conversations`, `conversation_participants`, `dm_messages` tables. `get_or_create_dm` + `mark_conversation_read` RPCs. Soft-delete via `deleted_at`. Realtime enabled. New `dm-attachments` Storage bucket.
- **027_dm_email_queue.sql** — `pending_dm_emails` queue + `dm_email_log` debounce log + `enqueue_dm_email` trigger. Drives `dm-offline-notify` edge function.
```

In the Supabase Edge Functions section, append:

```markdown
- **`supabase/functions/dm-offline-notify/`** — Scheduled cron (every 1 min). Flushes pending DM email rows older than 3 minutes, skipping those where the recipient has read the conversation since; 15-min per-(recipient, conversation) debounce via `dm_email_log`.
```

In the Critical Gotchas section, add:

```markdown
- **Chat widget is globally mounted.** `ChatWidget` is rendered once in `App.jsx` inside `AuthProvider` as a sibling to `Layout`, so it persists across page navigation. State is per-profile in `localStorage` under `pe-chat-state-{profileId}`. The widget depends on `useAuth().presence` being populated — do not move `useGlobalPresence` out of `AuthProvider`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document chat widget architecture, migrations, and edge function in CLAUDE.md"
```

---

## Task 21: Inline image uploads in the composer

**Files:**
- Create: `src/components/chat/ImageAttachments.jsx`
- Modify: `src/components/chat/ChatComposer.jsx`
- Modify: `src/components/chat/ConversationPane.jsx` (pass `conversationId` to composer)

Images upload to the `dm-attachments` Storage bucket at path `{conversation_id}/{message_uuid}/{filename}`, are referenced by the `dm_messages.inline_images` JSONB array (same shape as `hub_chat_messages.inline_images`), and render inline via the existing `RichContentRenderer`.

- [ ] **Step 1: Create the image picker/preview**

Create `src/components/chat/ImageAttachments.jsx`:

```jsx
import { X, Image as ImageIcon } from 'lucide-react'
import { useRef } from 'react'

const MAX_BYTES = 5 * 1024 * 1024

export default function ImageAttachments({ items, onAdd, onRemove }) {
  const inputRef = useRef(null)

  function handleFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_BYTES) continue
      const preview = URL.createObjectURL(file)
      onAdd({ file, preview, name: file.name, type: file.type, size: file.size })
    }
  }

  return (
    <div>
      {items.length > 0 && (
        <div className="flex gap-2 p-2 flex-wrap">
          {items.map((it, i) => (
            <div key={i} className="relative">
              <img src={it.preview} alt="" className="w-14 h-14 rounded-md object-cover" />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center"
                aria-label="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          handleFiles(e.target.files || [])
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2"
        aria-label="Attach image"
        title="Attach image (max 5 MB)"
      >
        <ImageIcon className="w-4 h-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update `ChatComposer.jsx` to handle images**

Replace `src/components/chat/ChatComposer.jsx` with:

```jsx
import { useState } from 'react'
import { Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui'
import ImageAttachments from './ImageAttachments'

const MAX_LEN = 4000

async function uploadImages(conversationId, items) {
  const uploaded = []
  for (const it of items) {
    const messageUuid = crypto.randomUUID()
    const ext = (it.name.split('.').pop() || 'png').toLowerCase()
    const path = `${conversationId}/${messageUuid}/${messageUuid}.${ext}`
    const { error } = await supabase.storage
      .from('dm-attachments')
      .upload(path, it.file, { contentType: it.type, upsert: false })
    if (error) { showToast('Image upload failed', 'error'); continue }
    uploaded.push({ path, name: it.name, size: it.size, type: it.type })
  }
  return uploaded
}

export default function ChatComposer({ conversationId, onSend, disabled }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState([])

  async function submit() {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0) || busy || disabled) return
    setBusy(true)
    const uploaded = images.length > 0 ? await uploadImages(conversationId, images) : []
    const ok = await onSend(trimmed, uploaded)
    setBusy(false)
    if (ok) {
      setValue('')
      images.forEach(i => URL.revokeObjectURL(i.preview))
      setImages([])
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-slate-200 dark:border-dark-border">
      <ImageAttachments
        items={images}
        onAdd={item => setImages(s => [...s, item])}
        onRemove={idx => setImages(s => s.filter((_, i) => i !== idx))}
      />
      <div className="p-2 pt-0 flex items-end gap-2">
        <textarea
          value={value}
          onChange={e => setValue(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={handleKey}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 max-h-32"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || disabled || (!value.trim() && images.length === 0)}
          className="w-9 h-9 rounded-full bg-brand-500 hover:bg-brand-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Pass `conversationId` from `ConversationPane.jsx`**

In `src/components/chat/ConversationPane.jsx`, update the `<ChatComposer />` render to pass `conversationId`:

```jsx
<ChatComposer conversationId={conversation.id} onSend={sendMessage} />
```

- [ ] **Step 4: Verify `DmChatMessage` already renders inline images**

`RichContentRenderer` (already used by `DmChatMessage`) handles `inline_images` identically to how `hub_chat_messages` renders them — it resolves signed Supabase Storage URLs at render time. Confirm by inspecting `src/components/ui/RichContentRenderer.jsx`: if it accepts `inlineImages` as a prop (it does, per the hub mentions pattern), no change is needed. If it hard-codes the `hub-files` bucket name, add a `bucket` prop default `'hub-files'` and pass `'dm-attachments'` from `DmChatMessage` — check and adjust.

- [ ] **Step 5: Smoke-test**

Run `npm run dev`. Attach an image in a DM, send. Confirm: image appears inline for both participants.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ImageAttachments.jsx src/components/chat/ChatComposer.jsx src/components/chat/ConversationPane.jsx src/components/chat/DmChatMessage.jsx src/components/ui/RichContentRenderer.jsx
git commit -m "feat(chat): inline image uploads in DM composer"
```

---

## Self-check after implementation

Before declaring this done, confirm:

- [ ] All Vitest tests pass: `npm run test:run`
- [ ] Dev server boots with no console errors: `npm run dev`
- [ ] Two-user end-to-end smoke: send, receive, delete, assign-task-from-chat (from Task 14 and Task 17)
- [ ] Email: offline user receives digest after ≥3 min; read-in-time skips; debounce prevents duplicates
- [ ] NotificationBell shows DM entries and click-to-open works
- [ ] Refresh preserves widget state
- [ ] Logout clears widget state (verify `localStorage` for `pe-chat-state-{oldProfileId}` is either cleared or orphaned — orphaned is acceptable since `readWidgetState` is keyed by current profile)

---

## Rollback notes

If anything goes sideways:

- **Migration 026** — drop policies, drop tables (`dm_messages`, `conversation_participants`, `conversations`), drop RPCs (`get_or_create_dm`, `mark_conversation_read`, `is_conversation_participant`), remove from `supabase_realtime` publication, drop `dm-attachments` bucket.
- **Migration 027** — drop `pending_dm_emails`, `dm_email_log`, trigger, `enqueue_dm_email` function.
- **Front-end** — revert the `src/components/chat/` directory, revert changes to `App.jsx`, `AssignTaskPage.jsx`, `useAuth.js`, `NotificationBell.jsx`.
