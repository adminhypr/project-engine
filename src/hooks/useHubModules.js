import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const KIND_ORDER = ['message-board', 'attendance-room', 'campfire', 'docs-files', 'to-dos']
const KIND_DEFAULT_TITLE = {
  'message-board':   'Message Board',
  'attendance-room': "Who's Here",
  'campfire':        'Campfire',
  'docs-files':      'Docs & Files',
  'to-dos':          'To-Dos',
}

const NUM_COLUMNS = 3

// Group an array of modules into per-column ordered lists [[…col0…], [col1], [col2]]
// based on each module's column_index/position.
export function groupModulesByColumn(modules) {
  const cols = Array.from({ length: NUM_COLUMNS }, () => [])
  for (const m of modules) {
    const col = Math.min(Math.max(m.column_index ?? 0, 0), NUM_COLUMNS - 1)
    cols[col].push(m)
  }
  for (const c of cols) c.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  return cols
}

// All hub modules for a hub, with realtime updates and CRUD.
// RLS: every hub member can SELECT; only owner/admin can write.
export function useHubModules(hubId) {
  const { profile } = useAuth()
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchModules = useCallback(async () => {
    if (!hubRef.current) return
    const { data, error } = await supabase
      .from('hub_modules')
      .select('*')
      .eq('hub_id', hubRef.current)
      .order('column_index')
      .order('position')
    if (error) {
      console.warn('hub_modules fetch failed:', error.message)
      setLoading(false)
      return
    }
    setModules(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!hubId) { setModules([]); setLoading(false); return }
    setLoading(true)
    fetchModules()
  }, [hubId, fetchModules])

  // Realtime: any module change in this hub triggers a refetch.
  useEffect(() => {
    if (!hubId) return
    const channel = supabase
      .channel(`hub-modules-${hubId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_modules', filter: `hub_id=eq.${hubId}` },
        () => fetchModules()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId, fetchModules])

  const addModule = useCallback(async (kind, title, columnIndex = 0) => {
    if (!hubRef.current || !profile?.id) return null
    if (!KIND_ORDER.includes(kind)) {
      showToast('Unknown module type', 'error')
      return null
    }
    // Append to bottom of the chosen column.
    const colModules = modules.filter(m => (m.column_index ?? 0) === columnIndex)
    const nextPos = colModules.length
      ? Math.max(...colModules.map(m => m.position ?? 0)) + 1
      : 0
    const { data, error } = await supabase
      .from('hub_modules')
      .insert({
        hub_id: hubRef.current,
        kind,
        title: (title || '').trim() || KIND_DEFAULT_TITLE[kind] || 'Module',
        column_index: columnIndex,
        position: nextPos,
        created_by: profile.id,
      })
      .select()
      .single()
    if (error) { showToast(error.message || 'Failed to add module', 'error'); return null }
    return data
  }, [profile?.id, modules])

  const renameModule = useCallback(async (moduleId, title) => {
    const trimmed = (title || '').trim()
    if (!trimmed) return false
    const { error } = await supabase
      .from('hub_modules')
      .update({ title: trimmed })
      .eq('id', moduleId)
    if (error) { showToast(error.message || 'Failed to rename module', 'error'); return false }
    return true
  }, [])

  const deleteModule = useCallback(async (moduleId) => {
    const { error } = await supabase
      .from('hub_modules')
      .delete()
      .eq('id', moduleId)
    if (error) { showToast(error.message || 'Failed to delete module', 'error'); return false }
    return true
  }, [])

  // Persist a new layout: array of arrays per column. Each element is a
  // module object whose id determines the row to update. Optimistic update +
  // single batched RPC-less write (server-side enforcement via RLS).
  const saveLayout = useCallback(async (columns) => {
    const updates = []
    columns.forEach((col, ci) => {
      col.forEach((m, pi) => {
        if (m.column_index !== ci || m.position !== pi) {
          updates.push({ id: m.id, column_index: ci, position: pi })
        }
      })
    })
    if (updates.length === 0) return
    // Optimistic: flatten back into a fresh modules array
    const flat = columns.flatMap((col, ci) => col.map((m, pi) => ({ ...m, column_index: ci, position: pi })))
    setModules(flat)

    // Run updates in parallel. Postgres-level concurrent UPDATEs of distinct
    // rows are fine; on any failure we refetch to recover authoritative state.
    const results = await Promise.all(
      updates.map(u =>
        supabase
          .from('hub_modules')
          .update({ column_index: u.column_index, position: u.position })
          .eq('id', u.id)
      )
    )
    if (results.some(r => r.error)) {
      showToast('Failed to save layout', 'error')
      fetchModules()
    }
  }, [fetchModules])

  const columns = useMemo(() => groupModulesByColumn(modules), [modules])

  return {
    modules,
    columns,
    loading,
    addModule,
    renameModule,
    deleteModule,
    saveLayout,
    refetch: fetchModules,
  }
}

export const HUB_MODULE_KINDS = KIND_ORDER
export const HUB_MODULE_DEFAULT_TITLE = KIND_DEFAULT_TITLE
