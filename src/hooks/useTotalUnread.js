import { useMemo } from 'react'
import { useConversations } from './useConversations'
import { totalUnread } from '../lib/dmUnread'

// Thin hook returning the grand total of unread messages across every
// conversation the current user can see (DMs, groups, campfires, task chats).
//
// Backed by useConversations (one Supabase subscription). Mount it in places
// that are NOT the /chat route — Layout + AuthProvider are fine. The /chat page
// already runs its own single useContactList/useConversations instance; do not
// add this hook there (would double-subscribe).
export function useTotalUnread() {
  const { conversations } = useConversations()
  return useMemo(() => totalUnread(conversations), [conversations])
}
