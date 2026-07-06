import { describe, it, expect } from 'vitest'
import {
  getAccountType,
  getAccessLevel,
  summarizeTeams,
  filterUsers,
} from '../userAccess'

// Profile rows as fetched by SettingsPage: profiles.* plus enriched
// profile_teams [{ team_id, is_primary, role, team: { id, name } }].
const pt = (teamId, name, { primary = false, role = 'Staff' } = {}) => ({
  team_id: teamId,
  is_primary: primary,
  role,
  team: { id: teamId, name },
})

const admin = {
  id: 'u-admin', role: 'Admin', full_name: 'David Laskin', email: 'david@hyprassistants.com',
  profile_teams: [pt('t-ops', 'Operations', { primary: true, role: 'Manager' })],
}
const manager = {
  id: 'u-mgr', role: 'Manager', full_name: 'Ian (AI Dev)', email: 'ian@hyprassistants.com',
  profile_teams: [
    pt('t-test', 'Team Test'),
    pt('t-sys', 'Systems Development', { role: 'Manager' }),
    pt('t-ops', 'Operations', { primary: true, role: 'Manager' }),
  ],
}
const staff = {
  id: 'u-staff', role: 'Staff', full_name: 'Mark Cinco', email: 'mark@hyprassistants.com',
  profile_teams: [pt('t-ops', 'Operations', { primary: true })],
}
const agent = {
  id: 'u-agent', role: 'Agent', full_name: 'Agent Smith', email: 'agent@agentboard.local',
  profile_teams: [pt('t-ext', 'TEST - Agentboard', { primary: true, role: 'Agent' })],
}
const client = {
  id: 'u-client', role: 'Client', full_name: 'Ian - Client', email: 'ian.hyprservice@gmail.com',
  profile_teams: [pt('t-test', 'Team Test', { primary: true, role: 'Client' })],
}
const unassigned = {
  id: 'u-new', role: 'Staff', full_name: 'New Person', email: 'new@hyprassistants.com',
  profile_teams: [],
}

describe('getAccountType', () => {
  it('maps internal global roles to Internal', () => {
    expect(getAccountType(admin)).toBe('Internal')
    expect(getAccountType(manager)).toBe('Internal')
    expect(getAccountType(staff)).toBe('Internal')
  })
  it('maps external sticky roles to their type', () => {
    expect(getAccountType(agent)).toBe('Agent')
    expect(getAccountType(client)).toBe('Client')
  })
  it('defaults null/unknown to Internal', () => {
    expect(getAccountType(null)).toBe('Internal')
    expect(getAccountType({ role: 'SomethingNew' })).toBe('Internal')
  })
})

describe('getAccessLevel', () => {
  it('returns the canonical global role for internals', () => {
    expect(getAccessLevel(admin)).toBe('Admin')
    expect(getAccessLevel(manager)).toBe('Manager')
    expect(getAccessLevel(staff)).toBe('Staff')
  })
  it('returns null for externals (no internal access ladder)', () => {
    expect(getAccessLevel(agent)).toBeNull()
    expect(getAccessLevel(client)).toBeNull()
  })
  it('defaults null/unknown roles to Staff', () => {
    expect(getAccessLevel(null)).toBe('Staff')
    expect(getAccessLevel({ role: 'TeamLeader' })).toBe('Staff')
  })
})

describe('summarizeTeams', () => {
  it('puts the primary team first, others alphabetical', () => {
    const s = summarizeTeams(manager.profile_teams)
    expect(s.visible.map(t => t.name)).toEqual(['Operations', 'Systems Development'])
    expect(s.visible[0].is_primary).toBe(true)
    expect(s.overflow).toBe(1) // Team Test hidden behind +1
  })
  it('respects maxVisible', () => {
    const s = summarizeTeams(manager.profile_teams, 1)
    expect(s.visible.map(t => t.name)).toEqual(['Operations'])
    expect(s.overflow).toBe(2)
  })
  it('handles no primary flag (all alphabetical)', () => {
    const rows = [pt('b', 'Bravo'), pt('a', 'Alpha')]
    expect(summarizeTeams(rows).visible.map(t => t.name)).toEqual(['Alpha', 'Bravo'])
  })
  it('handles empty and non-array input', () => {
    expect(summarizeTeams([])).toEqual({ visible: [], overflow: 0 })
    expect(summarizeTeams(null)).toEqual({ visible: [], overflow: 0 })
    expect(summarizeTeams({ rows: [] })).toEqual({ visible: [], overflow: 0 })
  })
  it('falls back to Unknown when the team join is missing', () => {
    const s = summarizeTeams([{ team_id: 'x', is_primary: true, role: 'Staff', team: null }])
    expect(s.visible[0].name).toBe('Unknown')
  })
})

describe('filterUsers', () => {
  const all = [admin, manager, staff, agent, client, unassigned]

  it('returns everything with empty filters', () => {
    expect(filterUsers(all, {})).toEqual(all)
  })
  it('searches name case-insensitively', () => {
    expect(filterUsers(all, { search: 'laskin' })).toEqual([admin])
  })
  it('searches email', () => {
    expect(filterUsers(all, { search: 'hyprservice' })).toEqual([client])
  })
  it('searches team name', () => {
    expect(filterUsers(all, { search: 'systems dev' })).toEqual([manager])
  })
  it('filters by team membership', () => {
    expect(filterUsers(all, { teamId: 't-ops' })).toEqual([admin, manager, staff])
  })
  it('filters by account type', () => {
    expect(filterUsers(all, { type: 'Agent' })).toEqual([agent])
    expect(filterUsers(all, { type: 'Client' })).toEqual([client])
    expect(filterUsers(all, { type: 'Internal' })).toEqual([admin, manager, staff, unassigned])
  })
  it('combines dimensions (AND)', () => {
    expect(filterUsers(all, { search: 'ian', type: 'Internal' })).toEqual([manager])
  })
  it('handles non-array input', () => {
    expect(filterUsers(null, { search: 'x' })).toEqual([])
    expect(filterUsers({ profiles: all }, {})).toEqual([])
  })
})
