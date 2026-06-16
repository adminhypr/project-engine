import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { usePresence } from './PresenceContext'
import { useProfiles } from './useTasks'
import { useConversations } from './useConversations'
import { bucketContacts, filterContactsBySearch } from '../lib/dmContacts'
import { groupDisplayName } from '../lib/groupConversations'

export function useContactList(searchQuery = '') {
  const { profile } = useAuth()
  const presence = usePresence()
  const { profiles, loading: profilesLoading } = useProfiles()
  const { conversations, tasks, loading: convsLoading, createOrOpen, createGroup, markRead, refetch } = useConversations()

  const sections = useMemo(() => {
    if (!profile?.id) return { recent: [], teammates: [], company: [] }
    const myTeamIds = profile.team_ids || (profile.team_id ? [profile.team_id] : [])
    // Only DM conversations feed the Recent/Teammates/Company bucketing.
    const dmConversations = (conversations || []).filter(c => c.kind === 'dm')
    return bucketContacts({ profiles, conversations: dmConversations, myId: profile.id, myTeamIds })
  }, [profile?.id, profile?.team_ids, profile?.team_id, profiles, conversations])

  // Hub campfires (kind='hub', wired via migration 064) and explicit groups
  // (kind='group', team-default + custom) are bucketed separately. They
  // share row shape + member-list UX but live in different sections so
  // users can find the project chat vs. their team chat without scanning.
  const filterByQuery = (list) => {
    const q = (searchQuery || '').trim().toLowerCase()
    if (!q) return list
    return list.filter(c => groupDisplayName(c).toLowerCase().includes(q))
  }
  const campfires = useMemo(
    () => filterByQuery((conversations || []).filter(c => c.kind === 'hub')),
    [conversations, searchQuery],
  )
  const groups = useMemo(
    () => filterByQuery((conversations || []).filter(c => c.kind === 'group')),
    [conversations, searchQuery],
  )

  const filtered = useMemo(
    () => filterContactsBySearch(sections, searchQuery),
    [sections, searchQuery]
  )

  return {
    sections: filtered,
    groups,
    campfires,
    tasks: tasks || [],
    conversations,
    presence: presence || new Map(),
    loading: profilesLoading || convsLoading,
    createOrOpen,
    createGroup,
    markRead,
    refetch,
  }
}
