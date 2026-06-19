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
  // Exclude Done task chats: they're filtered out of the widget's Tasks section
  // (useConversations: task_status !== 'Done') and have no other surface, so
  // their unread would be phantom unread on the tab/nav badge with no way to
  // clear it. Mirrors ChatWidget.jsx's badge filter.
  return useMemo(() => totalUnread(
    (conversations || []).filter(c => !(c.kind === 'task' && c.task_status === 'Done'))
  ), [conversations])
}
