// Dev Projects activity notifications — pure formatting/collapse logic for
// notification_outbox rows with project_* event types (migration 119).
// Design: docs/plans/2026-07-14-project-activity-notifications-design.md

export const PROJECT_EVENT_TYPES = [
  'project_bug_reported',
  'project_request_created',
  'project_feature_created',
  'project_feature_moved',
  'project_comment',
  'project_promotion',
]

const FALLBACK_ACTOR = 'A teammate'
const FALLBACK_PROJECT = 'a project'
const FALLBACK_TASK = 'a task'

// Append " — snippet" only when the snippet has content.
function withSnippet(base, snippet) {
  const s = (snippet || '').trim()
  return s ? `${base} — ${s}` : base
}

// One outbox row -> { id, kind, title, body, link, time } for the bell,
// or null when the row isn't a (well-formed) project event.
export function formatProjectActivity(row) {
  if (!row || !row.payload || !PROJECT_EVENT_TYPES.includes(row.event_type)) return null
  const p = row.payload
  const actor = p.actor_name || FALLBACK_ACTOR
  const project = p.project_name || FALLBACK_PROJECT
  const task = p.task_title || FALLBACK_TASK

  let title
  let body
  switch (row.event_type) {
    case 'project_bug_reported':
      title = `${actor} reported a bug in ${project}`
      body = withSnippet(`[${p.severity || '—'}] ${p.bug_title || 'a bug'}`, p.snippet)
      break
    case 'project_request_created':
      title = `${actor} filed a feature request in ${project}`
      body = withSnippet(p.request_title || 'a request', p.snippet)
      break
    case 'project_feature_created':
      title = `${actor} added a feature to ${project}`
      body = withSnippet([p.task_display_id, task].filter(Boolean).join(' '), p.snippet)
      break
    case 'project_feature_moved': {
      const from = p.from_column || p.from_status || '—'
      const to = p.to_column || p.to_status || '—'
      title = `${actor} moved a feature in ${project}`
      body = `${task}: ${from} → ${to}`
      break
    }
    case 'project_comment':
      title = `${actor} commented in ${project}`
      body = withSnippet(task, p.snippet)
      break
    case 'project_promotion':
      title = `${actor} promoted a ${p.source === 'bug' ? 'bug' : 'request'} in ${project}`
      body = `${p.source_title || 'an item'} → ${p.task_display_id || task}`
      break
    default:
      return null
  }

  return {
    id: row.id,
    kind: row.event_type,
    title,
    body,
    link: p.project_id ? `/projects/${p.project_id}` : '/projects',
    time: row.created_at,
  }
}

// Promote flows fire BOTH project_feature_created (task insert) and
// project_promotion (bug/request update). The DB keeps both (truthful);
// presentation shows only the richer promotion entry for the same task.
export function collapsePromotions(rows) {
  if (!Array.isArray(rows)) return []
  const promotedTaskIds = new Set(
    rows
      .filter(r => r?.event_type === 'project_promotion' && r.payload?.task_id)
      .map(r => r.payload.task_id),
  )
  if (promotedTaskIds.size === 0) return rows
  return rows.filter(r =>
    !(r?.event_type === 'project_feature_created' && promotedTaskIds.has(r.payload?.task_id)),
  )
}
