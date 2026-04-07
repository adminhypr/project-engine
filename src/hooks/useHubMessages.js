import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubMessages(hubId) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [loading, setLoading]   = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchMessages = useCallback(async () => {
    if (!hubRef.current) return
    const { data, error } = await supabase
      .from('hub_messages')
      .select('*, author:profiles(id, full_name, avatar_url)')
      .eq('hub_id', hubRef.current)
      .is('parent_id', null)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) showToast('Failed to load messages', 'error')
    setMessages(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!hubId) return
    setLoading(true)
    setMessages([])
    fetchMessages()
  }, [hubId, fetchMessages])

  useEffect(() => {
    if (!hubId) return
    const channel = supabase
      .channel(`hub-messages-${hubId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_messages', filter: `hub_id=eq.${hubId}` },
        () => fetchMessages()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId, fetchMessages])

  const postMessage = useCallback(async (title, content) => {
    if (!hubRef.current || !profile?.id) return false
    const { error } = await supabase.from('hub_messages').insert({
      hub_id: hubRef.current,
      author_id: profile.id,
      title, content
    })
    if (error) showToast('Failed to post message', 'error')
    return !error
  }, [profile?.id])

  const replyToMessage = useCallback(async (parentId, content) => {
    if (!hubRef.current || !profile?.id) return false
    const { error } = await supabase.from('hub_messages').insert({
      hub_id: hubRef.current,
      author_id: profile.id,
      parent_id: parentId,
      content
    })
    if (error) showToast('Failed to post reply', 'error')
    return !error
  }, [profile?.id])

  const deleteMessage = useCallback(async (messageId) => {
    const { error } = await supabase.from('hub_messages').delete().eq('id', messageId)
    if (error) showToast('Failed to delete message', 'error')
  }, [])

  const togglePin = useCallback(async (messageId, pinned) => {
    const { error } = await supabase.from('hub_messages').update({ pinned: !pinned }).eq('id', messageId)
    if (error) showToast('Failed to update pin', 'error')
  }, [])

  const getReplies = useCallback(async (parentId) => {
    const { data, error } = await supabase
      .from('hub_messages')
      .select('*, author:profiles(id, full_name, avatar_url)')
      .eq('parent_id', parentId)
      .order('created_at', { ascending: true })
    if (error) showToast('Failed to load replies', 'error')
    return data || []
  }, [])

  return { messages, loading, postMessage, replyToMessage, deleteMessage, togglePin, getReplies }
}
