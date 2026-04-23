// src/lib/__tests__/perAssigneeCompletion.test.js
import { describe, it, expect } from 'vitest'
import {
  allAssigneesComplete,
  completionProgress,
  canForceClose,
  isAssigneeOpen,
} from '../perAssigneeCompletion'

describe('perAssigneeCompletion', () => {
  const openRow      = { profile_id: 'p1', completed_at: null }
  const doneRow      = { profile_id: 'p2', completed_at: '2026-04-23T10:00:00Z', completed_by: 'p2' }
  const openRow2     = { profile_id: 'p3', completed_at: null }

  it('allAssigneesComplete: false when any open', () => {
    expect(allAssigneesComplete([openRow, doneRow])).toBe(false)
  })

  it('allAssigneesComplete: true when all done', () => {
    expect(allAssigneesComplete([doneRow, { ...doneRow, profile_id: 'p4' }])).toBe(true)
  })

  it('allAssigneesComplete: false for empty array', () => {
    expect(allAssigneesComplete([])).toBe(false)
  })

  it('completionProgress: returns {done, total}', () => {
    expect(completionProgress([openRow, doneRow, openRow2])).toEqual({ done: 1, total: 3 })
  })

  it('isAssigneeOpen: true for null completed_at', () => {
    expect(isAssigneeOpen(openRow)).toBe(true)
    expect(isAssigneeOpen(doneRow)).toBe(false)
  })

  it('canForceClose: assigner can', () => {
    const task = { assigned_by: 'u1', task_assignees: [openRow] }
    expect(canForceClose(task, 'u1', false)).toBe(true)
  })

  it('canForceClose: admin can', () => {
    const task = { assigned_by: 'u1', task_assignees: [openRow] }
    expect(canForceClose(task, 'admin', true)).toBe(true)
  })

  it('canForceClose: assignee can', () => {
    const task = { assigned_by: 'u1', task_assignees: [{ profile_id: 'u2', completed_at: null }] }
    expect(canForceClose(task, 'u2', false)).toBe(true)
  })

  it('canForceClose: random user cannot', () => {
    const task = { assigned_by: 'u1', task_assignees: [{ profile_id: 'u2', completed_at: null }] }
    expect(canForceClose(task, 'u3', false)).toBe(false)
  })
})
