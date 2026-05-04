import { describe, it, expect } from 'vitest'
import { buildTeamIdsByProfileId, taskOnTeam } from '../teamMembership'

describe('buildTeamIdsByProfileId', () => {
  it('builds a Map keyed by profile id with Sets of team ids from team_ids', () => {
    const profiles = [
      { id: 'p1', team_ids: ['t-marketing', 't-sales'] },
      { id: 'p2', team_ids: ['t-sales'] },
    ]
    const map = buildTeamIdsByProfileId(profiles)
    expect(map.get('p1')).toEqual(new Set(['t-marketing', 't-sales']))
    expect(map.get('p2')).toEqual(new Set(['t-sales']))
  })

  it('falls back to legacy team_id when team_ids missing or empty', () => {
    const profiles = [
      { id: 'p1', team_id: 't-legacy' },
      { id: 'p2', team_ids: [], team_id: 't-other' },
    ]
    const map = buildTeamIdsByProfileId(profiles)
    expect(map.get('p1')).toEqual(new Set(['t-legacy']))
    expect(map.get('p2')).toEqual(new Set(['t-other']))
  })

  it('returns an empty Set for profiles with no team data', () => {
    const profiles = [{ id: 'p1' }]
    const map = buildTeamIdsByProfileId(profiles)
    expect(map.get('p1')).toEqual(new Set())
  })

  it('handles empty profiles list', () => {
    const map = buildTeamIdsByProfileId([])
    expect(map.size).toBe(0)
  })
})

describe('taskOnTeam', () => {
  // Alice belongs to Marketing+Sales, Bob to Sales only, Carol to Marketing only.
  const teamIdsByProfileId = new Map([
    ['alice', new Set(['marketing', 'sales'])],
    ['bob',   new Set(['sales'])],
    ['carol', new Set(['marketing'])],
  ])

  it('returns true when the primary assignee is on the team', () => {
    const task = { assignees: [{ id: 'carol', is_primary: true }], assigned_to: 'carol' }
    expect(taskOnTeam(task, 'marketing', teamIdsByProfileId)).toBe(true)
  })

  it('returns true when any (non-primary) co-assignee is on the team', () => {
    const task = {
      assignees: [
        { id: 'bob',   is_primary: true },
        { id: 'carol', is_primary: false },
      ],
      assigned_to: 'bob',
    }
    expect(taskOnTeam(task, 'marketing', teamIdsByProfileId)).toBe(true)
  })

  it('returns true for a multi-team assignee on either of their teams', () => {
    const task = { assignees: [{ id: 'alice', is_primary: true }], assigned_to: 'alice' }
    expect(taskOnTeam(task, 'marketing', teamIdsByProfileId)).toBe(true)
    expect(taskOnTeam(task, 'sales',     teamIdsByProfileId)).toBe(true)
  })

  it('ignores the stored task.team_id — uses assignee membership instead', () => {
    // Bug case: task tagged team_id="marketing" but reassigned to Bob (Sales-only).
    // Filter by Marketing must NOT include this; filter by Sales MUST include it.
    const task = {
      team_id: 'marketing',
      assignees: [{ id: 'bob', is_primary: true }],
      assigned_to: 'bob',
    }
    expect(taskOnTeam(task, 'marketing', teamIdsByProfileId)).toBe(false)
    expect(taskOnTeam(task, 'sales',     teamIdsByProfileId)).toBe(true)
  })

  it('falls back to task.assigned_to when assignees array is missing or empty', () => {
    const task = { assigned_to: 'alice' }
    expect(taskOnTeam(task, 'marketing', teamIdsByProfileId)).toBe(true)
    expect(taskOnTeam(task, 'sales',     teamIdsByProfileId)).toBe(true)

    const taskEmpty = { assigned_to: 'bob', assignees: [] }
    expect(taskOnTeam(taskEmpty, 'sales',     teamIdsByProfileId)).toBe(true)
    expect(taskOnTeam(taskEmpty, 'marketing', teamIdsByProfileId)).toBe(false)
  })

  it('returns false when no assignee belongs to the team', () => {
    const task = { assignees: [{ id: 'bob' }], assigned_to: 'bob' }
    expect(taskOnTeam(task, 'marketing', teamIdsByProfileId)).toBe(false)
  })

  it('returns false when the assignee profile is unknown (deleted user)', () => {
    const task = { assignees: [{ id: 'ghost' }], assigned_to: 'ghost' }
    expect(taskOnTeam(task, 'marketing', teamIdsByProfileId)).toBe(false)
  })

  it('returns false when teamId is falsy (no filter selected)', () => {
    const task = { assignees: [{ id: 'alice' }], assigned_to: 'alice' }
    expect(taskOnTeam(task, null,      teamIdsByProfileId)).toBe(false)
    expect(taskOnTeam(task, undefined, teamIdsByProfileId)).toBe(false)
    expect(taskOnTeam(task, '',        teamIdsByProfileId)).toBe(false)
  })
})
