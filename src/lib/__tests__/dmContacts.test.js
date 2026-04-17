import { describe, it, expect } from 'vitest'
import { bucketContacts, filterContactsBySearch } from '../dmContacts'

const myId = 'me'
const myTeamIds = ['t1', 't2']

function p(id, name, teamIds = []) {
  return { id, full_name: name, email: `${id}@x`, avatar_url: null, team_ids: teamIds }
}

function c(convId, otherId, lastAt, unread = 0) {
  return { id: convId, other_user_id: otherId, last_message_at: lastAt, unread }
}

describe('bucketContacts', () => {
  const profiles = [
    p('me', 'Me', ['t1']),
    p('u1', 'Alice',   ['t1']),
    p('u2', 'Bob',     ['t2']),
    p('u3', 'Carol',   ['t3']),
    p('u4', 'Dan',     ['t1']),
    p('u5', 'Eve',     ['t4']),
  ]
  const conversations = [
    c('cvA', 'u4', '2026-04-17T10:00:00Z', 1),
    c('cvB', 'u5', '2026-04-17T09:00:00Z', 0),
  ]

  it('excludes self from every bucket', () => {
    const { recent, teammates, company } = bucketContacts({ profiles, conversations, myId, myTeamIds })
    const ids = [...recent, ...teammates, ...company].map(r => r.profile.id)
    expect(ids).not.toContain(myId)
  })

  it('puts conversation partners in Recent, sorted by last_message_at desc', () => {
    const { recent } = bucketContacts({ profiles, conversations, myId, myTeamIds })
    expect(recent.map(r => r.profile.id)).toEqual(['u4', 'u5'])
    expect(recent[0].conversation.id).toBe('cvA')
  })

  it('caps Recent at 8 entries', () => {
    const many = Array.from({ length: 12 }, (_, i) => c(`cv${i}`, `u${i}`, `2026-04-17T${10+i}:00:00Z`))
    const profs = [
      p('me', 'Me', ['t1']),
      ...Array.from({ length: 12 }, (_, i) => p(`u${i}`, `User${i}`, [])),
    ]
    const { recent } = bucketContacts({ profiles: profs, conversations: many, myId, myTeamIds })
    expect(recent).toHaveLength(8)
  })

  it('puts profiles sharing any of my teams in Teammates, minus Recent', () => {
    const { teammates } = bucketContacts({ profiles, conversations, myId, myTeamIds })
    expect(teammates.map(r => r.profile.id).sort()).toEqual(['u1', 'u2'])
  })

  it('puts everyone else in Company', () => {
    const { company } = bucketContacts({ profiles, conversations, myId, myTeamIds })
    expect(company.map(r => r.profile.id)).toEqual(['u3'])
  })

  it('handles profiles with missing team_ids as empty array', () => {
    const profs = [p('me', 'Me', ['t1']), { id: 'u1', full_name: 'NoTeams', email: 'x', avatar_url: null }]
    const { company, teammates } = bucketContacts({ profiles: profs, conversations: [], myId, myTeamIds })
    expect(teammates).toEqual([])
    expect(company.map(r => r.profile.id)).toEqual(['u1'])
  })
})

describe('filterContactsBySearch', () => {
  const sections = {
    recent:    [{ profile: p('u1', 'Alice Smith') }],
    teammates: [{ profile: p('u2', 'Bob Brown') }, { profile: p('u3', 'Alice Jones') }],
    company:   [{ profile: p('u4', 'Carol Davis') }],
  }

  it('returns all sections when query is empty', () => {
    const out = filterContactsBySearch(sections, '')
    expect(out).toEqual(sections)
  })

  it('matches case-insensitively by name, preserving sections', () => {
    const out = filterContactsBySearch(sections, 'alice')
    expect(out.recent.map(r => r.profile.id)).toEqual(['u1'])
    expect(out.teammates.map(r => r.profile.id)).toEqual(['u3'])
    expect(out.company).toEqual([])
  })

  it('trims whitespace and ignores pure-whitespace queries', () => {
    const out = filterContactsBySearch(sections, '   ')
    expect(out).toEqual(sections)
  })
})
