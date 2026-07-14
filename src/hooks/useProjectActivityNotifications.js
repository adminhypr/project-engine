import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { PROJECT_EVENT_TYPES, collapsePromotions } from '../lib/projectActivity'

// Dev Projects activity for the bell (migration 119). Reads the viewer's
// unseen project_* rows straight from notification_outbox — 062 already
// ships the notif_outbox_select_self policy and realtime publication.
// Seen-state is the delivered_to_bell_at stamp (durable, cross-device),
// NOT the bell's localStorage dismissals: a guard trigger limits self-
// updates to that single column.
export function useProjectActivityNotifications() {
  const { profile } = useAuth()
  const [rows, setRows] = useState([])

  const fetchRows = useCallback(async () => {
    if (!profile?.id) return
    const { data } = await supabase
      .from('notification_outbox')
      .select('id, event_type, payload, created_at')
      .eq('recipient_id', profile.id)
      .is('delivered_to_bell_at', null)
      .in('event_type', PROJECT_EVENT_TYPES)
      .order('created_at', { ascending: false })
      .limit(30)
    // A promote emits feature_created + promotion for the same task —
    // show only the promotion (design decision 3).
    setRows(collapsePromotions(data || []))
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    fetchRows()

    const channel = supabase
      .channel(`project-activity-notif:${profile.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification_outbox', filter: `recipient_id=eq.${profile.id}` },
        (payload) => {
          // The outbox carries every notification type; only refetch for ours.
          if (PROJECT_EVENT_TYPES.includes(payload.new?.event_type)) fetchRows()
        })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profile?.id, fetchRows])

  const markSeen = useCallback(async (outboxId) => {
    setRows(prev => prev.filter(r => r.id !== outboxId))
    await supabase
      .from('notification_outbox')
      .update({ delivered_to_bell_at: new Date().toISOString() })
      .eq('id', outboxId)
  }, [])

  const markAllSeen = useCallback(async () => {
    const ids = rows.map(r => r.id)
    if (ids.length === 0) return
    setRows([])
    await supabase
      .from('notification_outbox')
      .update({ delivered_to_bell_at: new Date().toISOString() })
      .in('id', ids)
  }, [rows])

  return { activities: rows, markSeen, markAllSeen, refetch: fetchRows }
}
