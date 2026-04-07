import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const PAGE_SIZE = 50

export function useHubChat(hubId) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [loading, setLoading]   = useState(true)
  const [hasMore, setHasMore]   = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchMessages = useCallback(async (cursor) => {
    if (!hubRef.current) return []
    let query = supabase
      .from('hub_chat_messages')
      .select('*, author:profiles(id, full_name, avatar_url)')
      .eq('hub_id', hubRef.current)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (cursor) query = query.lt('created_at', cursor)
    const { data, error } = await query
    if (error) { showToast('Failed to load chat', 'error'); return [] }
    return (data || []).reverse()
  }, [])

  useEffect(() => {
    if (!hubId) return
    setLoading(true)
    setMessages([])
    setHasMore(true)
    fetchMessages().then(data => {
      setMessages(data)
      setHasMore(data.length === PAGE_SIZE)
      setLoading(false)
    })
  }, [hubId, fetchMessages])

  useEffect(() => {
    if (!hubId) return
    const channel = supabase
      .channel(`hub-chat-${hubId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_chat_messages', filter: `hub_id=eq.${hubId}` },
        async (payload) => {
          const { data } = await supabase
            .from('hub_chat_messages')
            .select('*, author:profiles(id, full_name, avatar_url)')
            .eq('id', payload.new.id)
            .single()
          if (data) setMessages(prev => [...prev, data])
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId])

  const sendMessage = useCallback(async (content) => {
    if (!hubRef.current || !profile?.id || !content.trim()) return false
    const { error } = await supabase.from('hub_chat_messages').insert({
      hub_id: hubRef.current,
      author_id: profile.id,
      content: content.trim()
    })
    if (error) showToast('Failed to send message', 'error')
    return !error
  }, [profile?.id])

  const deleteMessage = useCallback(async (messageId) => {
    const { error } = await supabase.from('hub_chat_messages').delete().eq('id', messageId)
    if (error) { showToast('Failed to delete message', 'error'); return }
    setMessages(prev => prev.filter(m => m.id !== messageId))
  }, [])

  const loadMore = useCallback(async () => {
    if (!hasMore || messages.length === 0) return
    const cursor = messages[0].created_at
    let query = supabase
      .from('hub_chat_messages')
      .select('*, author:profiles(id, full_name, avatar_url)')
      .eq('hub_id', hubRef.current)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
      .lt('created_at', cursor)
    const { data } = await query
    const older = (data || []).reverse()
    setMessages(prev => [...older, ...prev])
    setHasMore(older.length === PAGE_SIZE)
  }, [hasMore, messages])

  return { messages, loading, sendMessage, deleteMessage, loadMore, hasMore }
}
