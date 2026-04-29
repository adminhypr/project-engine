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
//
// Layout is layered: hub_modules carries the canonical "house" layout
// (admin-curated). Per-user overrides live in hub_module_user_layout —
// when present they win for column_index + position; otherwise canonical
// applies. Drag-reorder writes only to overrides via saveLayout.
// Admin add/rename/delete still writes to hub_modules (canonical).
export function useHubModules(hubId) {
  const { profile } = useAuth()
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchModules = useCallback(async () => {
    if (!hubRef.current || !profile?.id) return
    const [canonRes, overrideRes] = await Promise.all([
      supabase
        .from('hub_modules')
        .select('*')
        .eq('hub_id', hubRef.current),
      supabase
        .from('hub_module_user_layout')
        .select('module_id, column_index, position')
        .eq('user_id', profile.id),
    ])
    if (canonRes.error) {
      console.warn('hub_modules fetch failed:', canonRes.error.message)
      setLoading(false)
      return
    }
    if (overrideRes.error) {
      console.warn('hub_module_user_layout fetch failed:', overrideRes.error.message)
    }

    const overrideMap = new Map((overrideRes.data || []).map(o => [o.module_id, o]))
    const merged = (canonRes.data || []).map(m => {
      const o = overrideMap.get(m.id)
      return o ? { ...m, column_index: o.column_index, position: o.position, _override: true } : m
    })
    // id break-tie keeps order stable when canonical + override positions collide
    merged.sort((a, b) =>
      ((a.column_index ?? 0) - (b.column_index ?? 0)) ||
      ((a.position ?? 0) - (b.position ?? 0)) ||
      a.id.localeCompare(b.id)
    )
    setModules(merged)
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    if (!hubId || !profile?.id) { setModules([]); setLoading(false); return }
    setLoading(true)
    fetchModules()
  }, [hubId, profile?.id, fetchModules])

  // Realtime: refetch on canonical changes (hub-scoped) and on override
  // changes for this user (across tabs / devices).
  useEffect(() => {
    if (!hubId || !profile?.id) return
    const channel = supabase
      .channel(`hub-modules-${hubId}-${profile.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_modules', filter: `hub_id=eq.${hubId}` },
        () => fetchModules()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_module_user_layout', filter: `user_id=eq.${profile.id}` },
        () => fetchModules()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId, profile?.id, fetchModules])

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

  // Persist a new layout: array of arrays per column. Writes only to the
  // caller's hub_module_user_layout rows — canonical hub_modules is left
  // alone. Upserts every visible module so once a user has dragged once,
  // their override row set fully captures their view; new modules added
  // by an admin afterwards have no override and fall back to canonical.
  const saveLayout = useCallback(async (columns) => {
    if (!profile?.id) return
    const rows = []
    columns.forEach((col, ci) => {
      col.forEach((m, pi) => {
        rows.push({
          user_id: profile.id,
          module_id: m.id,
          column_index: ci,
          position: pi,
        })
      })
    })
    if (rows.length === 0) return

    // Optimistic flatten — every shown module is now considered overridden.
    const flat = columns.flatMap((col, ci) =>
      col.map((m, pi) => ({ ...m, column_index: ci, position: pi, _override: true }))
    )
    setModules(flat)

    const { error } = await supabase
      .from('hub_module_user_layout')
      .upsert(rows, { onConflict: 'user_id,module_id' })
    if (error) {
      showToast('Failed to save layout', 'error')
      fetchModules()
    }
  }, [profile?.id, fetchModules])

  // Drop all of this user's override rows for modules in this hub. After
  // the realtime tick (or the inline refetch fallback) the view falls
  // back to the canonical hub_modules layout.
  const resetLayout = useCallback(async () => {
    if (!profile?.id || !hubRef.current) return false
    const moduleIds = modules.map(m => m.id)
    if (moduleIds.length === 0) return true
    const { error } = await supabase
      .from('hub_module_user_layout')
      .delete()
      .eq('user_id', profile.id)
      .in('module_id', moduleIds)
    if (error) {
      showToast(error.message || 'Failed to reset layout', 'error')
      return false
    }
    fetchModules()
    return true
  }, [profile?.id, modules, fetchModules])

  const columns = useMemo(() => groupModulesByColumn(modules), [modules])
  const hasCustomLayout = useMemo(() => modules.some(m => m._override), [modules])

  return {
    modules,
    columns,
    loading,
    hasCustomLayout,
    addModule,
    renameModule,
    deleteModule,
    saveLayout,
    resetLayout,
    refetch: fetchModules,
  }
}

export const HUB_MODULE_KINDS = KIND_ORDER
export const HUB_MODULE_DEFAULT_TITLE = KIND_DEFAULT_TITLE
