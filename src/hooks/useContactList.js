import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { useProfiles } from './useTasks'
import { useConversations } from './useConversations'
import { bucketContacts, filterContactsBySearch } from '../lib/dmContacts'
import { groupDisplayName } from '../lib/groupConversations'

export function useContactList(searchQuery = '') {
  const { profile, presence } = useAuth()
  const { profiles, loading: profilesLoading } = useProfiles()
  const { conversations, tasks, loading: convsLoading, createOrOpen, createGroup, markRead } = useConversations()

  const sections = useMemo(() => {
    if (!profile?.id) return { recent: [], teammates: [], company: [] }
    const myTeamIds = profile.team_ids || (profile.team_id ? [profile.team_id] : [])
    // Only DM conversations feed the Recent/Teammates/Company bucketing.
    const dmConversations = (conversations || []).filter(c => c.kind === 'dm')
    return bucketContacts({ profiles, conversations: dmConversations, myId: profile.id, myTeamIds })
  }, [profile?.id, profile?.team_ids, profile?.team_id, profiles, conversations])

  // Includes hub conversations alongside team/custom groups — they share
  // the same row shape and member-list UX (migration 064).
  const groups = useMemo(() => {
    const raw = (conversations || []).filter(c => c.kind === 'group' || c.kind === 'hub')
    const q = (searchQuery || '').trim().toLowerCase()
    const list = q
      ? raw.filter(g => groupDisplayName(g).toLowerCase().includes(q))
      : raw
    return list
  }, [conversations, searchQuery])

  const filtered = useMemo(
    () => filterContactsBySearch(sections, searchQuery),
    [sections, searchQuery]
  )

  return {
    sections: filtered,
    groups,
    tasks: tasks || [],
    conversations,
    presence: presence || new Map(),
    loading: profilesLoading || convsLoading,
    createOrOpen,
    createGroup,
    markRead,
  }
}
