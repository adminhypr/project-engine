import { describe, it, expect } from 'vitest'
import { getAssignmentType, ROLE_RANK, ASSIGNMENT_TYPE_STYLES } from '../assignmentType'

function makeUser(overrides = {}) {
  return { id: 'u1', role: 'Staff', team_id: 'team-a', ...overrides }
}

describe('getAssignmentType', () => {
  it('returns Self when assigner and assignee are the same person', () => {
    const user = makeUser({ id: 'same' })
    expect(getAssignmentType(user, user)).toBe('Self')
  })

  it('returns Superior when Admin assigns to anyone', () => {
    const admin = makeUser({ id: 'a1', role: 'Admin', team_id: 'team-a' })
    const staff = makeUser({ id: 'a2', role: 'Staff', team_id: 'team-b' })
    expect(getAssignmentType(admin, staff)).toBe('Superior')
  })

  it('returns Superior when Manager assigns to Staff on same team', () => {
    const manager = makeUser({ id: 'm1', role: 'Manager', team_id: 'team-a' })
    const staff   = makeUser({ id: 's1', role: 'Staff',   team_id: 'team-a' })
    expect(getAssignmentType(manager, staff)).toBe('Superior')
  })

  it('returns CrossTeam when Manager assigns to Staff on different team', () => {
    const manager = makeUser({ id: 'm1', role: 'Manager', team_id: 'team-a' })
    const staff   = makeUser({ id: 's1', role: 'Staff',   team_id: 'team-b' })
    expect(getAssignmentType(manager, staff)).toBe('CrossTeam')
  })

  it('returns Peer when same role, same team', () => {
    const staff1 = makeUser({ id: 's1', role: 'Staff', team_id: 'team-a' })
    const staff2 = makeUser({ id: 's2', role: 'Staff', team_id: 'team-a' })
    expect(getAssignmentType(staff1, staff2)).toBe('Peer')
  })

  it('returns CrossTeam when same role, different team', () => {
    const staff1 = makeUser({ id: 's1', role: 'Staff', team_id: 'team-a' })
    const staff2 = makeUser({ id: 's2', role: 'Staff', team_id: 'team-b' })
    expect(getAssignmentType(staff1, staff2)).toBe('CrossTeam')
  })

  it('returns Upward when lower rank assigns to higher rank', () => {
    const staff   = makeUser({ id: 's1', role: 'Staff',   team_id: 'team-a' })
    const manager = makeUser({ id: 'm1', role: 'Manager', team_id: 'team-a' })
    expect(getAssignmentType(staff, manager)).toBe('Upward')
  })

  it('returns Upward when Staff assigns to Admin', () => {
    const staff = makeUser({ id: 's1', role: 'Staff', team_id: 'team-a' })
    const admin = makeUser({ id: 'a1', role: 'Admin', team_id: 'team-a' })
    expect(getAssignmentType(staff, admin)).toBe('Upward')
  })

  it('returns Unknown when assigner is null', () => {
    expect(getAssignmentType(null, makeUser())).toBe('Unknown')
  })

  it('returns Unknown when assignee is null', () => {
    expect(getAssignmentType(makeUser(), null)).toBe('Unknown')
  })

  // Multi-team tests
  it('returns Peer when users share a team via team_ids', () => {
    const s1 = makeUser({ id: 's1', role: 'Staff', team_ids: ['team-a', 'team-b'] })
    const s2 = makeUser({ id: 's2', role: 'Staff', team_ids: ['team-b', 'team-c'] })
    expect(getAssignmentType(s1, s2)).toBe('Peer')
  })

  it('returns CrossTeam when users share no teams via team_ids', () => {
    const s1 = makeUser({ id: 's1', role: 'Staff', team_ids: ['team-a'] })
    const s2 = makeUser({ id: 's2', role: 'Staff', team_ids: ['team-b'] })
    expect(getAssignmentType(s1, s2)).toBe('CrossTeam')
  })

  it('returns Superior when manager shares a team with staff via team_ids', () => {
    const mgr = makeUser({ id: 'm1', role: 'Manager', team_ids: ['team-a', 'team-c'] })
    const staff = makeUser({ id: 's1', role: 'Staff', team_ids: ['team-b', 'team-c'] })
    expect(getAssignmentType(mgr, staff)).toBe('Superior')
  })

  it('returns CrossTeam when manager shares no teams with staff via team_ids', () => {
    const mgr = makeUser({ id: 'm1', role: 'Manager', team_ids: ['team-a'] })
    const staff = makeUser({ id: 's1', role: 'Staff', team_ids: ['team-b'] })
    expect(getAssignmentType(mgr, staff)).toBe('CrossTeam')
  })

  it('falls back to team_id when team_ids is empty', () => {
    const s1 = makeUser({ id: 's1', role: 'Staff', team_id: 'team-a', team_ids: [] })
    const s2 = makeUser({ id: 's2', role: 'Staff', team_id: 'team-a', team_ids: [] })
    expect(getAssignmentType(s1, s2)).toBe('Peer')
  })
})

describe('ROLE_RANK', () => {
  it('has correct hierarchy', () => {
    expect(ROLE_RANK.Admin).toBeGreaterThan(ROLE_RANK.Manager)
    expect(ROLE_RANK.Manager).toBeGreaterThan(ROLE_RANK.Staff)
  })
})

describe('ASSIGNMENT_TYPE_STYLES', () => {
  it('has styles for all types', () => {
    for (const type of ['Superior', 'Peer', 'CrossTeam', 'Upward', 'Self', 'Unknown']) {
      expect(ASSIGNMENT_TYPE_STYLES[type]).toBeDefined()
    }
  })
})
