// Shared "is the user online?" helper for instant-email edge functions.
// Returns true when profile_presence.last_seen_at is within
// OFFLINE_WINDOW_MINUTES of now.
//
// Used by notify, hub-mention-notify, dm-offline-notify so they can SKIP
// per-event email blasts when the recipient is currently looking at the
// app — the bell already covers them. The 15-minute notification-digest
// edge function picks up everything else for offline users.
//
// Migration 084 moved the presence cursor off `profiles.last_seen_at` and
// onto its own `profile_presence` table to avoid re-firing the
// sync_effective_role + 042 self-update guard triggers on every heartbeat.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OFFLINE_WINDOW_MINUTES = 5

const _client = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Returns a Set of profile IDs that are currently online (last_seen_at
// within the cutoff). Pass this set into per-event handlers and skip the
// instant email for any recipient in it.
export async function getOnlineProfileIds(profileIds: string[]): Promise<Set<string>> {
  if (!profileIds || profileIds.length === 0) return new Set()
  const cutoff = new Date(Date.now() - OFFLINE_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { data } = await _client
    .from('profile_presence')
    .select('profile_id')
    .in('profile_id', profileIds)
    .gte('last_seen_at', cutoff)
  return new Set((data || []).map((r: any) => r.profile_id))
}

export async function isProfileOnline(profileId: string): Promise<boolean> {
  if (!profileId) return false
  const set = await getOnlineProfileIds([profileId])
  return set.has(profileId)
}
