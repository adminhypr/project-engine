import { describe, it, expect } from 'vitest'
import {
  PROJECT_EVENT_TYPES,
  formatProjectActivity,
  collapsePromotions,
} from '../projectActivity'

const row = (event_type, payload, extra = {}) => ({
  id: `id-${event_type}-${payload.task_id || payload.bug_id || payload.request_id || 'x'}`,
  event_type,
  payload,
  created_at: '2026-07-14T12:00:00Z',
  ...extra,
})

describe('PROJECT_EVENT_TYPES', () => {
  it('lists all six project event types', () => {
    expect(PROJECT_EVENT_TYPES).toEqual([
      'project_bug_reported',
      'project_request_created',
      'project_feature_created',
      'project_feature_moved',
      'project_comment',
      'project_promotion',
    ])
  })
})

describe('formatProjectActivity', () => {
  it('formats a bug report with severity and snippet preview', () => {
    const n = formatProjectActivity(row('project_bug_reported', {
      actor_name: 'Theresa Frank Fuerte',
      project_id: 'p1',
      project_name: 'PMAPMS',
      bug_id: 'b1',
      bug_title: 'Currency input drifts',
      severity: 'High',
      snippet: 'Typing $75.00 produces $7.01',
    }))
    expect(n.title).toBe('Theresa Frank Fuerte reported a bug in PMAPMS')
    expect(n.body).toBe('[High] Currency input drifts — Typing $75.00 produces $7.01')
    expect(n.link).toBe('/projects/p1')
    expect(n.time).toBe('2026-07-14T12:00:00Z')
    expect(n.kind).toBe('project_bug_reported')
  })

  it('formats a bug report without a snippet', () => {
    const n = formatProjectActivity(row('project_bug_reported', {
      actor_name: 'A', project_id: 'p1', project_name: 'PMAPMS',
      bug_id: 'b1', bug_title: 'No desc', severity: 'Low', snippet: '',
    }))
    expect(n.body).toBe('[Low] No desc')
  })

  it('formats a feature request', () => {
    const n = formatProjectActivity(row('project_request_created', {
      actor_name: 'Michelle Pan', project_id: 'p1', project_name: 'PMAPMS',
      request_id: 'r1', request_title: 'Dark mode', snippet: 'Please add dark mode',
    }))
    expect(n.title).toBe('Michelle Pan filed a feature request in PMAPMS')
    expect(n.body).toBe('Dark mode — Please add dark mode')
  })

  it('formats a feature creation with display id', () => {
    const n = formatProjectActivity(row('project_feature_created', {
      actor_name: 'John Ivan Eslabra', project_id: 'p1', project_name: 'PMAPMS',
      task_id: 't1', task_display_id: 'T-ABC123', task_title: 'Build importer',
      urgency: 'High', snippet: 'CSV importer for rent rolls',
    }))
    expect(n.title).toBe('John Ivan Eslabra added a feature to PMAPMS')
    expect(n.body).toBe('T-ABC123 Build importer — CSV importer for rent rolls')
  })

  it('formats a move using column names when present', () => {
    const n = formatProjectActivity(row('project_feature_moved', {
      actor_name: 'John Ivan Eslabra', project_id: 'p1', project_name: 'PMAPMS',
      task_id: 't1', task_display_id: 'T-ABC123', task_title: 'Build importer',
      from_status: 'Assigned', to_status: 'In Progress',
      from_column: 'Backlog', to_column: 'Doing',
    }))
    expect(n.title).toBe('John Ivan Eslabra moved a feature in PMAPMS')
    expect(n.body).toBe('Build importer: Backlog → Doing')
  })

  it('falls back to statuses when column names are missing, and to "A teammate" when actor is null (dev-api)', () => {
    const n = formatProjectActivity(row('project_feature_moved', {
      actor_name: null, project_id: 'p1', project_name: 'PMAPMS',
      task_id: 't1', task_title: 'Build importer',
      from_status: 'Assigned', to_status: 'Done',
      from_column: null, to_column: null,
    }))
    expect(n.title).toBe('A teammate moved a feature in PMAPMS')
    expect(n.body).toBe('Build importer: Assigned → Done')
  })

  it('formats a comment with snippet preview', () => {
    const n = formatProjectActivity(row('project_comment', {
      actor_name: 'Theresa Frank Fuerte', project_id: 'p1', project_name: 'PMAPMS',
      task_id: 't1', task_title: 'Owner groups', comment_id: 'c1',
      snippet: 'Error 404 when saving.',
    }))
    expect(n.title).toBe('Theresa Frank Fuerte commented in PMAPMS')
    expect(n.body).toBe('Owner groups — Error 404 when saving.')
  })

  it('formats a bug promotion', () => {
    const n = formatProjectActivity(row('project_promotion', {
      actor_name: 'David Laskin', project_id: 'p1', project_name: 'PMAPMS',
      source: 'bug', source_id: 'b1', source_title: 'Currency input drifts',
      severity: 'High', task_id: 't9', task_display_id: 'T-ZZZ999',
      task_title: '🐛 Currency input drifts', snippet: 'Typing $75.00…',
    }))
    expect(n.title).toBe('David Laskin promoted a bug in PMAPMS')
    expect(n.body).toBe('Currency input drifts → T-ZZZ999')
  })

  it('formats a request promotion', () => {
    const n = formatProjectActivity(row('project_promotion', {
      actor_name: 'David Laskin', project_id: 'p1', project_name: 'PMAPMS',
      source: 'request', source_id: 'r1', source_title: 'Dark mode',
      severity: null, task_id: 't9', task_display_id: 'T-YYY888', task_title: 'Dark mode',
    }))
    expect(n.title).toBe('David Laskin promoted a request in PMAPMS')
  })

  it('returns null for unknown event types and missing payloads', () => {
    expect(formatProjectActivity(row('task_assigned', {}))).toBeNull()
    expect(formatProjectActivity({ id: 'x', event_type: 'project_comment', payload: null })).toBeNull()
    expect(formatProjectActivity(null)).toBeNull()
  })

  it('tolerates absent names with generic fallbacks', () => {
    const n = formatProjectActivity(row('project_comment', {
      actor_name: null, project_id: 'p1', project_name: null,
      task_id: 't1', task_title: null, snippet: 'hello',
    }))
    expect(n.title).toBe('A teammate commented in a project')
    expect(n.body).toBe('a task — hello')
  })
})

describe('collapsePromotions', () => {
  const created = row('project_feature_created', {
    actor_name: 'D', project_id: 'p1', project_name: 'PMAPMS',
    task_id: 't9', task_display_id: 'T-Z', task_title: '🐛 Fix', snippet: '',
  })
  const promotion = row('project_promotion', {
    actor_name: 'D', project_id: 'p1', project_name: 'PMAPMS',
    source: 'bug', source_id: 'b1', source_title: 'Fix',
    task_id: 't9', task_display_id: 'T-Z', task_title: '🐛 Fix',
  })
  const unrelated = row('project_feature_created', {
    actor_name: 'D', project_id: 'p1', project_name: 'PMAPMS',
    task_id: 't1', task_display_id: 'T-A', task_title: 'Standalone', snippet: '',
  })

  it('drops feature_created rows shadowed by a promotion of the same task', () => {
    const out = collapsePromotions([promotion, created, unrelated])
    expect(out).toHaveLength(2)
    expect(out.map(r => r.event_type)).toEqual(['project_promotion', 'project_feature_created'])
    expect(out[1].payload.task_id).toBe('t1')
  })

  it('keeps everything when no promotion matches', () => {
    expect(collapsePromotions([created, unrelated])).toHaveLength(2)
  })

  it('handles empty and missing input', () => {
    expect(collapsePromotions([])).toEqual([])
    expect(collapsePromotions(null)).toEqual([])
  })
})
