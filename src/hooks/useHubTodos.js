import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubTodos(hubId) {
  const { profile } = useAuth()
  const [lists, setLists]   = useState([])
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  /* ── Fetch ── */
  const fetchData = useCallback(async () => {
    if (!hubRef.current) return
    const [{ data: listData, error: lErr }, { data: itemData, error: iErr }] = await Promise.all([
      supabase
        .from('hub_todo_lists')
        .select('*, creator:profiles!hub_todo_lists_created_by_fkey(id, full_name, avatar_url)')
        .eq('hub_id', hubRef.current)
        .is('deleted_at', null)
        .order('position'),
      supabase
        .from('hub_todo_items')
        .select('*, creator:profiles!hub_todo_items_created_by_fkey(id, full_name, avatar_url), completer:profiles!hub_todo_items_completed_by_fkey(id, full_name), hub_todo_item_assignees(profile_id, profiles(id, full_name, avatar_url))')
        .eq('hub_id', hubRef.current)
        .is('deleted_at', null)
        .order('position')
    ])
    if (lErr || iErr) showToast('Failed to load to-dos', 'error')
    setLists(listData || [])
    setItems(itemData || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!hubId) return
    setLoading(true)
    setLists([])
    setItems([])
    fetchData()
  }, [hubId, fetchData])

  /* ── Realtime ── */
  useEffect(() => {
    if (!hubId) return
    const channel = supabase
      .channel(`hub-todos-${hubId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_todo_lists', filter: `hub_id=eq.${hubId}` },
        () => fetchData()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_todo_items', filter: `hub_id=eq.${hubId}` },
        () => fetchData()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId, fetchData])

  /* ── List mutations ── */
  const createList = useCallback(async (input) => {
    if (!hubRef.current || !profile?.id) return null
    // Back-compat: allow createList("just a title") alongside the object form.
    const payload = typeof input === 'string' ? { title: input } : (input || {})
    const { title, description = null, color = 'blue', attachments = [], mentions = [] } = payload
    if (!title?.trim()) return null
    const position = lists.length
    const { data, error } = await supabase.from('hub_todo_lists').insert({
      hub_id: hubRef.current, created_by: profile.id,
      title: title.trim(), description, color,
      mentions,
      attachments: attachments.map(({ preview, ...rest }) => rest),
      position
    }).select().single()
    if (error) { showToast('Failed to create list', 'error'); return null }

    if (data && mentions.length > 0) {
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile.id)
      if (uniqueUsers.length > 0) {
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hubRef.current,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'todo_list',
            entity_id: data.id,
          }))
        )
      }
    }

    await fetchData()
    return data
  }, [profile?.id, lists.length, fetchData])

  const updateList = useCallback(async (id, updates) => {
    const { error } = await supabase.from('hub_todo_lists').update(updates).eq('id', id)
    if (error) { showToast('Failed to update list', 'error'); return false }
    await fetchData()
    return true
  }, [fetchData])

  const deleteList = useCallback(async (id) => {
    const { error } = await supabase.from('hub_todo_lists')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { showToast('Failed to delete list', 'error'); return false }
    await fetchData()
    return true
  }, [fetchData])

  const undoDeleteList = useCallback(async (id) => {
    const { error } = await supabase.from('hub_todo_lists')
      .update({ deleted_at: null })
      .eq('id', id)
    if (error) { showToast('Failed to restore list', 'error'); return false }
    await fetchData()
    return true
  }, [fetchData])

  const reorderLists = useCallback(async (orderedIds) => {
    const updates = orderedIds.map((id, i) =>
      supabase.from('hub_todo_lists').update({ position: i }).eq('id', id)
    )
    await Promise.all(updates)
    await fetchData()
  }, [fetchData])

  /* ── Item mutations ── */
  const createItem = useCallback(async (listId, input) => {
    if (!hubRef.current || !profile?.id) return null
    const payload = typeof input === 'string' ? { title: input } : (input || {})
    const { title, notes = null, due_date = null, assigneeIds = [], attachments = [], mentions = [] } = payload
    if (!title?.trim()) return null

    const listItems = items.filter(i => i.list_id === listId)
    const position = listItems.length
    const { data, error } = await supabase.from('hub_todo_items').insert({
      list_id: listId, hub_id: hubRef.current, created_by: profile.id,
      title: title.trim(), notes, due_date,
      mentions,
      attachments: attachments.map(({ preview, ...rest }) => rest),
      position
    }).select().single()
    if (error) { showToast('Failed to add to-do', 'error'); return null }

    if (assigneeIds.length > 0) {
      await supabase.from('hub_todo_item_assignees').insert(
        assigneeIds.map(pid => ({ item_id: data.id, profile_id: pid }))
      )
    }

    if (data && mentions.length > 0) {
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile.id)
      if (uniqueUsers.length > 0) {
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hubRef.current,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'todo_note',
            entity_id: data.id,
          }))
        )
      }
    }

    await fetchData()
    return data
  }, [profile?.id, items, fetchData])

  const toggleItem = useCallback(async (id, currentlyCompleted) => {
    const updates = currentlyCompleted
      ? { completed: false, completed_at: null, completed_by: null }
      : { completed: true, completed_at: new Date().toISOString(), completed_by: profile?.id }
    const { error } = await supabase.from('hub_todo_items').update(updates).eq('id', id)
    if (error) { showToast('Failed to update to-do', 'error'); return false }
    await fetchData()
    return true
  }, [profile?.id, fetchData])

  const updateItem = useCallback(async (id, updates, mentions = []) => {
    const payload = { ...updates }
    if (mentions.length > 0) payload.mentions = mentions
    if (payload.inlineImages) {
      payload.inline_images = payload.inlineImages.map(({ preview, ...rest }) => rest)
      delete payload.inlineImages
    }
    if (payload.attachments) {
      payload.attachments = payload.attachments.map(({ preview, ...rest }) => rest)
    }
    const { data, error } = await supabase.from('hub_todo_items').update(payload).eq('id', id).select().single()
    if (error) { showToast('Failed to update to-do', 'error'); return false }

    // Handle mentions
    if (data && mentions.length > 0) {
      await supabase.from('hub_mentions').delete().eq('entity_type', 'todo_note').eq('entity_id', data.id)
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile?.id)
      if (uniqueUsers.length > 0) {
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hubRef.current,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'todo_note',
            entity_id: data.id,
          }))
        )
      }
    }
    await fetchData()
    return true
  }, [profile?.id, fetchData])

  const deleteItem = useCallback(async (id) => {
    const { error } = await supabase.from('hub_todo_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { showToast('Failed to delete to-do', 'error'); return false }
    await fetchData()
    return true
  }, [fetchData])

  const undoDeleteItem = useCallback(async (id) => {
    const { error } = await supabase.from('hub_todo_items')
      .update({ deleted_at: null })
      .eq('id', id)
    if (error) { showToast('Failed to restore to-do', 'error'); return false }
    await fetchData()
    return true
  }, [fetchData])

  const reorderItems = useCallback(async (orderedIds) => {
    const updates = orderedIds.map((id, i) =>
      supabase.from('hub_todo_items').update({ position: i }).eq('id', id)
    )
    await Promise.all(updates)
    await fetchData()
  }, [fetchData])

  const setAssignees = useCallback(async (itemId, profileIds) => {
    // Delete existing, insert new
    await supabase.from('hub_todo_item_assignees').delete().eq('item_id', itemId)
    if (profileIds.length > 0) {
      const { error } = await supabase.from('hub_todo_item_assignees').insert(
        profileIds.map(pid => ({ item_id: itemId, profile_id: pid }))
      )
      if (error) { showToast('Failed to update assignees', 'error'); return false }
    }
    await fetchData()
    return true
  }, [fetchData])

  return {
    lists, items, loading,
    createList, updateList, deleteList, undoDeleteList, reorderLists,
    createItem, toggleItem, updateItem, deleteItem, undoDeleteItem, reorderItems, setAssignees,
    refetch: fetchData
  }
}
