import { describe, it, expect } from 'vitest'
import { computeSeenByMessage } from '../groupSeenBy'

const me = 'me'
const alice = 'a'
const bob = 'b'

function msg(id, iso, author_id = me, extra = {}) {
  return { id, created_at: iso, author_id, kind: 'user', deleted_at: null, ...extra }
}

describe('computeSeenByMessage', () => {
  it('returns empty map for empty inputs', () => {
    expect(computeSeenByMessage([], [], me).size).toBe(0)
    expect(computeSeenByMessage([msg('m1', '2026-01-01T00:00:00Z')], [], me).size).toBe(0)
  })

  it('places a reader at the latest message they have read', () => {
    const messages = [
      msg('m1', '2026-01-01T10:00:00Z'),
      msg('m2', '2026-01-01T10:05:00Z'),
      msg('m3', '2026-01-01T10:10:00Z'),
    ]
    const readers = [
      { user_id: alice, last_read_at: '2026-01-01T10:06:00Z', profile: { id: alice } },
    ]
    const result = computeSeenByMessage(messages, readers, me)
    expect([...result.keys()]).toEqual(['m2'])
    expect(result.get('m2').map(r => r.user_id)).toEqual([alice])
  })

  it('groups multiple readers by their seen-up-to message', () => {
    const messages = [
      msg('m1', '2026-01-01T10:00:00Z'),
      msg('m2', '2026-01-01T10:05:00Z'),
      msg('m3', '2026-01-01T10:10:00Z'),
    ]
    const readers = [
      { user_id: alice, last_read_at: '2026-01-01T10:10:00Z', profile: { id: alice } },
      { user_id: bob,   last_read_at: '2026-01-01T10:05:00Z', profile: { id: bob } },
    ]
    const result = computeSeenByMessage(messages, readers, me)
    expect(result.get('m2').map(r => r.user_id)).toEqual([bob])
    expect(result.get('m3').map(r => r.user_id)).toEqual([alice])
  })

  it('skips the current user so you do not see your own avatar', () => {
    const messages = [msg('m1', '2026-01-01T10:00:00Z')]
    const readers = [
      { user_id: me,    last_read_at: '2026-01-01T10:10:00Z', profile: { id: me } },
      { user_id: alice, last_read_at: '2026-01-01T10:10:00Z', profile: { id: alice } },
    ]
    const result = computeSeenByMessage(messages, readers, me)
    expect(result.get('m1').map(r => r.user_id)).toEqual([alice])
  })

  it('does not mark a reader as having read their own message', () => {
    const messages = [
      msg('m1', '2026-01-01T10:00:00Z', alice),
      msg('m2', '2026-01-01T10:05:00Z', me),
    ]
    const readers = [
      { user_id: alice, last_read_at: '2026-01-01T10:06:00Z', profile: { id: alice } },
    ]
    // alice should land on m2 (my message), not m1 (her own).
    const result = computeSeenByMessage(messages, readers, me)
    expect(result.get('m2').map(r => r.user_id)).toEqual([alice])
    expect(result.has('m1')).toBe(false)
  })

  it('ignores system + deleted messages', () => {
    const messages = [
      msg('m1', '2026-01-01T10:00:00Z'),
      msg('sys', '2026-01-01T10:05:00Z', me, { kind: 'system' }),
      msg('del', '2026-01-01T10:07:00Z', me, { deleted_at: '2026-01-01T10:08:00Z' }),
    ]
    const readers = [
      { user_id: alice, last_read_at: '2026-01-01T10:09:00Z', profile: { id: alice } },
    ]
    const result = computeSeenByMessage(messages, readers, me)
    expect(result.get('m1').map(r => r.user_id)).toEqual([alice])
  })

  it('places readers nowhere when their last_read_at precedes every message', () => {
    const messages = [msg('m1', '2026-01-02T10:00:00Z')]
    const readers = [
      { user_id: alice, last_read_at: '2026-01-01T00:00:00Z', profile: { id: alice } },
    ]
    expect(computeSeenByMessage(messages, readers, me).size).toBe(0)
  })
})
