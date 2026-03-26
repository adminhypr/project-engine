import { describe, it, expect } from 'vitest'
import { applyFilters } from '../filters'

/**
 * Comprehensive tests for multi-assignee feature and due date validation.
 *
 * Tests cover:
 * 1. myTasks filtering (primary + secondary assignees)
 * 2. Task enrichment (assignees array from task_assignees)
 * 3. Search/filter across multiple assignees
 * 4. assignTask payload handling (assigneeIds vs legacy assigneeId)
 * 5. Due date validation logic
 * 6. Notification inclusion for secondary assignees
 * 7. Report counting for secondary assignees
 * 8. teamTasks filtering unaffected by multi-assignee
 */

// ─── Helpers ────────────────────────────────────────────

function makeTask(overrides = {}) {
  return {
    id: 'task-1',
    task_id: 'T-ABC123',
    title: 'Test task',
    status: 'In Progress',
    urgency: 'Med',
    priority: 'green',
    team_id: 'team-a',
    assigned_to: 'user-1',
    assigned_by: 'user-2',
    assignee: { full_name: 'Alice' },
    assigner: { full_name: 'Bob' },
    who_due_to: null,
    task_assignees: [],
    assignees: [],
    ...overrides,
  }
}

// Simulate myTasks filter from useTasks.js (lines 97-100)
function getMyTasks(tasks, profileId) {
  return tasks.filter(t =>
    t.assigned_to === profileId ||
    t.task_assignees?.some(ta => ta.profile_id === profileId)
  )
}

// Simulate assignees enrichment from useTasks.js (lines 62-67)
function enrichAssignees(taskAssignees) {
  return (taskAssignees || []).map(ta => ({
    id: ta.profile?.id || ta.profile_id,
    full_name: ta.profile?.full_name,
    avatar_url: ta.profile?.avatar_url,
    is_primary: ta.is_primary,
  }))
}

// Simulate assignTask ID resolution from useTasks.js (lines 120-121)
function resolveAssigneeIds(payload) {
  const { assigneeIds, assigneeId } = payload
  return assigneeIds?.length ? assigneeIds : [assigneeId]
}

// Simulate junction table rows creation from useTasks.js (lines 153-157)
function buildJunctionRows(taskId, ids) {
  return ids.map((id, i) => ({
    task_id: taskId,
    profile_id: id,
    is_primary: i === 0,
  }))
}

// Simulate notification task filter from NotificationBell.jsx (line 148)
function getNotificationTasks(tasks, profileId) {
  return tasks.filter(t =>
    t.assigned_to === profileId ||
    t.assigned_by === profileId ||
    t.task_assignees?.some(ta => ta.profile_id === profileId)
  )
}

// Simulate report task filter from WorkloadReport/ProductivityReport
function getReportTasks(tasks, profileId) {
  return tasks.filter(t =>
    t.assigned_to === profileId ||
    t.task_assignees?.some(ta => ta.profile_id === profileId)
  )
}

// Due date validation (from AssignTaskPage + TaskDetailPanel)
function isValidDueDate(dueDate) {
  if (!dueDate) return true // optional
  return new Date(dueDate) >= new Date()
}


// ─── Tests ──────────────────────────────────────────────

describe('Multi-assignee: myTasks filtering', () => {
  const tasks = [
    makeTask({ id: 't1', assigned_to: 'alice', task_assignees: [{ profile_id: 'alice', is_primary: true }] }),
    makeTask({ id: 't2', assigned_to: 'bob', task_assignees: [
      { profile_id: 'bob', is_primary: true },
      { profile_id: 'alice', is_primary: false },
    ]}),
    makeTask({ id: 't3', assigned_to: 'carol', task_assignees: [{ profile_id: 'carol', is_primary: true }] }),
    makeTask({ id: 't4', assigned_to: 'dave', task_assignees: [
      { profile_id: 'dave', is_primary: true },
      { profile_id: 'alice', is_primary: false },
      { profile_id: 'bob', is_primary: false },
    ]}),
  ]

  it('includes tasks where user is primary assignee', () => {
    const mine = getMyTasks(tasks, 'alice')
    expect(mine.some(t => t.id === 't1')).toBe(true)
  })

  it('includes tasks where user is secondary assignee', () => {
    const mine = getMyTasks(tasks, 'alice')
    expect(mine.some(t => t.id === 't2')).toBe(true)
    expect(mine.some(t => t.id === 't4')).toBe(true)
  })

  it('excludes tasks where user is not assigned at all', () => {
    const mine = getMyTasks(tasks, 'alice')
    expect(mine.some(t => t.id === 't3')).toBe(false)
  })

  it('returns correct count for user with mixed assignments', () => {
    expect(getMyTasks(tasks, 'alice')).toHaveLength(3) // t1 (primary), t2 (secondary), t4 (secondary)
    expect(getMyTasks(tasks, 'bob')).toHaveLength(2)   // t2 (primary), t4 (secondary)
    expect(getMyTasks(tasks, 'carol')).toHaveLength(1)  // t3 (primary only)
    expect(getMyTasks(tasks, 'dave')).toHaveLength(1)   // t4 (primary only)
  })

  it('handles tasks with no task_assignees (legacy)', () => {
    const legacyTasks = [
      makeTask({ id: 't5', assigned_to: 'alice', task_assignees: undefined }),
      makeTask({ id: 't6', assigned_to: 'bob', task_assignees: null }),
    ]
    expect(getMyTasks(legacyTasks, 'alice')).toHaveLength(1)
    expect(getMyTasks(legacyTasks, 'bob')).toHaveLength(1)
  })

  it('handles empty task_assignees array', () => {
    const emptyArr = [makeTask({ id: 't7', assigned_to: 'alice', task_assignees: [] })]
    expect(getMyTasks(emptyArr, 'alice')).toHaveLength(1) // still matches via assigned_to
    expect(getMyTasks(emptyArr, 'bob')).toHaveLength(0)
  })

  it('does not double-count when user is both assigned_to and in task_assignees', () => {
    const duped = [makeTask({
      id: 't8', assigned_to: 'alice',
      task_assignees: [{ profile_id: 'alice', is_primary: true }],
    })]
    expect(getMyTasks(duped, 'alice')).toHaveLength(1)
  })
})

describe('Multi-assignee: enrichment', () => {
  it('builds assignees array from task_assignees with profile data', () => {
    const raw = [
      { profile_id: 'u1', is_primary: true, profile: { id: 'u1', full_name: 'Alice', avatar_url: 'a.jpg' } },
      { profile_id: 'u2', is_primary: false, profile: { id: 'u2', full_name: 'Bob', avatar_url: null } },
    ]
    const result = enrichAssignees(raw)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 'u1', full_name: 'Alice', avatar_url: 'a.jpg', is_primary: true })
    expect(result[1]).toEqual({ id: 'u2', full_name: 'Bob', avatar_url: null, is_primary: false })
  })

  it('falls back to profile_id when profile object is missing', () => {
    const raw = [{ profile_id: 'u1', is_primary: true, profile: null }]
    const result = enrichAssignees(raw)
    expect(result[0].id).toBe('u1')
    expect(result[0].full_name).toBeUndefined()
  })

  it('returns empty array for null/undefined task_assignees', () => {
    expect(enrichAssignees(null)).toEqual([])
    expect(enrichAssignees(undefined)).toEqual([])
  })

  it('returns empty array for empty task_assignees', () => {
    expect(enrichAssignees([])).toEqual([])
  })
})

describe('Multi-assignee: assignTask payload handling', () => {
  it('uses assigneeIds when provided', () => {
    const ids = resolveAssigneeIds({ assigneeIds: ['u1', 'u2', 'u3'] })
    expect(ids).toEqual(['u1', 'u2', 'u3'])
  })

  it('falls back to assigneeId (legacy) when assigneeIds is empty', () => {
    const ids = resolveAssigneeIds({ assigneeIds: [], assigneeId: 'u1' })
    expect(ids).toEqual(['u1'])
  })

  it('falls back to assigneeId when assigneeIds is undefined', () => {
    const ids = resolveAssigneeIds({ assigneeId: 'u1' })
    expect(ids).toEqual(['u1'])
  })

  it('first ID is the primary assignee', () => {
    const ids = resolveAssigneeIds({ assigneeIds: ['u2', 'u1', 'u3'] })
    expect(ids[0]).toBe('u2')
  })
})

describe('Multi-assignee: junction table rows', () => {
  it('marks first assignee as primary', () => {
    const rows = buildJunctionRows('task-1', ['u1', 'u2', 'u3'])
    expect(rows[0]).toEqual({ task_id: 'task-1', profile_id: 'u1', is_primary: true })
    expect(rows[1]).toEqual({ task_id: 'task-1', profile_id: 'u2', is_primary: false })
    expect(rows[2]).toEqual({ task_id: 'task-1', profile_id: 'u3', is_primary: false })
  })

  it('single assignee is marked primary', () => {
    const rows = buildJunctionRows('task-1', ['u1'])
    expect(rows).toHaveLength(1)
    expect(rows[0].is_primary).toBe(true)
  })

  it('all rows reference the same task_id', () => {
    const rows = buildJunctionRows('task-99', ['u1', 'u2'])
    expect(rows.every(r => r.task_id === 'task-99')).toBe(true)
  })
})

describe('Multi-assignee: search and filters', () => {
  const tasks = [
    makeTask({
      id: 't1',
      title: 'API integration',
      assignee: { full_name: 'Alice' },
      assigner: { full_name: 'Bob' },
      assignees: [
        { id: 'u1', full_name: 'Alice', is_primary: true },
        { id: 'u2', full_name: 'Charlie', is_primary: false },
        { id: 'u3', full_name: 'Diana', is_primary: false },
      ],
    }),
    makeTask({
      id: 't2',
      title: 'Fix bug',
      assignee: { full_name: 'Eve' },
      assigner: { full_name: 'Frank' },
      assignees: [{ id: 'u4', full_name: 'Eve', is_primary: true }],
    }),
  ]

  it('finds task by searching secondary assignee name', () => {
    const result = applyFilters(tasks, { search: 'charlie' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })

  it('finds task by searching another secondary assignee', () => {
    const result = applyFilters(tasks, { search: 'diana' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })

  it('finds task by searching primary assignee (via assignees array)', () => {
    const result = applyFilters(tasks, { search: 'alice' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })

  it('finds task by primary assignee (via assignee field — backward compat)', () => {
    const result = applyFilters(tasks, { search: 'eve' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t2')
  })

  it('search is case insensitive for assignee names', () => {
    expect(applyFilters(tasks, { search: 'CHARLIE' })).toHaveLength(1)
    expect(applyFilters(tasks, { search: 'ChArLiE' })).toHaveLength(1)
  })

  it('no match returns empty', () => {
    expect(applyFilters(tasks, { search: 'nobody' })).toHaveLength(0)
  })

  it('search works with tasks that have no assignees array', () => {
    const legacy = [makeTask({ id: 't3', assignee: { full_name: 'Alice' }, assigner: { full_name: 'Zara' }, assignees: undefined })]
    expect(applyFilters(legacy, { search: 'alice' })).toHaveLength(1) // matched via assignee field
    expect(applyFilters(legacy, { search: 'nobody' })).toHaveLength(0)
  })

  it('other filters still work alongside assignee search', () => {
    const result = applyFilters(tasks, { search: 'charlie', status: 'In Progress' })
    expect(result).toHaveLength(1)

    const noMatch = applyFilters(tasks, { search: 'charlie', status: 'Done' })
    expect(noMatch).toHaveLength(0)
  })
})

describe('Multi-assignee: notification inclusion', () => {
  const tasks = [
    makeTask({ id: 't1', assigned_to: 'alice', assigned_by: 'bob', task_assignees: [
      { profile_id: 'alice', is_primary: true },
    ]}),
    makeTask({ id: 't2', assigned_to: 'carol', assigned_by: 'bob', task_assignees: [
      { profile_id: 'carol', is_primary: true },
      { profile_id: 'alice', is_primary: false },
    ]}),
    makeTask({ id: 't3', assigned_to: 'dave', assigned_by: 'dave', task_assignees: [
      { profile_id: 'dave', is_primary: true },
    ]}),
  ]

  it('includes tasks where user is primary assignee', () => {
    const notifs = getNotificationTasks(tasks, 'alice')
    expect(notifs.some(t => t.id === 't1')).toBe(true)
  })

  it('includes tasks where user is secondary assignee', () => {
    const notifs = getNotificationTasks(tasks, 'alice')
    expect(notifs.some(t => t.id === 't2')).toBe(true)
  })

  it('includes tasks where user is the assigner', () => {
    const notifs = getNotificationTasks(tasks, 'bob')
    expect(notifs.some(t => t.id === 't1')).toBe(true)
    expect(notifs.some(t => t.id === 't2')).toBe(true)
  })

  it('excludes tasks where user has no involvement', () => {
    const notifs = getNotificationTasks(tasks, 'alice')
    expect(notifs.some(t => t.id === 't3')).toBe(false)
  })
})

describe('Multi-assignee: report counting', () => {
  const tasks = [
    makeTask({ id: 't1', assigned_to: 'alice', task_assignees: [
      { profile_id: 'alice', is_primary: true },
      { profile_id: 'bob', is_primary: false },
    ]}),
    makeTask({ id: 't2', assigned_to: 'bob', task_assignees: [
      { profile_id: 'bob', is_primary: true },
    ]}),
    makeTask({ id: 't3', assigned_to: 'carol', task_assignees: [
      { profile_id: 'carol', is_primary: true },
      { profile_id: 'alice', is_primary: false },
      { profile_id: 'bob', is_primary: false },
    ]}),
  ]

  it('counts primary and secondary assignments for workload', () => {
    expect(getReportTasks(tasks, 'alice')).toHaveLength(2)  // t1 primary + t3 secondary
    expect(getReportTasks(tasks, 'bob')).toHaveLength(3)    // t1 secondary + t2 primary + t3 secondary
    expect(getReportTasks(tasks, 'carol')).toHaveLength(1)  // t3 primary only
  })

  it('does not double-count when user is both assigned_to and in task_assignees', () => {
    expect(getReportTasks(tasks, 'alice')).toHaveLength(2) // not 3
  })
})

describe('Multi-assignee: teamTasks unaffected', () => {
  // teamTasks filter only cares about team_id and team_roles, not assignees
  function getTeamTasks(tasks, profile) {
    const isManager = profile.role === 'Manager' || profile.role === 'Admin'
    if (!isManager) return []
    if (profile.role === 'Admin') return tasks
    const teamRoles = profile.team_roles || {}
    return tasks.filter(t => teamRoles[t.team_id] === 'Manager')
  }

  const tasks = [
    makeTask({ id: 't1', team_id: 'eng', task_assignees: [
      { profile_id: 'u1', is_primary: true },
      { profile_id: 'u2', is_primary: false },
    ]}),
    makeTask({ id: 't2', team_id: 'design', task_assignees: [
      { profile_id: 'u3', is_primary: true },
    ]}),
  ]

  it('filters by manager team role, ignoring who is assigned', () => {
    const manager = { role: 'Manager', team_roles: { eng: 'Manager', design: 'Staff' } }
    const result = getTeamTasks(tasks, manager)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })
})

describe('Due date validation', () => {
  it('allows empty/null due date (optional field)', () => {
    expect(isValidDueDate('')).toBe(true)
    expect(isValidDueDate(null)).toBe(true)
    expect(isValidDueDate(undefined)).toBe(true)
  })

  it('allows future dates', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(isValidDueDate(tomorrow.toISOString())).toBe(true)
  })

  it('allows dates far in the future', () => {
    expect(isValidDueDate('2030-12-31T23:59')).toBe(true)
  })

  it('rejects dates in the past', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(isValidDueDate(yesterday.toISOString())).toBe(false)
  })

  it('rejects dates well in the past', () => {
    expect(isValidDueDate('2020-01-01T00:00')).toBe(false)
  })

  it('handles datetime-local format (no timezone)', () => {
    const future = new Date()
    future.setHours(future.getHours() + 2)
    const formatted = future.toISOString().slice(0, 16)
    expect(isValidDueDate(formatted)).toBe(true)
  })
})
