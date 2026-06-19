# Enable Chat Wallpapers — Apply Migration 107

The per-conversation wallpaper feature needs migration **107** applied to the
Supabase database. Until it's applied, the wallpaper picker shows
"Wallpapers aren't enabled yet" (everything else works normally).

## How to apply

**Supabase Dashboard (easiest):**
1. Open your project → **SQL Editor** → **New query**.
2. Paste the SQL below and click **Run**.
3. Done — wallpapers work immediately, no redeploy needed.

**Or via CLI** (needs the DB password):
```bash
SUPABASE_DB_PASSWORD=… supabase db push
```

## The SQL

```sql
-- 107 · Per-conversation SHARED chat wallpaper (Telegram-style)
-- Additive, idempotent, reversible. Adds 3 nullable columns to conversations
-- and ensures conversations UPDATE events broadcast over realtime.

alter table public.conversations
  add column if not exists wallpaper text;

alter table public.conversations
  add column if not exists wallpaper_set_by uuid references public.profiles(id) on delete set null;

alter table public.conversations
  add column if not exists wallpaper_set_at timestamptz;

-- Ensure conversations UPDATE events are broadcast over realtime (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end
$$;
```

## What it does

- `wallpaper` — `null` = none; otherwise `'preset:<key>'` (a neon gradient) or
  `'upload:<path>'` (an image in the `dm-attachments` bucket, signed for display).
- `wallpaper_set_by` / `wallpaper_set_at` — attribution (who/when).
- Reuses the existing `is_conversation_participant()` RLS on the conversations
  UPDATE policy — no new policy, no recursion.
- Uploaded images reuse the `dm-attachments` bucket at
  `{conversationId}/wallpaper/<uuid>.<ext>` (existing RLS already gates it).

## Rollback

```sql
alter table public.conversations
  drop column if exists wallpaper,
  drop column if exists wallpaper_set_by,
  drop column if exists wallpaper_set_at;
-- (No helper/policy created here. Leaving conversations in the realtime
--  publication is harmless.)
```

## Note — external users

External users (Agent/Client) can only set a wallpaper in **team default group**
conversations — not DMs/hubs/tasks — because of the existing conversations
access policy (042). Internal team members are unaffected. Widening this would
need a column-scoped BEFORE UPDATE trigger (deferred).
