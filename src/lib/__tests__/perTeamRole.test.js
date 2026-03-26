import { describe, it, expect } from 'vitest'
import { getAssignmentType } from '../assignmentType'

/**
 * Per-team role scenario: A user who is Staff on one team and Manager on another.
 * Tests the filtering/view logic that relies on team_roles and the assignment type engine.
 */

// Simulate the teamTasks filter from useTasks.js (lines 90-96)
function getTeamTasks(tasks, profile) {
  const isManager = profile.role === 'Manager' || profile.role === 'Admin'
  if (!isManager) return []
  if (profile.role === 'Admin') return tasks
  const teamRoles = profile.team_roles || {}
  return tasks.filter(t => teamRoles[t.team_id] === 'Manager')
}

// Simulate the reports team scoping from ReportsPage.jsx (lines 60-69)
function getManagedTeamIds(profile, isAdmin) {
  if (isAdmin) return null // no filter needed
  const mgrTeamIds = (profile.all_teams || [])
    .filter(t => t.role === 'Manager')
    .map(t => t.id)
  if (mgrTeamIds.length > 0) return mgrTeamIds
  // Fallback to all teams if no per-team role data
  return profile.team_ids?.length > 0
    ? profile.team_ids
    : (profile.team_id ? [profile.team_id] : [])
}

// Dual-role user: Manager on Engineering, Staff on Design
const dualRoleUser = {
  id: 'u1',
  role: 'Manager', // effective role (max across teams)
  team_id: 'eng',
  team_ids: ['eng', 'design'],
  team_roles: { eng: 'Manager', design: 'Staff' },
  all_teams: [
    { id: 'eng', name: 'Engineering', is_primary: true, role: 'Manager' },
    { id: 'design', name: 'Design', is_primary: false, role: 'Staff' },
  ],
}

const tasks = [
  { id: 't1', title: 'Fix API bug', team_id: 'eng', assigned_to: 'u2', assigned_by: 'u1' },
  { id: 't2', title: 'Design review', team_id: 'design', assigned_to: 'u3', assigned_by: 'u4' },
  { id: 't3', title: 'Eng standup prep', team_id: 'eng', assigned_to: 'u5', assigned_by: 'u1' },
  { id: 't4', title: 'Logo refresh', team_id: 'design', assigned_to: 'u1', assigned_by: 'u4' },
  { id: 't5', title: 'Sales deck', team_id: 'sales', assigned_to: 'u6', assigned_by: 'u1' },
]

describe('Per-team role: Team View filtering', () => {
  it('shows only tasks from teams where user is Manager', () => {
    const result = getTeamTasks(tasks, dualRoleUser)
    expect(result.map(t => t.team_id)).toEqual(['eng', 'eng'])
    expect(result).toHaveLength(2)
  })

  it('excludes tasks from teams where user is Staff', () => {
    const result = getTeamTasks(tasks, dualRoleUser)
    expect(result.some(t => t.team_id === 'design')).toBe(false)
  })

  it('excludes tasks from teams user does not belong to', () => {
    const result = getTeamTasks(tasks, dualRoleUser)
    expect(result.some(t => t.team_id === 'sales')).toBe(false)
  })

  it('Admin sees all tasks regardless of team_roles', () => {
    const admin = { ...dualRoleUser, role: 'Admin' }
    const result = getTeamTasks(tasks, admin)
    expect(result).toHaveLength(5)
  })

  it('pure Staff user (no Manager on any team) sees no team tasks', () => {
    const pureStaff = {
      id: 'u9',
      role: 'Staff',
      team_ids: ['eng'],
      team_roles: { eng: 'Staff' },
    }
    const result = getTeamTasks(tasks, pureStaff)
    expect(result).toHaveLength(0)
  })

  it('user who is Manager on multiple teams sees tasks from all managed teams', () => {
    const multiMgr = {
      ...dualRoleUser,
      team_roles: { eng: 'Manager', design: 'Manager' },
    }
    const result = getTeamTasks(tasks, multiMgr)
    expect(result.map(t => t.team_id)).toEqual(['eng', 'design', 'eng', 'design'])
  })

  it('returns empty when team_roles is missing', () => {
    const noRoles = { id: 'u1', role: 'Manager', team_ids: ['eng'] }
    const result = getTeamTasks(tasks, noRoles)
    expect(result).toHaveLength(0)
  })
})

describe('Per-team role: Reports team scoping', () => {
  it('returns only Manager teams for dual-role user', () => {
    const ids = getManagedTeamIds(dualRoleUser, false)
    expect(ids).toEqual(['eng'])
  })

  it('returns null (no filter) for Admin', () => {
    expect(getManagedTeamIds(dualRoleUser, true)).toBeNull()
  })

  it('falls back to team_ids when no per-team role data', () => {
    const legacyUser = {
      id: 'u1',
      role: 'Manager',
      team_id: 'eng',
      team_ids: ['eng', 'design'],
      all_teams: [
        { id: 'eng', name: 'Engineering', is_primary: true },
        { id: 'design', name: 'Design', is_primary: false },
      ],
    }
    const ids = getManagedTeamIds(legacyUser, false)
    expect(ids).toEqual(['eng', 'design'])
  })

  it('falls back to legacy team_id when team_ids is empty', () => {
    const legacyUser = {
      id: 'u1',
      role: 'Manager',
      team_id: 'eng',
      team_ids: [],
      all_teams: [],
    }
    const ids = getManagedTeamIds(legacyUser, false)
    expect(ids).toEqual(['eng'])
  })

  it('returns multiple teams when user manages multiple', () => {
    const multiMgr = {
      ...dualRoleUser,
      all_teams: [
        { id: 'eng', name: 'Engineering', is_primary: true, role: 'Manager' },
        { id: 'design', name: 'Design', is_primary: false, role: 'Manager' },
      ],
    }
    const ids = getManagedTeamIds(multiMgr, false)
    expect(ids).toEqual(['eng', 'design'])
  })
})

describe('Per-team role: Assignment type with dual roles', () => {
  const engStaff = {
    id: 'u2', role: 'Staff', team_ids: ['eng'],
    team_roles: { eng: 'Staff' },
  }
  const designStaff = {
    id: 'u3', role: 'Staff', team_ids: ['design'],
    team_roles: { design: 'Staff' },
  }
  const designManager = {
    id: 'u4', role: 'Manager', team_ids: ['design'],
    team_roles: { design: 'Manager' },
  }

  it('dual-role user assigning to Staff on their Manager team → Superior', () => {
    expect(getAssignmentType(dualRoleUser, engStaff, 'eng')).toBe('Superior')
  })

  it('dual-role user assigning to Staff on their Staff team → Peer', () => {
    expect(getAssignmentType(dualRoleUser, designStaff, 'design')).toBe('Peer')
  })

  it('dual-role user assigning to Manager on their Staff team → Upward', () => {
    expect(getAssignmentType(dualRoleUser, designManager, 'design')).toBe('Upward')
  })

  it('dual-role user assigning without teamId falls back to global role (Manager)', () => {
    // Global role is Manager, so Manager → Staff = Superior (same team via team_ids overlap)
    expect(getAssignmentType(dualRoleUser, engStaff)).toBe('Superior')
  })

  it('dual-role user assigning cross-team without teamId uses global role', () => {
    const salesStaff = {
      id: 'u6', role: 'Staff', team_ids: ['sales'],
      team_roles: { sales: 'Staff' },
    }
    // No shared teams, Manager > Staff → CrossTeam
    expect(getAssignmentType(dualRoleUser, salesStaff)).toBe('CrossTeam')
  })

  it('two dual-role users: manager/staff vs staff/manager on swapped teams', () => {
    const userA = {
      id: 'a', role: 'Manager', team_ids: ['eng', 'design'],
      team_roles: { eng: 'Manager', design: 'Staff' },
    }
    const userB = {
      id: 'b', role: 'Manager', team_ids: ['eng', 'design'],
      team_roles: { eng: 'Staff', design: 'Manager' },
    }
    // A assigns to B on eng: A=Manager, B=Staff → Superior
    expect(getAssignmentType(userA, userB, 'eng')).toBe('Superior')
    // A assigns to B on design: A=Staff, B=Manager → Upward
    expect(getAssignmentType(userA, userB, 'design')).toBe('Upward')
    // Without teamId: both global Manager, share teams → Peer
    expect(getAssignmentType(userA, userB)).toBe('Peer')
  })
})
