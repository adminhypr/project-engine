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

function sortModules(arr) {
  arr.sort((a, b) =>
    ((a.column_index ?? 0) - (b.column_index ?? 0)) ||
    ((a.position ?? 0) - (b.position ?? 0)) ||
    a.id.localeCompare(b.id)
  )
  return arr
}

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
  // Stable read-handle for callbacks that don't want a fresh identity on
  // every realtime tick.
  const modulesRef = useRef(modules)
  modulesRef.current = modules

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
    setModules(sortModules(merged))
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    if (!hubId || !profile?.id) { setModules([]); setLoading(false); return }
    setLoading(true)
    fetchModules()
  }, [hubId, profile?.id, fetchModules])

  // Realtime:
  //   • Canonical changes (hub_modules) — full refetch (insert/delete/rename
  //     can affect modules array shape).
  //   • Override changes (hub_module_user_layout) — apply in-place. INSERT
  //     and UPDATE just shift one module; DELETE (reset, FK cascade) needs
  //     a full refetch to fall back to canonical correctly.
  //   This avoids a fresh array identity on every echo of our own upserts,
  //   which kept untouched module subscriptions from being torn down.
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
        (payload) => {
          if (payload.eventType === 'DELETE') {
            fetchModules()
            return
          }
          const row = payload.new
          if (!row) return
          setModules(prev => {
            const cur = prev.find(m => m.id === row.module_id)
            // No-op when our optimistic state already matches (own-tab echo).
            if (cur
              && cur._override
              && cur.column_index === row.column_index
              && cur.position === row.position
            ) {
              return prev
            }
            const next = prev.map(m => m.id === row.module_id
              ? { ...m, column_index: row.column_index, position: row.position, _override: true }
              : m
            )
            return sortModules(next)
          })
        }
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
    // Append to bottom of the chosen column. Read modules from ref so this
    // callback's identity doesn't churn on every realtime tick.
    const colModules = modulesRef.current.filter(m => (m.column_index ?? 0) === columnIndex)
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
  }, [profile?.id])

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

  // Persist a layout change. `columns` is the user's local view (3 arrays).
  // We diff against current state and upsert ONLY rows whose effective
  // (column_index, position) actually moved — drag-reorder previously
  // wrote every visible row on every drop, which echoed back as N realtime
  // events per drag.
  const saveLayout = useCallback(async (columns) => {
    if (!profile?.id) return
    const cur = new Map(modulesRef.current.map(m => [m.id, m]))
    const rows = []
    columns.forEach((col, ci) => {
      col.forEach((m, pi) => {
        const prev = cur.get(m.id)
        if (!prev || prev.column_index !== ci || prev.position !== pi || !prev._override) {
          rows.push({
            user_id: profile.id,
            module_id: m.id,
            column_index: ci,
            position: pi,
          })
        }
      })
    })

    // Optimistic flatten — every shown module is now considered overridden,
    // even those whose position hasn't changed (their override row is still
    // there or matches canonical). This keeps the UI consistent without
    // needing a refetch.
    const flat = columns.flatMap((col, ci) =>
      col.map((m, pi) => ({ ...m, column_index: ci, position: pi, _override: true }))
    )
    setModules(flat)

    if (rows.length === 0) return

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
    const moduleIds = modulesRef.current.map(m => m.id)
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
  }, [profile?.id, fetchModules])

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
