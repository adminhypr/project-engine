import { describe, it, expect } from 'vitest'
import {
  taskUrl, taskCommentUrl,
  cardUrl, cardCommentUrl,
  dmUrl, dmMessageUrl,
  hubMessageUrl,
} from '../notificationLinks'

const BASE = 'https://app.example'

describe('notificationLinks', () => {
  describe('taskUrl / taskCommentUrl', () => {
    it('builds /my-tasks?task=<id>', () => {
      expect(taskUrl(BASE, 'abc')).toBe(`${BASE}/my-tasks?task=abc`)
    })
    it('appends &comment when given', () => {
      expect(taskCommentUrl(BASE, 'abc', 'def')).toBe(`${BASE}/my-tasks?task=abc&comment=def`)
    })
    it('returns null when task id missing', () => {
      expect(taskUrl(BASE, null)).toBe(null)
      expect(taskCommentUrl(BASE, null, 'def')).toBe(null)
    })
  })

  describe('cardUrl / cardCommentUrl', () => {
    it('builds /hub/<hubId>?card=<cardId>', () => {
      expect(cardUrl(BASE, 'h1', 'c1')).toBe(`${BASE}/hub/h1?card=c1`)
    })
    it('appends &comment when given', () => {
      expect(cardCommentUrl(BASE, 'h1', 'c1', 'cm1')).toBe(`${BASE}/hub/h1?card=c1&comment=cm1`)
    })
    it('returns null when hubId or cardId missing', () => {
      expect(cardUrl(BASE, null, 'c1')).toBe(null)
      expect(cardUrl(BASE, 'h1', null)).toBe(null)
    })
  })

  describe('dmUrl / dmMessageUrl', () => {
    it('builds /?dm=<convId>', () => {
      expect(dmUrl(BASE, 'conv1')).toBe(`${BASE}/?dm=conv1`)
    })
    it('appends &message when given', () => {
      expect(dmMessageUrl(BASE, 'conv1', 'm1')).toBe(`${BASE}/?dm=conv1&message=m1`)
    })
    it('returns null when convId missing', () => {
      expect(dmUrl(BASE, null)).toBe(null)
    })
  })

  describe('hubMessageUrl', () => {
    it('builds /hub/<hubId>?message=<msgId>', () => {
      expect(hubMessageUrl(BASE, 'h1', 'm1')).toBe(`${BASE}/hub/h1?message=m1`)
    })
    it('returns null when hubId missing', () => {
      expect(hubMessageUrl(BASE, null, 'm1')).toBe(null)
    })
  })

  it('encodes ids that contain reserved chars', () => {
    expect(taskUrl(BASE, 'a/b')).toBe(`${BASE}/my-tasks?task=a%2Fb`)
  })
})
