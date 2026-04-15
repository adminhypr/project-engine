import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubTodoComments(itemId, hubId) {
  const { profile } = useAuth()
  const [comments, setComments] = useState([])
  const [loading, setLoading]   = useState(true)
  const itemRef = useRef(itemId)
  itemRef.current = itemId

  const fetchComments = useCallback(async () => {
    if (!itemRef.current) return
    const { data, error } = await supabase
      .from('hub_todo_comments')
      .select('*, author:profiles!hub_todo_comments_created_by_fkey(id, full_name, avatar_url)')
      .eq('item_id', itemRef.current)
      .order('created_at', { ascending: true })
    if (error) showToast('Failed to load comments', 'error')
    setComments(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!itemId) return
    setLoading(true)
    setComments([])
    fetchComments()
  }, [itemId, fetchComments])

  useEffect(() => {
    if (!itemId) return
    const channel = supabase
      .channel(`hub-todo-comments-${itemId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_todo_comments', filter: `item_id=eq.${itemId}` },
        () => fetchComments()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [itemId, fetchComments])

  const addComment = useCallback(async (content, mentions = [], inlineImages = []) => {
    if (!itemRef.current || !hubId || !profile?.id || !content.trim()) return false
    const { data, error } = await supabase.from('hub_todo_comments').insert({
      item_id: itemRef.current,
      hub_id: hubId,
      created_by: profile.id,
      content: content.trim(),
      mentions,
      inline_images: inlineImages.map(({ preview, ...rest }) => rest),
    }).select().single()
    if (error) { showToast('Failed to post comment', 'error'); return false }

    if (data && mentions.length > 0) {
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile.id)
      if (uniqueUsers.length > 0) {
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hubId,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'todo_comment',
            entity_id: data.id,
          }))
        )
      }
    }
    return true
  }, [hubId, profile?.id])

  const deleteComment = useCallback(async (id) => {
    await supabase.from('hub_mentions').delete().eq('entity_id', id)
    const { error } = await supabase.from('hub_todo_comments').delete().eq('id', id)
    if (error) showToast('Failed to delete comment', 'error')
  }, [])

  return { comments, loading, addComment, deleteComment }
}
