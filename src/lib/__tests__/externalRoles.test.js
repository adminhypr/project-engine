import { describe, it, expect } from 'vitest'
import { isAgent, isClient, isExternal } from '../roleHelpers'

describe('role helpers', () => {
  it('isAgent true only for Agent role', () => {
    expect(isAgent({ role: 'Agent' })).toBe(true)
    expect(isAgent({ role: 'Staff' })).toBe(false)
    expect(isAgent({ role: 'Client' })).toBe(false)
    expect(isAgent(null)).toBe(false)
  })

  it('isClient true only for Client role', () => {
    expect(isClient({ role: 'Client' })).toBe(true)
    expect(isClient({ role: 'Agent' })).toBe(false)
    expect(isClient(null)).toBe(false)
  })

  it('isExternal is true for Agent or Client', () => {
    expect(isExternal({ role: 'Agent' })).toBe(true)
    expect(isExternal({ role: 'Client' })).toBe(true)
    expect(isExternal({ role: 'Staff' })).toBe(false)
    expect(isExternal({ role: 'Manager' })).toBe(false)
    expect(isExternal({ role: 'Admin' })).toBe(false)
    expect(isExternal(null)).toBe(false)
    expect(isExternal(undefined)).toBe(false)
  })
})
