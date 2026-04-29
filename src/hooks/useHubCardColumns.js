import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const DEFAULT_COLORS = ['#64748b', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899']

export function useHubCardColumns(moduleId) {
  const { profile } = useAuth()
  const [columns, setColumns] = useState([])
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const [loading, setLoading] = useState(true)
  const moduleRef = useRef(moduleId)
  moduleRef.current = moduleId

  const fetch = useCallback(async () => {
    if (!moduleRef.current) return
    const { data, error } = await supabase
      .from('hub_card_columns')
      .select('*')
      .eq('module_id', moduleRef.current)
      .order('position')
    if (error) { console.warn('hub_card_columns fetch failed:', error.message); setLoading(false); return }
    setColumns(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!moduleId) { setColumns([]); setLoading(false); return }
    setLoading(true)
    fetch()
  }, [moduleId, fetch])

  useEffect(() => {
    if (!moduleId) return
    const ch = supabase.channel(`hub-card-cols-${moduleId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_card_columns', filter: `module_id=eq.${moduleId}` },
        () => fetch()
      ).subscribe()
    return () => supabase.removeChannel(ch)
  }, [moduleId, fetch])

  const addColumn = useCallback(async (name) => {
    const trimmed = (name || '').trim()
    if (!trimmed || !moduleRef.current || !profile?.id) return null
    // Read columns from ref so this callback's identity doesn't churn on
    // every realtime tick (each fetch produces a new array reference).
    const cur = columnsRef.current
    const nextPos = cur.length
      ? Math.max(...cur.map(c => c.position ?? 0)) + 1
      : 0
    const color = DEFAULT_COLORS[cur.length % DEFAULT_COLORS.length]
    const { data, error } = await supabase
      .from('hub_card_columns')
      .insert({ module_id: moduleRef.current, name: trimmed, color, position: nextPos })
      .select().single()
    if (error) { showToast(error.message || 'Failed to add column', 'error'); return null }
    return data
  }, [profile?.id])

  const renameColumn = useCallback(async (columnId, name) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return false
    const { error } = await supabase.from('hub_card_columns').update({ name: trimmed }).eq('id', columnId)
    if (error) { showToast(error.message || 'Failed to rename column', 'error'); return false }
    return true
  }, [])

  const setColumnColor = useCallback(async (columnId, color) => {
    const { error } = await supabase.from('hub_card_columns').update({ color }).eq('id', columnId)
    if (error) { showToast(error.message || 'Failed to update color', 'error'); return false }
    return true
  }, [])

  const deleteColumn = useCallback(async (columnId) => {
    // FK on hub_cards.column_id is ON DELETE RESTRICT — UI must move/delete
    // cards first. This call surfaces the FK error if cards exist.
    const { error } = await supabase.from('hub_card_columns').delete().eq('id', columnId)
    if (error) { showToast(error.message || 'Move or delete the cards in this column first.', 'error'); return false }
    return true
  }, [])

  return { columns, loading, addColumn, renameColumn, setColumnColor, deleteColumn, refetch: fetch }
}
