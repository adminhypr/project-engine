import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubCardSteps(cardId) {
  const { profile } = useAuth()
  const [steps, setSteps] = useState([])
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const [loading, setLoading] = useState(true)
  const cardRef = useRef(cardId)
  cardRef.current = cardId

  const fetch = useCallback(async () => {
    if (!cardRef.current) return
    const { data, error } = await supabase
      .from('hub_card_steps')
      .select('*')
      .eq('card_id', cardRef.current)
      .order('position')
    if (error) { console.warn('hub_card_steps fetch failed:', error.message); setLoading(false); return }
    setSteps(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!cardId) { setSteps([]); setLoading(false); return }
    setLoading(true)
    fetch()
  }, [cardId, fetch])

  useEffect(() => {
    if (!cardId) return
    const ch = supabase.channel(`hub-card-steps-${cardId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_card_steps', filter: `card_id=eq.${cardId}` },
        () => fetch()
      ).subscribe()
    return () => supabase.removeChannel(ch)
  }, [cardId, fetch])

  const addStep = useCallback(async (label) => {
    const trimmed = (label || '').trim()
    if (!trimmed || !cardRef.current) return null
    // Read steps from ref so this callback's identity doesn't churn on
    // every realtime tick (each fetch produces a new array reference).
    const cur = stepsRef.current
    const nextPos = cur.length ? Math.max(...cur.map(s => s.position ?? 0)) + 1 : 0
    const { data, error } = await supabase.from('hub_card_steps').insert({
      card_id: cardRef.current, label: trimmed, position: nextPos,
    }).select().single()
    if (error) { showToast(error.message || 'Failed to add step', 'error'); return null }
    return data
  }, [])

  const toggleStep = useCallback(async (stepId, completed) => {
    const patch = completed
      ? { completed_at: new Date().toISOString(), completed_by: profile?.id ?? null }
      : { completed_at: null, completed_by: null }
    const { error } = await supabase.from('hub_card_steps').update(patch).eq('id', stepId)
    if (error) { showToast(error.message || 'Failed to update step', 'error'); return false }
    return true
  }, [profile?.id])

  const deleteStep = useCallback(async (stepId) => {
    const { error } = await supabase.from('hub_card_steps').delete().eq('id', stepId)
    if (error) { showToast(error.message || 'Failed to delete step', 'error'); return false }
    return true
  }, [])

  return { steps, loading, addStep, toggleStep, deleteStep, refetch: fetch }
}
