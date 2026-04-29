# Deep-Link Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every email link from project-engine notifications opens the specific resource being notified about — the exact task, the exact comment, the exact chat message, the exact card — instead of a generic page the user has to dig through.

**Architecture:**
1. **URL-only deep-link contract.** All deep links use search params on existing routes (no new routes added). The frontend reads the params on mount and on `location.search` change, then opens / scrolls / highlights the right entity.
2. **Trigger-side payload enrichment.** A small migration extends the notification triggers to include `message_id` for chat events and `comment_id` for task comment events. Card events already carry the right fields (069/070).
3. **Render anchor tags in every section.** Each edge-function HTML branch wraps the relevant text in an `<a>` pointing to the deep link. The user clicks a name/title/snippet and lands exactly there.

The existing scroll-to-message + highlight machinery in `ConversationPane.jsx` (`data-message-id` + `pe-msg-highlight`) is reused. The chat widget already listens for a `pe-chat-open` `CustomEvent({conversationId})` — we extend it to optionally carry `messageId`.

**Tech Stack:** existing — Supabase edge functions (Deno), React 18 + react-router-dom, vitest. No new dependencies.

---

## Deep-link URL contract

Below is the canonical URL for each notification target. Frontend pages and edge functions both follow this table.

| Target | URL | Frontend handler |
|--------|-----|------------------|
| Task | `/my-tasks?task=<uuid>` | `MyTasksPage` (already wired). Silent-refetch fallback handles non-assignees. |
| Task comment | `/my-tasks?task=<uuid>&comment=<uuid>` | `MyTasksPage` opens the panel; new effect scrolls + highlights the comment. |
| Card | `/hub/<hubId>?card=<uuid>` | `HubPage` → `HubCardDetailRouter` (already wired). |
| Card comment | `/hub/<hubId>?card=<uuid>&comment=<uuid>` | `CardDetailPanel` new effect scrolls + highlights. |
| DM / group / hub campfire / task-chat conversation | `/?dm=<convId>` | `ChatWidget` opens the chat widget on that conversation. (Path can be any route — the widget is global.) |
| DM / chat message anchor | `/?dm=<convId>&message=<msgId>` | Same + scrolls to the message via existing `data-message-id` highlight. |
| Hub mention on message board | `/hub/<hubId>?message=<msgId>` | New effect on `HubPage` that scrolls/highlights the hub_messages row. |

Examples of what an email link looks like in practice:
- "Marie commented on Task ABC" → `https://tasks.hyprstaffing.com/my-tasks?task=4f5e…&comment=8ab2…`
- "Dylan in Group X: 'hey'" → `https://tasks.hyprstaffing.com/?dm=09c3…&message=11df…`
- "@mention in Hub Y" → `https://tasks.hyprstaffing.com/hub/2c1a…?message=72ee…`

---

## Open assumptions

If any of these is wrong, flag at execution start, NOT in code:
- Path is always `/` for the chat widget URL — the chat widget is mounted globally so any path works; we use `/` for shortest URL.
- Highlight pattern for new surfaces (task comment, card comment, hub message) reuses `pe-msg-highlight` CSS class already defined in `src/index.css` for chat. Verify before Task 4.
- For unauthenticated visitors, the auth gate captures the original URL (search params survive Google OAuth round-trip via Supabase). The plan does NOT add new auth-gate logic; verify in the smoke test that landing on `/?dm=<id>&message=<id>` while logged out → log in → returns to that URL. (If broken, that's a separate bug; not part of this plan.)
- We do NOT change instant-notify behaviour (email send timing, mute rules). Only the rendered URL inside each email changes.

---

## Task 1: Migration 085 — extend notification payloads with `message_id` + `comment_id`

**Files:**
- Create: `supabase/migrations/085_deep_link_payloads.sql`

**Step 1: Write the migration**

Create `supabase/migrations/085_deep_link_payloads.sql`:

```sql
-- ─────────────────────────────────────────────
-- 085 · Add message_id / comment_id to notification payloads
--
-- Existing triggers wrote enough payload data to render TEXT in digest
-- emails (actor_name, task_title, snippet, etc.) but not enough to
-- render LINKS that open the specific message or comment.
--
-- This migration replaces three trigger functions with versions that
-- also write the source row id into the payload as message_id /
-- comment_id, alongside what they already had. No schema changes —
-- just richer payloads going forward. Backfill is unnecessary because
-- digest emails are throwaway after `emailed_at`.
--
-- - enqueue_comment_notification — adds `comment_id` to the task
--   branch; the card branch already had it.
-- - enqueue_dm_message_notification — adds `message_id`.
-- - enqueue_hub_mention_notification — already had `entity_id`; we
--   rename for clarity AND keep entity_id for back-compat.
-- ─────────────────────────────────────────────

-- 1. Task comment trigger — add comment_id (the card branch already
--    builds card_id + comment_id; only the task branch was missing it).
--    This re-implements the SAME function from migration 070 with the
--    one new key. Preserves the 070 payload shape for both branches.

create or replace function public.enqueue_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  watcher       uuid;
  mentioned     uuid;
  payload_json  jsonb;
  author_name   text;
  task_title_v  text;
  card_title_v  text;
  hub_id_v      uuid;
begin
  select full_name into author_name from public.profiles where id = new.author_id;

  if new.task_id is not null then
    select title into task_title_v from public.tasks where id = new.task_id;

    payload_json := jsonb_build_object(
      'actor_id',   new.author_id,
      'actor_name', coalesce(author_name, 'Someone'),
      'task_id',    new.task_id,
      'task_title', coalesce(task_title_v, 'Task'),
      'comment_id', new.id,
      'snippet',    left(coalesce(new.content, ''), 140)
    );

    for watcher in
      select distinct uid from (
        select t.assigned_to as uid from public.tasks t where t.id = new.task_id
        union
        select t.assigned_by as uid from public.tasks t where t.id = new.task_id
        union
        select ta.profile_id as uid from public.task_assignees ta where ta.task_id = new.task_id
      ) w where uid is not null and uid <> new.author_id
    loop
      insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
      values (watcher, 'comment_posted', payload_json, 'comments', new.id);
    end loop;

    if new.mentioned_ids is not null and array_length(new.mentioned_ids, 1) > 0 then
      foreach mentioned in array new.mentioned_ids loop
        if mentioned <> new.author_id then
          insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
          values (mentioned, 'comment_mention', payload_json, 'comments', new.id);
        end if;
      end loop;
    end if;

    return new;
  end if;

  if new.card_id is not null then
    select hm.hub_id, c.title into hub_id_v, card_title_v
      from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
     where c.id = new.card_id;

    payload_json := jsonb_build_object(
      'actor_id',   new.author_id,
      'actor_name', coalesce(author_name, 'Someone'),
      'card_id',    new.card_id,
      'hub_id',     hub_id_v,
      'card_title', coalesce(card_title_v, 'a card'),
      'comment_id', new.id,
      'snippet',    left(coalesce(new.content, ''), 140)
    );

    for watcher in
      select profile_id from public.hub_card_assignees
       where card_id = new.card_id and profile_id <> new.author_id
    loop
      insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
      values (watcher, 'card_comment', payload_json, 'comments', new.id);
    end loop;

    if new.mentioned_ids is not null and array_length(new.mentioned_ids, 1) > 0 then
      foreach mentioned in array new.mentioned_ids loop
        if mentioned <> new.author_id then
          insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
          values (mentioned, 'card_mention', payload_json, 'comments', new.id);
        end if;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

-- 2. DM/group/hub-campfire/task-chat trigger — add message_id.
--    Same body as 062 but with `'message_id', new.id` added to the
--    jsonb_build_object call.

create or replace function public.enqueue_dm_message_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  author_name text;
  participant_id uuid;
  is_mentioned boolean;
  event_type_val text;
  task_title_val text;
  hub_name_val text;
begin
  select * into conv from public.conversations where id = new.conversation_id;
  select full_name into author_name from public.profiles where id = new.author_id;

  if conv.kind = 'task' and conv.task_id is not null then
    select title into task_title_val from public.tasks where id = conv.task_id;
  end if;

  if conv.kind = 'hub' and conv.hub_id is not null then
    select name into hub_name_val from public.hubs where id = conv.hub_id;
  end if;

  for participant_id in
    select user_id from public.conversation_participants where conversation_id = new.conversation_id
  loop
    if participant_id = new.author_id then continue; end if;

    is_mentioned := exists (
      select 1
        from jsonb_array_elements(coalesce(new.mentions, '[]'::jsonb)) as m
       where (m ->> 'user_id')::uuid = participant_id
    );

    -- Event type by conv kind + mention.
    if conv.kind = 'task' then
      event_type_val := case when is_mentioned then 'task_chat_mention' else 'task_chat_message' end;
    elsif conv.kind = 'hub' then
      -- Hub campfire activity uses the same outbox slots as group chats.
      event_type_val := case when is_mentioned then 'group_mention' else 'group_message' end;
    elsif conv.kind = 'group' then
      event_type_val := case when is_mentioned then 'group_mention' else 'group_message' end;
    else
      event_type_val := 'dm_message';
    end if;

    insert into public.notification_outbox
      (recipient_id, event_type, payload, source_table, source_id)
    values
      (participant_id, event_type_val,
       jsonb_build_object(
         'actor_id',          new.author_id,
         'actor_name',        coalesce(author_name, 'Someone'),
         'conversation_id',   conv.id,
         'conversation_kind', conv.kind,
         'task_id',           conv.task_id,
         'task_title',        task_title_val,
         'hub_id',            conv.hub_id,
         'hub_name',          hub_name_val,
         'group_title',       conv.title,
         'message_id',        new.id,
         'snippet',           left(coalesce(new.content, ''), 140),
         'is_mention',        is_mentioned
       ),
       'dm_messages', new.id);
  end loop;
  return new;
end;
$$;

-- 3. Hub mention trigger — already writes entity_id; alias as message_id
--    for clarity in the digest renderer (entity_id can also be a
--    todo-item or non-message in some hub_mentions rows, but the digest
--    only renders the link when both message_id and hub_id are present
--    for entity_type = 'hub_message').

create or replace function public.enqueue_hub_mention_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mentioner_name text;
  hub_name text;
begin
  if new.mentioned_user is null or new.mentioned_user = new.mentioned_by then
    return new;
  end if;
  select full_name into mentioner_name from public.profiles where id = new.mentioned_by;
  select name into hub_name from public.hubs where id = new.hub_id;

  insert into public.notification_outbox
    (recipient_id, event_type, payload, source_table, source_id)
  values
    (new.mentioned_user, 'hub_mention',
     jsonb_build_object(
       'actor_id',     new.mentioned_by,
       'actor_name',   coalesce(mentioner_name, 'Someone'),
       'hub_id',       new.hub_id,
       'hub_name',     coalesce(hub_name, 'a hub'),
       'entity_type',  new.entity_type,
       'entity_id',    new.entity_id,
       'message_id',   case when new.entity_type = 'hub_message' then new.entity_id else null end
     ),
     'hub_mentions', new.id);
  return new;
end;
$$;
```

**Step 2: Apply the migration to cloud staging**

```bash
PAT=$(grep ^SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) && \
  BODY=$(jq -Rs '{query: .}' < supabase/migrations/085_deep_link_payloads.sql) && \
  curl -s -X POST "https://api.supabase.com/v1/projects/urdzocyfxgyhqmoqbuvk/database/query" \
    -H "Authorization: Bearer $PAT" \
    -H "Content-Type: application/json" \
    -d "$BODY"
```

Expected output: `[]` (empty array on DDL success). STOP if anything else.

**Step 3: Smoke-verify the new payload shape on staging**

Insert one test row to confirm the trigger fires and payload includes the new fields. Adapt the SQL to a real task you can write a comment to:

```bash
PAT=$(grep ^SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) && \
  curl -s -X POST "https://api.supabase.com/v1/projects/urdzocyfxgyhqmoqbuvk/database/query" \
    -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
    -d '{"query": "select payload from public.notification_outbox where event_type = $$comment_posted$$ order by created_at desc limit 1"}'
```

If a row exists, confirm the payload contains both `task_id` AND `comment_id`. If no rows yet, that's fine — the migration is forward-only.

**Step 4: Commit**

```bash
git add supabase/migrations/085_deep_link_payloads.sql
git commit -m "feat(notify): migration 085 — payload carries message_id / comment_id for deep links"
```

---

## Task 2: `lib/notificationLinks.js` — pure URL builders + tests

**Files:**
- Create: `src/lib/notificationLinks.js`
- Test: `src/lib/__tests__/notificationLinks.test.js`

Edge functions and the frontend both need to build the same URLs. We put the formatter in pure JS so vitest can verify the shape.

**Step 1: Write the failing test**

Create `src/lib/__tests__/notificationLinks.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import {
  taskUrl, taskCommentUrl,
  cardUrl, cardCommentUrl,
  dmUrl, dmMessageUrl,
  hubMessageUrl,
} from '../notificationLinks'

const BASE = 'https://app.example'

describe('notificationLinks', () => {
  describe('taskUrl / taskCommentUrl', () => {
    it('builds /my-tasks?task=<id>', () => {
      expect(taskUrl(BASE, 'abc')).toBe(`${BASE}/my-tasks?task=abc`)
    })
    it('appends &comment when given', () => {
      expect(taskCommentUrl(BASE, 'abc', 'def')).toBe(`${BASE}/my-tasks?task=abc&comment=def`)
    })
    it('returns null when task id missing', () => {
      expect(taskUrl(BASE, null)).toBe(null)
      expect(taskCommentUrl(BASE, null, 'def')).toBe(null)
    })
  })

  describe('cardUrl / cardCommentUrl', () => {
    it('builds /hub/<hubId>?card=<cardId>', () => {
      expect(cardUrl(BASE, 'h1', 'c1')).toBe(`${BASE}/hub/h1?card=c1`)
    })
    it('appends &comment when given', () => {
      expect(cardCommentUrl(BASE, 'h1', 'c1', 'cm1')).toBe(`${BASE}/hub/h1?card=c1&comment=cm1`)
    })
    it('returns null when hubId or cardId missing', () => {
      expect(cardUrl(BASE, null, 'c1')).toBe(null)
      expect(cardUrl(BASE, 'h1', null)).toBe(null)
    })
  })

  describe('dmUrl / dmMessageUrl', () => {
    it('builds /?dm=<convId>', () => {
      expect(dmUrl(BASE, 'conv1')).toBe(`${BASE}/?dm=conv1`)
    })
    it('appends &message when given', () => {
      expect(dmMessageUrl(BASE, 'conv1', 'm1')).toBe(`${BASE}/?dm=conv1&message=m1`)
    })
    it('returns null when convId missing', () => {
      expect(dmUrl(BASE, null)).toBe(null)
    })
  })

  describe('hubMessageUrl', () => {
    it('builds /hub/<hubId>?message=<msgId>', () => {
      expect(hubMessageUrl(BASE, 'h1', 'm1')).toBe(`${BASE}/hub/h1?message=m1`)
    })
    it('returns null when hubId missing', () => {
      expect(hubMessageUrl(BASE, null, 'm1')).toBe(null)
    })
  })

  it('encodes ids that contain reserved chars', () => {
    expect(taskUrl(BASE, 'a/b')).toBe(`${BASE}/my-tasks?task=a%2Fb`)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/notificationLinks.test.js
```

Expected: FAIL with "Cannot find module '../notificationLinks'".

**Step 3: Write the helper**

Create `src/lib/notificationLinks.js`:

```javascript
// Pure URL builders for notification deep links. Used by edge functions
// (rendered into email HTML) AND by the frontend (when we need to build
// a "share this thread" link). Centralised so the URL contract has one
// source of truth — keep it in sync with the table at the top of
// docs/plans/2026-04-29-deep-link-notifications.md.

function withParams(base, path, params) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null) sp.set(k, v)
  }
  const qs = sp.toString()
  return qs ? `${base}${path}?${qs}` : `${base}${path}`
}

export function taskUrl(base, taskId) {
  if (!taskId) return null
  return withParams(base, '/my-tasks', { task: taskId })
}

export function taskCommentUrl(base, taskId, commentId) {
  if (!taskId) return null
  return withParams(base, '/my-tasks', { task: taskId, comment: commentId || null })
}

export function cardUrl(base, hubId, cardId) {
  if (!hubId || !cardId) return null
  return withParams(base, `/hub/${encodeURIComponent(hubId)}`, { card: cardId })
}

export function cardCommentUrl(base, hubId, cardId, commentId) {
  if (!hubId || !cardId) return null
  return withParams(base, `/hub/${encodeURIComponent(hubId)}`, { card: cardId, comment: commentId || null })
}

export function dmUrl(base, convId) {
  if (!convId) return null
  return withParams(base, '/', { dm: convId })
}

export function dmMessageUrl(base, convId, messageId) {
  if (!convId) return null
  return withParams(base, '/', { dm: convId, message: messageId || null })
}

export function hubMessageUrl(base, hubId, messageId) {
  if (!hubId) return null
  return withParams(base, `/hub/${encodeURIComponent(hubId)}`, { message: messageId || null })
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/notificationLinks.test.js
```

Expected: PASS, all 13 cases.

**Step 5: Commit**

```bash
git add src/lib/notificationLinks.js src/lib/__tests__/notificationLinks.test.js
git commit -m "feat(notify): pure URL builders for deep links + tests"
```

---

## Task 3: Frontend — chat widget reads `?dm=<convId>&message=<msgId>` from URL

**Files:**
- Modify: `src/components/chat/ChatWidget.jsx`

The widget already listens for a `pe-chat-open` window CustomEvent with `{conversationId}` (line 38-55). We extend it to also accept `messageId` AND read the same params from `location.search` on first mount (so a fresh page load with `?dm=…&message=…` opens the conversation).

**Step 1: Modify `src/components/chat/ChatWidget.jsx`**

Find the existing effect that listens for `pe-chat-open` (around line 38-55). Replace it with a version that also consumes URL params + supports `messageId`:

```jsx
import { useLocation, useNavigate } from 'react-router-dom'
// ...add to existing imports

// Inside ChatWidget, after the other useState calls:
const location = useLocation()
const navigate = useNavigate()

// Consume URL deep-link params (?dm=<convId>&message=<msgId>) on mount
// AND on URL change. Open the conversation; if a message id is provided
// fire a `pe-chat-scroll-to-message` follow-up event so the open pane
// scrolls + highlights it (existing pattern uses `data-message-id` +
// `pe-msg-highlight`). Then strip the params so back/forward doesn't
// re-trigger and so the URL stays clean.
useEffect(() => {
  const params = new URLSearchParams(location.search)
  const convId = params.get('dm')
  if (!convId) return

  const messageId = params.get('message')
  setThreadState(null)
  setState(s => ({
    ...s,
    expanded: true,
    openConversationIds: s.openConversationIds.includes(convId)
      ? s.openConversationIds
      : [...s.openConversationIds, convId],
    minimizedIds: s.minimizedIds.filter(id => id !== convId),
  }))
  if (messageId) {
    // Defer so the pane has rendered before we ask it to scroll.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('pe-chat-scroll-to-message', {
        detail: { conversationId: convId, messageId },
      }))
    }, 200)
  }
  // Strip the params so the URL is clean after the deep-link is consumed.
  const next = new URLSearchParams(location.search)
  next.delete('dm')
  next.delete('message')
  const qs = next.toString()
  navigate(
    { pathname: location.pathname, search: qs ? `?${qs}` : '' },
    { replace: true }
  )
}, [location.search, location.pathname, navigate])

// Existing pe-chat-open listener — extended to forward messageId via the
// new pe-chat-scroll-to-message event when present.
useEffect(() => {
  function handler(e) {
    const convId = e.detail?.conversationId
    if (!convId) return
    setThreadState(null)
    setState(s => ({
      ...s,
      expanded: true,
      openConversationIds: s.openConversationIds.includes(convId)
        ? s.openConversationIds
        : [...s.openConversationIds, convId],
      minimizedIds: s.minimizedIds.filter(id => id !== convId),
    }))
    const messageId = e.detail?.messageId
    if (messageId) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('pe-chat-scroll-to-message', {
          detail: { conversationId: convId, messageId },
        }))
      }, 200)
    }
  }
  window.addEventListener('pe-chat-open', handler)
  return () => window.removeEventListener('pe-chat-open', handler)
}, [])
```

**Step 2: Verify build**

```bash
npm run build
```

Expected: clean build.

**Step 3: Commit**

```bash
git add src/components/chat/ChatWidget.jsx
git commit -m "feat(chat): URL-driven deep-link to conversation + message"
```

---

## Task 4: Frontend — `ConversationPane` listens for `pe-chat-scroll-to-message`

**Files:**
- Modify: `src/components/chat/ConversationPane.jsx`

The pane already has a scroll-to-message helper that watches an internal target id (around line 80). We extend it to also react to the new window event so URL deep-links land cleanly.

**Step 1: Read the file's existing scroll-to-message logic** to confirm where to splice in.

```bash
sed -n '70,110p' src/components/chat/ConversationPane.jsx
```

Identify the existing target-id state + effect.

**Step 2: Add a window-event listener that sets the scroll target**

In `ConversationPane.jsx`, alongside the existing target-id state, add an effect that listens for `pe-chat-scroll-to-message` filtered to this pane's conversation id:

```jsx
useEffect(() => {
  function handler(e) {
    if (e.detail?.conversationId !== conversation.id) return
    const messageId = e.detail?.messageId
    if (!messageId) return
    // Reuse the existing scroll-to-message machinery by setting the
    // same internal target state used by reply-jumps.
    setScrollToMessageId(messageId)
  }
  window.addEventListener('pe-chat-scroll-to-message', handler)
  return () => window.removeEventListener('pe-chat-scroll-to-message', handler)
}, [conversation.id])
```

(Replace `setScrollToMessageId` with whatever the existing setter is named — read the file first to confirm.)

**Step 3: Verify build**

```bash
npm run build
```

Expected: clean build.

**Step 4: Manually smoke-test the path locally**

With the dev server running, in a logged-in session, paste in the URL bar:

```
http://localhost:5173/?dm=<an existing conversation id>&message=<a message id from that conversation>
```

The chat widget should: open, focus on the conversation, scroll to the message, briefly highlight it, then strip the URL params.

If broken: read `ConversationPane.jsx` lines 70-110 to confirm the setter name + state shape; the contract is just "set a state that the existing effect already watches".

**Step 5: Commit**

```bash
git add src/components/chat/ConversationPane.jsx
git commit -m "feat(chat): pe-chat-scroll-to-message bridges URL deep-link to existing scroll machinery"
```

---

## Task 5: Frontend — `MyTasksPage` reads `?comment=<id>` and scrolls

**Files:**
- Modify: `src/pages/MyTasksPage.jsx`

The page already reads `?task=<id>`. We add a `?comment=<id>` consumer that, once the task panel is open AND the comments are loaded, scrolls to the comment row + briefly highlights it. Strip the param after consuming.

**Step 1: Find the comment list render site**

```bash
grep -n "comment\|Comments" src/pages/MyTasksPage.jsx | head -20
grep -n "data-comment-id\|comment.id" src/components/tasks/TaskDetailPanel.jsx | head -10
```

Comments are rendered inside the `TaskDetailPanel`. Confirm whether each comment element already has a stable `data-` attribute (e.g. `data-comment-id={c.id}`). If not, add one in Task 6 (below). For now, assume it exists.

**Step 2: Add the comment-target effect to `MyTasksPage`**

Near the existing `?task` effect (around line 90-109), add:

```jsx
// Deep-link to a specific comment — strip the param after consuming so
// realtime refetches don't re-scroll. Pattern matches the chat widget's
// `pe-msg-highlight` flash.
useEffect(() => {
  const targetCommentId = new URLSearchParams(location.search).get('comment')
  if (!targetCommentId || !activeTaskId) return
  let attempts = 0
  function tick() {
    const el = document.querySelector(`[data-comment-id="${CSS.escape(targetCommentId)}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('pe-msg-highlight')
      requestAnimationFrame(() => el.classList.add('pe-msg-highlight'))
      setTimeout(() => el.classList.remove('pe-msg-highlight'), 1600)
      // Strip ?comment from the URL once consumed.
      const params = new URLSearchParams(location.search)
      params.delete('comment')
      const qs = params.toString()
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '' },
        { replace: true }
      )
      return
    }
    if (attempts >= 10) return
    attempts += 1
    setTimeout(tick, 150)
  }
  tick()
  // Re-run when the task panel opens or location changes.
}, [activeTaskId, location.search, location.pathname, navigate])
```

**Step 3: Verify build**

```bash
npm run build
```

Expected: clean.

**Step 4: Commit**

```bash
git add src/pages/MyTasksPage.jsx
git commit -m "feat(tasks): MyTasksPage reads ?comment=<id> and scrolls to the comment"
```

---

## Task 6: Frontend — `TaskDetailPanel` ensures `data-comment-id` on each comment row

**Files:**
- Modify: `src/components/tasks/TaskDetailPanel.jsx` (or whatever component renders the comment list inside the panel)

**Step 1: Find the comment list JSX**

```bash
grep -n "comments.map\|key={c.id}\|key={comment.id}" src/components/tasks/TaskDetailPanel.jsx
```

**Step 2: Add `data-comment-id={comment.id}` to the wrapping element**

Identify the outermost element of each comment row and add the attribute. If the comments are rendered in a sub-component (`CommentRow.jsx` or similar), put it there.

The minimal change is one attribute: `data-comment-id={comment.id}`. Do not refactor anything else.

**Step 3: Verify build**

```bash
npm run build
```

Expected: clean.

**Step 4: Smoke-test with a manual URL**

With the dev server running and a real task that has comments:

```
http://localhost:5173/my-tasks?task=<task-uuid>&comment=<comment-uuid>
```

Expected: the panel opens, the comment scrolls into view, briefly flashes via `.pe-msg-highlight`, and the URL becomes `/my-tasks?task=<task-uuid>` (with `comment` stripped).

**Step 5: Commit**

```bash
git add src/components/tasks/TaskDetailPanel.jsx
git commit -m "feat(tasks): data-comment-id anchor on comment rows for deep linking"
```

---

## Task 7: Frontend — `CardDetailPanel` reads `?comment=<id>` and scrolls

**Files:**
- Modify: `src/components/hub/cards/CardDetailPanel.jsx`
- Modify: `src/components/hub/cards/CardComments.jsx`

Mirror the task path. Comment list is in `CardComments.jsx`; add `data-comment-id={c.id}` to each row, then add the consume-effect to `CardDetailPanel.jsx`.

**Step 1: Add `data-comment-id` to `CardComments.jsx`**

Find the comment row rendering (around `comments.map(c => (...))` ); add `data-comment-id={c.id}` to the outer `<div>`.

**Step 2: Add the consume-effect to `CardDetailPanel.jsx`**

In `CardDetailPanel.jsx`, alongside the existing card load + realtime effects, add:

```jsx
useEffect(() => {
  const targetCommentId = new URLSearchParams(location.search).get('comment')
  if (!targetCommentId || !card) return
  let attempts = 0
  function tick() {
    const el = document.querySelector(`[data-comment-id="${CSS.escape(targetCommentId)}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('pe-msg-highlight')
      requestAnimationFrame(() => el.classList.add('pe-msg-highlight'))
      setTimeout(() => el.classList.remove('pe-msg-highlight'), 1600)
      const params = new URLSearchParams(location.search)
      params.delete('comment')
      const qs = params.toString()
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '' },
        { replace: true }
      )
      return
    }
    if (attempts >= 10) return
    attempts += 1
    setTimeout(tick, 150)
  }
  tick()
}, [card, location.search, location.pathname, navigate])
```

`location` and `navigate` need to be imported via `useLocation()` and `useNavigate()` if not already present (the panel currently uses `useSearchParams` for `?card`; either keep both or convert to `useLocation`/`useNavigate` consistently).

**Step 3: Verify build + smoke-test**

```bash
npm run build
```

Manual URL with real values:
```
http://localhost:5173/hub/<hubId>?card=<cardId>&comment=<commentId>
```

Expected: the card detail modal opens, comment scrolls into view + flashes, URL becomes `…?card=<cardId>` (`comment` stripped).

**Step 4: Commit**

```bash
git add src/components/hub/cards/CardDetailPanel.jsx src/components/hub/cards/CardComments.jsx
git commit -m "feat(card-table): CardDetailPanel reads ?comment=<id> and scrolls"
```

---

## Task 8: Frontend — `HubPage` MessageBoard reads `?message=<id>` and scrolls

**Files:**
- Modify: `src/pages/HubPage.jsx`
- Modify: `src/components/hub/MessageBoard.jsx`

Hub mention emails should land users on the specific message-board entry that mentioned them. Mirror the comment pattern: `data-message-id` on each message-board row + a consumer effect on `HubPage`.

**Step 1: Add `data-message-id={m.id}` to each row in `MessageBoard.jsx`**

Find where the messages array is mapped and add the attribute on the outermost row element. Threaded replies should NOT get the attribute (only top-level messages).

**Step 2: Add the consumer effect to `HubPage.jsx`'s `HubDashboard`**

```jsx
const [params] = useSearchParams()
const targetMessageId = params.get('message')
useEffect(() => {
  if (!targetMessageId) return
  let attempts = 0
  function tick() {
    const el = document.querySelector(`[data-message-id="${CSS.escape(targetMessageId)}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('pe-msg-highlight')
      requestAnimationFrame(() => el.classList.add('pe-msg-highlight'))
      setTimeout(() => el.classList.remove('pe-msg-highlight'), 1600)
      const next = new URLSearchParams(params)
      next.delete('message')
      // Use setSearchParams (already imported) instead of navigate.
      setSearchParams(next, { replace: true })
      return
    }
    if (attempts >= 12) return
    attempts += 1
    setTimeout(tick, 150)
  }
  tick()
}, [targetMessageId])
```

The `data-message-id` attribute is shared with the chat widget (which already uses it). On a hub page with both a campfire AND a message board open, the first matching element wins — fine in practice because hub mentions are board-only.

**Step 3: Verify build + smoke-test**

```bash
npm run build
```

Manual URL:
```
http://localhost:5173/hub/<hubId>?message=<messageId>
```

Expected: hub loads, message-board row scrolls into view + flashes, URL becomes `/hub/<hubId>` (`message` stripped).

**Step 4: Commit**

```bash
git add src/pages/HubPage.jsx src/components/hub/MessageBoard.jsx
git commit -m "feat(hub): hub message board reads ?message=<id> and scrolls"
```

---

## Task 9: Edge function — `notify` (instant task email) uses link table

**Files:**
- Modify: `supabase/functions/notify/index.ts`

Currently the View Task / View Details / Reassign Task buttons all link to `/my-tasks?task=<id>`. That works for assignees; for assigners (e.g. Manager who got a "task declined" email but isn't assigned the task) the link opens My Tasks but the task isn't there until the silent-refetch fallback kicks in.

The simplest fix: the URL is already correct in form (`/my-tasks?task=<id>` with the silent-refetch fallback in place). But comment-related events should now include the comment id.

The instant `notify` function only sends task lifecycle emails (assigned, completed, declined, reassigned), NOT comment emails — comment emails go through the digest. So `notify` just needs:
- The existing `${APP_URL}/my-tasks?task=${task.id}` URLs (no change).
- (Optional, if simple): a `comment=<id>` param when the email is "X commented on your task". But `notify` doesn't actually send that today — comment notifications live in the digest. So no change needed in `notify`.

**Verify by reading the file:**

```bash
grep -nE "section|email|subject|comment_posted|comment_mention" supabase/functions/notify/index.ts | head -20
```

Confirm `notify` does NOT send a `comment_posted` / `comment_mention` email instantly. If it doesn't (expected), there's nothing to change here.

**If it DOES send comment emails:** add a `&comment=${comment.id}` to the URL. Otherwise skip.

**Step 1: Confirm no change needed**

If the grep above shows comment_posted is NOT handled in notify, mark Task 9 as a no-op verification step. Document it:

```bash
git commit --allow-empty -m "verify(notify): no link change needed — comment emails live in digest"
```

**Step 2: If notify DOES handle comments,** edit the link to:
```ts
`${APP_URL}/my-tasks?task=${task.id}&comment=${comment.id}`
```
…and commit accordingly.

---

## Task 10: Edge function — `send-alerts` keeps current link

**Files:**
- Modify: `supabase/functions/send-alerts/index.ts` (probably no change)

Send-alerts emails overdue / due-soon notifications. The link `${APP_URL}/my-tasks?task=${task.id}` is correct — there's no "specific comment" to anchor. **No change.**

```bash
git commit --allow-empty -m "verify(send-alerts): no link change needed — task-level deep link is correct"
```

---

## Task 11: Edge function — `hub-mention-notify` deep-links to message

**Files:**
- Modify: `supabase/functions/hub-mention-notify/index.ts`

Currently the Open Hub button links to `${APP_URL}/hub/${record.hub_id}` — generic. Change it to include `?message=<messageId>` when the mention's `entity_type = 'hub_message'` and `entity_id` is set.

**Step 1: Locate the link**

```bash
grep -n "Open Hub\|hub/\${record.hub_id}" supabase/functions/hub-mention-notify/index.ts
```

**Step 2: Build a deep link inline**

```ts
const messageId = record.entity_type === 'hub_message' ? record.entity_id : null
const link = messageId
  ? `${APP_URL}/hub/${record.hub_id}?message=${messageId}`
  : `${APP_URL}/hub/${record.hub_id}`

// In the HTML template:
// <a href="${link}" ...>Open Hub</a>
```

Replace the existing `href` template literal in the email HTML with `link`.

**Step 3: Deploy NOT in this commit — see Task 13**

**Step 4: Commit**

```bash
git add supabase/functions/hub-mention-notify/index.ts
git commit -m "feat(notify): hub-mention-notify deep-links to the mentioned message"
```

---

## Task 12: Edge function — `dm-offline-notify` deep-links to message

**Files:**
- Modify: `supabase/functions/dm-offline-notify/index.ts`

Currently uses `${APP_URL}/my-tasks?task=${conv.task_id}` for task chats. For everything else it probably uses a generic URL. Standardize: every DM offline email uses `dmMessageUrl(base, convId, messageId)`.

**Step 1: Read the current link logic**

```bash
sed -n '120,150p' supabase/functions/dm-offline-notify/index.ts
```

**Step 2: Replace per-conversation-kind link logic**

```ts
// Build a deep link to the conversation, anchored on the most recent
// pending message id when available. Falls back to /?dm=<id> when the
// row doesn't carry a message id (rare edge case).
const link = pendingRow.message_id
  ? `${APP_URL}/?dm=${conv.id}&message=${pendingRow.message_id}`
  : `${APP_URL}/?dm=${conv.id}`
```

Use `link` everywhere the per-conversation URL was being assembled. Confirm `pendingRow` (or whatever variable carries the row) has access to `message_id` from `pending_dm_emails`. If it doesn't, a small SELECT change is needed — note in the commit message.

**Step 3: Verify by grep that no `/my-tasks?task=` URL survives in dm-offline-notify** (those broke for non-assignees).

**Step 4: Commit**

```bash
git add supabase/functions/dm-offline-notify/index.ts
git commit -m "feat(notify): dm-offline-notify deep-links to specific message"
```

---

## Task 13: Edge function — `notification-digest` deep-links every section

**Files:**
- Modify: `supabase/functions/notification-digest/index.ts`

The digest is the biggest win — most sections currently render text-only. Wrap each item's relevant text in an `<a>` pointing to the right URL.

**Step 1: Read the current sections and identify per-section link target**

```bash
sed -n '70,150p' supabase/functions/notification-digest/index.ts
```

**Step 2: Add a tiny URL builder at the top of the file**

After the `PUBLIC_APP_URL` constant, add:

```ts
function taskLink(taskId: string | null, commentId?: string | null): string | null {
  if (!taskId) return null
  return commentId
    ? `${PUBLIC_APP_URL}/my-tasks?task=${escape(taskId)}&comment=${escape(commentId)}`
    : `${PUBLIC_APP_URL}/my-tasks?task=${escape(taskId)}`
}

function dmLink(convId: string | null, messageId?: string | null): string | null {
  if (!convId) return null
  return messageId
    ? `${PUBLIC_APP_URL}/?dm=${escape(convId)}&message=${escape(messageId)}`
    : `${PUBLIC_APP_URL}/?dm=${escape(convId)}`
}

function hubMessageLink(hubId: string | null, messageId?: string | null): string | null {
  if (!hubId) return null
  return messageId
    ? `${PUBLIC_APP_URL}/hub/${escape(hubId)}?message=${escape(messageId)}`
    : `${PUBLIC_APP_URL}/hub/${escape(hubId)}`
}

function asLink(label: string, url: string | null): string {
  return url
    ? `<a href="${url}" style="color:#4f46e5; text-decoration:none;">${label}</a>`
    : label
}
```

**Step 3: Wrap each section's title in `asLink(...)`**

Replace each section renderer body with the linked equivalent. Below shows the diff for the most impactful sections.

**`task_assigned`:**

```ts
section('Tasks assigned to you', byType['task_assigned'] || [], (r) => {
  const title = `<strong>${escape(r.payload.task_title || 'Task')}</strong>`
  return `${asLink(title, taskLink(r.payload.task_id))} — assigned by ${escape(r.payload.actor_name || 'Someone')}`
})
```

**`comment_posted` + `comment_mention`:**

```ts
const commentItems = (byType['comment_mention'] || []).concat(byType['comment_posted'] || [])
section('Task comments', commentItems, (r) => {
  const isMention = r.event_type === 'comment_mention'
  const title = `<strong>${escape(r.payload.task_title || 'a task')}</strong>`
  const linked = asLink(title, taskLink(r.payload.task_id, r.payload.comment_id))
  return `${isMention ? '<strong>@you</strong> ' : ''}${escape(r.payload.actor_name || 'Someone')} on ${linked}: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
})
```

**`dm_message`:**

```ts
section('Direct messages', byType['dm_message'] || [], (r) => {
  const actor = `<strong>${escape(r.payload.actor_name || 'Someone')}</strong>`
  const linked = asLink(actor, dmLink(r.payload.conversation_id, r.payload.message_id))
  return `${linked}: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
})
```

**`group_mention` + `task_chat_mention`:**

```ts
const chatMentions = (byType['group_mention'] || []).concat(byType['task_chat_mention'] || [])
section('Mentions in chat', chatMentions, (r) => {
  const where = r.payload.conversation_kind === 'task'
    ? `task <strong>${escape(r.payload.task_title || 'a task')}</strong>`
    : r.payload.conversation_kind === 'hub'
      ? `hub <strong>${escape(r.payload.hub_name || r.payload.group_title || 'a hub')}</strong>`
      : `group <strong>${escape(r.payload.group_title || 'a group')}</strong>`
  const link = dmLink(r.payload.conversation_id, r.payload.message_id)
  const linkedWhere = asLink(where, link)
  return `<strong>${escape(r.payload.actor_name || 'Someone')}</strong> mentioned you in ${linkedWhere}: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
})
```

**`group_message` + `task_chat_message`:** same shape as above with "in {where}" wrapped in `asLink(...)`.

**`hub_mention`:**

```ts
section('Hub mentions', byType['hub_mention'] || [], (r) => {
  const hub = `<strong>${escape(r.payload.hub_name || 'a hub')}</strong>`
  const link = hubMessageLink(r.payload.hub_id, r.payload.message_id)
  return `<strong>${escape(r.payload.actor_name || 'Someone')}</strong> mentioned you in ${asLink(hub, link)}`
})
```

**Card sections** — already linked correctly. Migrate them to use `asLink` + the new helpers for consistency:

```ts
section('Cards assigned to you', byType['card_assigned'] || [], (r) => {
  const title = `<strong>${escape(r.payload.card_title || 'Card')}</strong>`
  const link = r.payload.hub_id && r.payload.card_id
    ? `${PUBLIC_APP_URL}/hub/${escape(r.payload.hub_id)}?card=${escape(r.payload.card_id)}`
    : null
  const hub = r.payload.hub_name ? ` in <strong>${escape(r.payload.hub_name)}</strong>` : ''
  return `You were assigned to ${asLink(title, link)}${hub} by ${escape(r.payload.actor_name || 'Someone')}`
})

const cardCommentItems = (byType['card_mention'] || []).concat(byType['card_comment'] || [])
section('Card comments', cardCommentItems, (r) => {
  const isMention = r.event_type === 'card_mention'
  const title = `<strong>${escape(r.payload.card_title || 'a card')}</strong>`
  const link = r.payload.hub_id && r.payload.card_id
    ? `${PUBLIC_APP_URL}/hub/${escape(r.payload.hub_id)}?card=${escape(r.payload.card_id)}${r.payload.comment_id ? `&comment=${escape(r.payload.comment_id)}` : ''}`
    : null
  const verb = isMention ? 'mentioned you on' : 'commented on'
  const prefix = isMention ? '<strong>@you</strong> ' : ''
  return `${prefix}${escape(r.payload.actor_name || 'Someone')} ${verb} ${asLink(title, link)}: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
})
```

**`task_completed` / `task_declined` / `task_reassigned`:**

```ts
section('Task updates', (byType['task_completed'] || []).concat(byType['task_declined'] || []).concat(byType['task_reassigned'] || []), (r) => {
  const title = `<strong>${escape(r.payload.task_title || 'Task')}</strong>`
  return `${asLink(title, taskLink(r.payload.task_id))} ${r.event_type.replace('task_', '')}`
})
```

**Step 4: Verify the file parses**

```bash
deno check supabase/functions/notification-digest/index.ts || true
```

If `deno` isn't installed, just visually re-read the modified region for balanced template literals + parens.

**Step 5: Commit**

```bash
git add supabase/functions/notification-digest/index.ts
git commit -m "feat(notify): notification-digest deep-links every section"
```

---

## Task 14: Deploy the four modified edge functions

After all the in-code changes are committed, deploy the four functions to staging in one batch:

```bash
SUPABASE_ACCESS_TOKEN=$(grep ^SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2)

for fn in notification-digest hub-mention-notify dm-offline-notify; do
  supabase functions deploy "$fn" --project-ref urdzocyfxgyhqmoqbuvk
done
```

(`notify` and `send-alerts` are unchanged — no deploy needed unless Task 9 turned out to need a change.)

Expected: each prints "Deployed successfully".

**Step 1: Smoke-deploy** the digest first only and verify the next scheduled run renders correctly. Inspect the next email that lands.

**Step 2: Commit (no code change, just a deployment marker)**

```bash
git commit --allow-empty -m "deploy: edge functions for deep-link notifications"
```

---

## Task 15: Manual end-to-end smoke test + final commit

With at least 2 logged-in users:

1. **Task assignment digest:** user A assigns task to user B. Wait 15 min for digest cron OR force-run via the SQL editor:
   ```sql
   update public.notification_outbox
      set emailed_at = null
    where event_type = 'task_assigned'
      and recipient_id = '<user_b>'
    order by created_at desc limit 1;
   -- then trigger digest manually via the cron's edge function URL
   ```
   Open the email, click the task title — lands on `/my-tasks?task=<id>` with the panel open. ✓

2. **Task comment digest:** user A comments on a task user B is assigned to. Same flow. Email link should be `/my-tasks?task=<id>&comment=<id>`. Click → panel opens, comment scrolls into view + flashes, URL strips to `?task=`. ✓

3. **DM:** user A messages user B while B is offline. After ~3 min the dm-offline-notify cron sends. Click the link → chat widget opens on the conversation, scrolls to the message, highlights it, URL strips. ✓

4. **Group mention in chat:** A @mentions B in a group. Force-include in digest. Click "in group <X>" → opens chat widget on that group + scroll. ✓

5. **Hub message-board mention:** A @mentions B in a hub message board post. Wait for the instant `hub-mention-notify` email. Click "Open Hub" → lands on `/hub/<id>?message=<id>` → message-board entry scrolls into view + flashes. ✓

6. **Card assigned:** A assigns a card to B. Force-include in digest. Click card title → opens `/hub/<hubId>?card=<id>` with the card detail modal. ✓

7. **Card comment:** A comments on a card B is assigned to. Force-include in digest. Click card title → modal opens, comment scrolls + flashes. ✓

8. **Regression — fully unauthenticated:** log out, paste a deep-link URL, click → Google login → return → land on the deep-linked resource. (If broken, file as a separate bug; not in scope.)

**Final commit (only if any tweaks were needed):**

```bash
git commit -am "fix(notify): smoke-test follow-ups"
```

---

## Verification checklist before merging to main

- [ ] Migration 085 applied to cloud staging
- [ ] Vitest 13+ new helper tests pass (348+/348+ total)
- [ ] `npm run build` clean
- [ ] All 8 smoke-test scenarios pass
- [ ] No regression: existing instant `notify` task emails still work (View Task button still lands on the task panel)
- [ ] No regression: existing reply-jump in chat (`scrollToMessage`) still works after the new `pe-chat-scroll-to-message` listener was added (they coexist)

---

## Future work (NOT in this plan)

1. **Auth-gate redirect preservation.** If a user clicks an email link while logged out, today the OAuth flow may drop the original search params. Worth verifying explicitly and possibly fixing — separate plan.
2. **Email click telemetry.** Add `?utm_source=digest` / `?utm_source=hub-mention-notify` so click-through analytics is tractable. Tiny add.
3. **Per-event "do not link" override.** Some events (e.g. a deleted message) should fall back to a generic page. Today the link still resolves but the resource is gone — handle via a "X has been deleted" UX state.

---

## Plan deviation — entity_type

The Task 1 SQL block (migration 085) and Task 11 paragraph both assumed `hub_mentions.entity_type = 'hub_message'` for hub message-board mentions. The actual value written by `useHubMessages.postMessage` is `'message'` for top-level board posts and `'message_reply'` for thread replies (see `src/hooks/useHubMessages.js:106` and `:136`). The 085 case clause and the Task 11 edge-function check therefore never matched and the deep-link feature always fell back to the generic hub URL.

**Fix shipped as migration 086 (`086_fix_hub_mention_entity_type.sql`)** which replaces `enqueue_hub_mention_notification` again with `case when new.entity_type = 'message' then new.entity_id else null end`. The `hub-mention-notify` edge function was updated in the same commit to match `'message'` instead of `'hub_message'`.

For v1, `'message_reply'` rows still fall back to the generic hub URL — the frontend's `data-hub-message-id` anchor only exists on top-level posts (per Task 8). Resolving a reply's parent for deep-linking would require a JOIN through `hub_messages` and is out of scope here; a future migration can populate `message_id` with the parent post id so the deep link still scrolls into a useful neighbourhood.
