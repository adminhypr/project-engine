import { describe, it, expect, beforeEach } from 'vitest'
import { getStoredActiveTeamId, setStoredActiveTeamId, pickDefaultTeam } from '../activeTeamStorage'

describe('activeTeam storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('getStoredActiveTeamId returns null when unset', () => {
    expect(getStoredActiveTeamId('profile-1')).toBeNull()
  })

  it('setStoredActiveTeamId persists per-profile', () => {
    setStoredActiveTeamId('profile-1', 'team-a')
    expect(getStoredActiveTeamId('profile-1')).toBe('team-a')
    expect(getStoredActiveTeamId('profile-2')).toBeNull()
  })

  it('pickDefaultTeam prefers primary team', () => {
    const profile = {
      all_teams: [
        { id: 't1', is_primary: false },
        { id: 't2', is_primary: true },
        { id: 't3', is_primary: false },
      ]
    }
    expect(pickDefaultTeam(profile)).toBe('t2')
  })

  it('pickDefaultTeam falls back to first team', () => {
    const profile = { all_teams: [{ id: 't1' }, { id: 't2' }] }
    expect(pickDefaultTeam(profile)).toBe('t1')
  })

  it('pickDefaultTeam returns null when no teams', () => {
    expect(pickDefaultTeam({ all_teams: [] })).toBeNull()
    expect(pickDefaultTeam({})).toBeNull()
  })
})
