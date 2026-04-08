import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export const DEFAULT_LEFT_ORDER = ['message-board', 'check-ins', 'schedule', 'docs-files']
export const DEFAULT_SIDEBAR_ORDER = ['campfire', 'whos-here', 'activity']

const DEFAULTS = { left: DEFAULT_LEFT_ORDER, sidebar: DEFAULT_SIDEBAR_ORDER }

// Preserve saved order for known IDs, append any new ones from defaults, drop removed ones
function mergeWithDefault(saved, defaults) {
  if (!saved || !Array.isArray(saved)) return defaults
  const valid = saved.filter(id => defaults.includes(id))
  const added = defaults.filter(id => !valid.includes(id))
  return [...valid, ...added]
}

export function useHubModuleOrder(hubId) {
  const { profile } = useAuth()
  const [moduleOrder, setModuleOrder] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  const fetchOrder = useCallback(async () => {
    if (!hubId || !profile?.id) return
    const { data, error } = await supabase
      .from('hub_members')
      .select('module_order')
      .eq('hub_id', hubId)
      .eq('profile_id', profile.id)
      .single()

    if (!mounted.current) return
    if (error || !data) {
      setModuleOrder(DEFAULTS)
    } else {
      const saved = data.module_order
      setModuleOrder({
        left: mergeWithDefault(saved?.left, DEFAULT_LEFT_ORDER),
        sidebar: mergeWithDefault(saved?.sidebar, DEFAULT_SIDEBAR_ORDER),
      })
    }
    setLoading(false)
  }, [hubId, profile?.id])

  useEffect(() => {
    mounted.current = true
    setLoading(true)
    fetchOrder()
    return () => { mounted.current = false }
  }, [fetchOrder])

  const saveModuleOrder = useCallback(async (newOrder) => {
    if (!hubId || !profile?.id) return
    setModuleOrder(newOrder) // optimistic
    const { error } = await supabase
      .from('hub_members')
      .update({ module_order: newOrder })
      .eq('hub_id', hubId)
      .eq('profile_id', profile.id)
    if (error) {
      showToast('Failed to save layout', 'error')
      fetchOrder() // rollback
    }
  }, [hubId, profile?.id, fetchOrder])

  return { moduleOrder, saveModuleOrder, loading }
}
