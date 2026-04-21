import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useConversations } from '../hooks/useConversations'
import ConversationPane from '../components/chat/ConversationPane'

// ConversationPane expects a fully shaped `conversation` object (not just an
// id) — same shape returned by useConversations. So we:
//   1. Call get_or_create_team_group(tid) to resolve the conversation id
//      for the active workspace's team group.
//   2. Pull the matching row out of useConversations (which shapes DMs vs
//      groups and exposes participants / other_profile etc.).
// If the RPC returns an id that isn't in useConversations yet, we call
// refetch() so the membership trigger (migration 033) has a chance to land.
export default function TeamChatPage() {
  const { activeTeamId, presence } = useAuth()
  const { conversations, refetch, markRead } = useConversations()
  const [conversationId, setConversationId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!activeTeamId) {
      setConversationId(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase
      .rpc('get_or_create_team_group', { tid: activeTeamId })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return
        if (rpcErr) {
          console.error('get_or_create_team_group failed', rpcErr)
          setError(rpcErr)
          setConversationId(null)
        } else {
          setConversationId(data)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeTeamId])

  // If the resolved id isn't in the local conversations list yet (fresh
  // group just created server-side), trigger a refetch — but only ONCE per
  // id. If RLS hides the row (e.g., orphaned user not in
  // conversation_participants), we'd otherwise loop forever.
  const triedRef = useRef(new Set())
  useEffect(() => {
    if (!conversationId) return
    if (conversations.some(c => c.id === conversationId)) return
    if (triedRef.current.has(conversationId)) return
    triedRef.current.add(conversationId)
    refetch()
  }, [conversationId, conversations, refetch])

  const conversation = conversationId
    ? conversations.find(c => c.id === conversationId)
    : null

  if (!activeTeamId) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        No team chat available for this workspace.
      </div>
    )
  }

  if (loading || (conversationId && !conversation)) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Loading team chat...
      </div>
    )
  }

  if (error || !conversation) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        No team chat available for this workspace.
      </div>
    )
  }

  return (
    <div className="h-full flex items-stretch justify-center">
      <ConversationPane
        conversation={conversation}
        online={false}
        onMarkRead={markRead}
        fullPage={true}
      />
    </div>
  )
}
