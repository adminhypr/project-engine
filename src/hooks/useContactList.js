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
