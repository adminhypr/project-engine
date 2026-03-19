import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const EVENT_LABELS = {
  task_created:      'Task Created',
  status_changed:    'Status Changed',
  urgency_changed:   'Urgency Changed',
  due_date_changed:  'Due Date Changed',
  notes_updated:     'Notes Updated',
  reassigned:        'Reassigned',
  accepted:          'Accepted',
  declined:          'Declined',
  assigner_override: 'Assigner Override',
}

export function formatEventType(type) {
  return EVENT_LABELS[type] || type
}

export function useAuditLog(taskId) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!taskId) { setEvents([]); setLoading(false); return }

    async function fetch() {
      setLoading(true)
      const { data, error } = await supabase
        .from('task_audit_log')
        .select('*, performer:profiles!task_audit_log_performed_by_fkey(full_name, avatar_url)')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true })

      if (!error && data) setEvents(data)
      setLoading(false)
    }

    fetch()

    // Real-time subscription
    const channel = supabase
      .channel(`audit-${taskId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'task_audit_log',
        filter: `task_id=eq.${taskId}`
      }, (payload) => {
        setEvents(prev => [...prev, payload.new])
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [taskId])

  return { events, loading }
}

export function useAuditLogReport({ dateFrom, dateTo, isAdmin, teamId }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data, error } = await supabase
        .from('task_audit_log')
        .select(`
          *,
          performer:profiles!task_audit_log_performed_by_fkey(full_name),
          task:tasks(task_id, title, team_id, team:teams(name))
        `)
        .gte('created_at', dateFrom)
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!error && data) setEvents(data)
      setLoading(false)
    }

    fetch()
  }, [dateFrom, dateTo])

  return { events, loading }
}
