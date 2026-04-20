import { describe, it, expect } from 'vitest'
import {
  shapeConversationRow,
  memberCountLabel,
  groupDisplayName,
} from '../groupConversations'

function participantsMap(entries) {
  return new Map(entries)
}
function profilesMap(list) {
  return new Map(list.map(p => [p.id, p]))
}

const p = (id, name, extra = {}) => ({ id, full_name: name, email: `${id}@x`, ...extra })

describe('shapeConversationRow (DM)', () => {
  it('extracts the single other participant', () => {
    const row = {
      conversation_id: 'cv1',
      last_read_at: '2026-04-17T00:00:00Z',
      muted: false,
      conversation: {
        id: 'cv1',
        kind: 'dm',
        title: null,
        team_id: null,
        last_message_at: '2026-04-17T10:00:00Z',
        last_message_preview: 'hey',
      },
    }
    const shaped = shapeConversationRow({
      row,
      participantsByConv: participantsMap([['cv1', ['me', 'u1']]]),
      profileById: profilesMap([p('me', 'Me'), p('u1', 'Alice')]),
      unreadByConv: new Map([['cv1', 2]]),
      myId: 'me',
    })
    expect(shaped.kind).toBe('dm')
    expect(shaped.other_user_id).toBe('u1')
    expect(shaped.other_profile.full_name).toBe('Alice')
    expect(shaped.participants).toBeNull()
    expect(shaped.unread).toBe(2)
  })

  it('tolerates an unknown other profile', () => {
    const row = {
      conversation_id: 'cv1',
      last_read_at: null,
      muted: false,
      conversation: { id: 'cv1', kind: 'dm', title: null, last_message_at: null, last_message_preview: null },
    }
    const shaped = shapeConversationRow({
      row,
      participantsByConv: participantsMap([['cv1', ['me', 'u1']]]),
      profileById: profilesMap([p('me', 'Me')]),
      unreadByConv: new Map(),
      myId: 'me',
    })
    expect(shaped.other_user_id).toBe('u1')
    expect(shaped.other_profile).toBeNull()
    expect(shaped.unread).toBe(0)
  })
})

describe('shapeConversationRow (group)', () => {
  it('exposes all participant profiles and keeps other_user_id null', () => {
    const row = {
      conversation_id: 'g1',
      last_read_at: '2026-04-17T00:00:00Z',
      muted: false,
      conversation: {
        id: 'g1',
        kind: 'group',
        title: 'Launch',
        team_id: null,
        last_message_at: '2026-04-17T12:00:00Z',
        last_message_preview: 'lgtm',
      },
    }
    const shaped = shapeConversationRow({
      row,
      participantsByConv: participantsMap([['g1', ['me', 'u1', 'u2']]]),
      profileById: profilesMap([p('me', 'Me'), p('u1', 'Alice'), p('u2', 'Bob')]),
      unreadByConv: new Map([['g1', 5]]),
      myId: 'me',
    })
    expect(shaped.kind).toBe('group')
    expect(shaped.title).toBe('Launch')
    expect(shaped.other_user_id).toBeNull()
    expect(shaped.other_profile).toBeNull()
    expect(shaped.participants.map(x => x.id)).toEqual(['me', 'u1', 'u2'])
    expect(shaped.unread).toBe(5)
  })

  it('falls back to "Group" when title is missing', () => {
    const row = {
      conversation_id: 'g1',
      last_read_at: null,
      muted: false,
      conversation: { id: 'g1', kind: 'group', title: null, last_message_at: null, last_message_preview: null },
    }
    const shaped = shapeConversationRow({
      row,
      participantsByConv: participantsMap([['g1', ['me']]]),
      profileById: profilesMap([p('me', 'Me')]),
      unreadByConv: new Map(),
      myId: 'me',
    })
    expect(shaped.title).toBe('Group')
  })

  it('drops participant ids with no matching profile', () => {
    const row = {
      conversation_id: 'g1',
      last_read_at: null,
      muted: false,
      conversation: { id: 'g1', kind: 'group', title: 'X', last_message_at: null, last_message_preview: null },
    }
    const shaped = shapeConversationRow({
      row,
      participantsByConv: participantsMap([['g1', ['me', 'ghost']]]),
      profileById: profilesMap([p('me', 'Me')]),
      unreadByConv: new Map(),
      myId: 'me',
    })
    expect(shaped.participants.map(x => x.id)).toEqual(['me'])
  })
})

describe('memberCountLabel', () => {
  it('handles singular / plural / empty', () => {
    expect(memberCountLabel([])).toBe('No members')
    expect(memberCountLabel([{ id: 'a' }])).toBe('1 member')
    expect(memberCountLabel([{ id: 'a' }, { id: 'b' }])).toBe('2 members')
  })
  it('handles non-array input as empty', () => {
    expect(memberCountLabel(null)).toBe('No members')
    expect(memberCountLabel(undefined)).toBe('No members')
  })
})

describe('groupDisplayName', () => {
  it('prefers the explicit title', () => {
    expect(groupDisplayName({ title: 'Team Foo', participants: [] })).toBe('Team Foo')
  })
  it('ignores whitespace-only titles', () => {
    expect(groupDisplayName({ title: '   ', participants: [p('a', 'Alice Smith')] })).toBe('Alice')
  })
  it('joins first names up to 3, with ellipsis when more', () => {
    const parts = [
      p('a', 'Alice Smith'),
      p('b', 'Bob Jones'),
      p('c', 'Carol Ng'),
      p('d', 'Dan Wu'),
    ]
    expect(groupDisplayName({ title: null, participants: parts })).toBe('Alice, Bob, Carol…')
  })
  it('falls back to "Group" when no names are available', () => {
    expect(groupDisplayName({ title: null, participants: [] })).toBe('Group')
    expect(groupDisplayName(null)).toBe('Group')
  })
})
