import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'
import { sortCards } from '../lib/cards'

const CARD_SELECT = `
  *,
  assignees:hub_card_assignees(profile:profiles(id, full_name, avatar_url))
`

export function useHubCards(moduleId) {
  const { profile } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const moduleRef = useRef(moduleId)
  moduleRef.current = moduleId
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  const fetch = useCallback(async () => {
    if (!moduleRef.current) return
    const [cardsRes, countsRes] = await Promise.all([
      supabase.from('hub_cards').select(CARD_SELECT).eq('module_id', moduleRef.current),
      // Per-card comment counts via SECURITY INVOKER RPC (migration 071).
      // PostgREST aggregates are disabled on this Supabase project, and a
      // per-card HEAD-count loop would be N+1 — RPC is the cheap path.
      supabase.rpc('get_card_comment_counts', { p_module_id: moduleRef.current }),
    ])
    if (cardsRes.error) { console.warn('hub_cards fetch failed:', cardsRes.error.message); setLoading(false); return }

    const countMap = new Map()
    if (countsRes.error) {
      console.warn('get_card_comment_counts failed:', countsRes.error.message)
    } else if (countsRes.data) {
      for (const r of countsRes.data) countMap.set(r.card_id, Number(r.comment_count) || 0)
    }

    const enriched = (cardsRes.data || []).map(c => ({
      ...c,
      assignees: (c.assignees || []).map(a => a.profile).filter(Boolean),
      comment_count: countMap.get(c.id) || 0,
    }))
    setCards(sortCards(enriched))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!moduleId) { setCards([]); setLoading(false); return }
    setLoading(true)
    fetch()
  }, [moduleId, fetch])

  // Realtime: any change to hub_cards or hub_card_assignees in this module
  // triggers a refetch. (The full refetch is acceptable because card lists
  // are small per module — Basecamp boards rarely exceed ~100 cards.)
  useEffect(() => {
    if (!moduleId) return
    const ch = supabase.channel(`hub-cards-${moduleId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_cards', filter: `module_id=eq.${moduleId}` },
        () => fetch()
      )
      .on('postgres_changes',
        // No filter on hub_card_assignees (no direct module_id column).
        { event: '*', schema: 'public', table: 'hub_card_assignees' },
        (payload) => {
          // Only refetch if the affected card belongs to this module.
          const cardId = payload.new?.card_id || payload.old?.card_id
          if (cardId && cardsRef.current.some(c => c.id === cardId)) fetch()
        }
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [moduleId, fetch])

  const addCard = useCallback(async ({ columnId, title, dueDate = null }) => {
    if (!moduleRef.current || !profile?.id) return null
    const trimmed = (title || '').trim()
    if (!trimmed) return null
    const colCards = cardsRef.current.filter(c => c.column_id === columnId)
    const nextPos = colCards.length
      ? Math.max(...colCards.map(c => c.position ?? 0)) + 1
      : 0
    const { data, error } = await supabase.from('hub_cards').insert({
      module_id: moduleRef.current,
      column_id: columnId,
      title: trimmed,
      due_date: dueDate,
      position: nextPos,
      created_by: profile.id,
    }).select().single()
    if (error) { showToast(error.message || 'Failed to add card', 'error'); return null }
    return data
  }, [profile?.id])

  const updateCard = useCallback(async (cardId, patch) => {
    const { error } = await supabase.from('hub_cards').update(patch).eq('id', cardId)
    if (error) { showToast(error.message || 'Failed to save card', 'error'); return false }
    return true
  }, [])

  const moveCard = useCallback(async (cardId, { columnId, position }) => {
    // Optimistic: shift the card locally so the UI reflects the drop
    // immediately instead of waiting for the realtime roundtrip.
    setCards(prev => {
      const next = prev.map(c =>
        c.id === cardId ? { ...c, column_id: columnId, position } : c
      )
      return sortCards(next)
    })
    const { error } = await supabase.from('hub_cards')
      .update({ column_id: columnId, position })
      .eq('id', cardId)
    if (error) {
      showToast(error.message || 'Failed to move card', 'error')
      fetch() // revert to authoritative state
      return false
    }
    return true
  }, [fetch])

  const deleteCard = useCallback(async (cardId) => {
    const { error } = await supabase.from('hub_cards').delete().eq('id', cardId)
    if (error) { showToast(error.message || 'Failed to delete card', 'error'); return false }
    return true
  }, [])

  const assignCard = useCallback(async (cardId, profileIds) => {
    if (!profileIds?.length) return
    const rows = profileIds.map(pid => ({ card_id: cardId, profile_id: pid }))
    const { error } = await supabase.from('hub_card_assignees').upsert(rows, { onConflict: 'card_id,profile_id' })
    if (error) { showToast(error.message || 'Failed to assign', 'error'); return false }
    return true
  }, [])

  const unassignCard = useCallback(async (cardId, profileId) => {
    const { error } = await supabase.from('hub_card_assignees')
      .delete().eq('card_id', cardId).eq('profile_id', profileId)
    if (error) { showToast(error.message || 'Failed to unassign', 'error'); return false }
    return true
  }, [])

  return {
    cards,
    loading,
    addCard, updateCard, moveCard, deleteCard,
    assignCard, unassignCard,
    refetch: fetch,
  }
}
