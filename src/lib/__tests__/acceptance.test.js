import { describe, it, expect } from 'vitest'

const AUTO_ACCEPT_TYPES = ['Superior', 'Self']
const REQUIRES_ACCEPTANCE = ['Peer', 'CrossTeam', 'Upward']

function getInitialAcceptanceStatus(assignmentType) {
  if (AUTO_ACCEPT_TYPES.includes(assignmentType)) return 'Accepted'
  return 'Pending'
}

function canDecline(assignmentType) {
  return REQUIRES_ACCEPTANCE.includes(assignmentType)
}

function canReassign(task, userId, isAdmin) {
  if (task.acceptance_status !== 'Declined') return false
  return task.assigned_by === userId || isAdmin
}

describe('acceptance logic', () => {
  describe('getInitialAcceptanceStatus', () => {
    it('auto-accepts Superior assignments', () => {
      expect(getInitialAcceptanceStatus('Superior')).toBe('Accepted')
    })

    it('auto-accepts Self assignments', () => {
      expect(getInitialAcceptanceStatus('Self')).toBe('Accepted')
    })

    it('sets Pending for Peer assignments', () => {
      expect(getInitialAcceptanceStatus('Peer')).toBe('Pending')
    })

    it('sets Pending for CrossTeam assignments', () => {
      expect(getInitialAcceptanceStatus('CrossTeam')).toBe('Pending')
    })

    it('sets Pending for Upward assignments', () => {
      expect(getInitialAcceptanceStatus('Upward')).toBe('Pending')
    })
  })

  describe('canDecline', () => {
    it('allows declining Peer tasks', () => {
      expect(canDecline('Peer')).toBe(true)
    })

    it('allows declining CrossTeam tasks', () => {
      expect(canDecline('CrossTeam')).toBe(true)
    })

    it('allows declining Upward tasks', () => {
      expect(canDecline('Upward')).toBe(true)
    })

    it('does not allow declining Superior tasks', () => {
      expect(canDecline('Superior')).toBe(false)
    })

    it('does not allow declining Self tasks', () => {
      expect(canDecline('Self')).toBe(false)
    })
  })

  describe('canReassign', () => {
    const declinedTask = { acceptance_status: 'Declined', assigned_by: 'user-1' }
    const pendingTask = { acceptance_status: 'Pending', assigned_by: 'user-1' }
    const acceptedTask = { acceptance_status: 'Accepted', assigned_by: 'user-1' }

    it('allows original assigner to reassign declined tasks', () => {
      expect(canReassign(declinedTask, 'user-1', false)).toBe(true)
    })

    it('allows admin to reassign declined tasks', () => {
      expect(canReassign(declinedTask, 'user-99', true)).toBe(true)
    })

    it('does not allow random user to reassign', () => {
      expect(canReassign(declinedTask, 'user-99', false)).toBe(false)
    })

    it('does not allow reassign of pending tasks', () => {
      expect(canReassign(pendingTask, 'user-1', false)).toBe(false)
    })

    it('does not allow reassign of accepted tasks', () => {
      expect(canReassign(acceptedTask, 'user-1', false)).toBe(false)
    })
  })
})
