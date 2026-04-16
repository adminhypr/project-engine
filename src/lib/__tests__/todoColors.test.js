import { describe, it, expect } from 'vitest'
import { TODO_LIST_COLORS, todoColorClass, todoColorKeys } from '../../components/hub/todos/todoColors'

describe('todoColors', () => {
  it('defines seven color tokens', () => {
    expect(todoColorKeys).toEqual(['blue','green','red','yellow','purple','orange','gray'])
  })

  it('maps every token to a non-empty Tailwind class', () => {
    for (const key of todoColorKeys) {
      expect(TODO_LIST_COLORS[key]).toMatch(/^bg-/)
    }
  })

  it('returns the default (blue) class when key is unknown or missing', () => {
    expect(todoColorClass(undefined)).toBe(TODO_LIST_COLORS.blue)
    expect(todoColorClass('nope')).toBe(TODO_LIST_COLORS.blue)
    expect(todoColorClass(null)).toBe(TODO_LIST_COLORS.blue)
  })

  it('returns the mapped class for known keys', () => {
    expect(todoColorClass('green')).toBe(TODO_LIST_COLORS.green)
    expect(todoColorClass('red')).toBe(TODO_LIST_COLORS.red)
  })
})
