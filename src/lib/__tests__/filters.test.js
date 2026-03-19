import { describe, it, expect } from 'vitest'
import { applyFilters } from '../filters'

const tasks = [
  { title: 'Fix login bug', task_id: 'T-001', status: 'In Progress', urgency: 'High', priority: 'red', team_id: 'team-a', assignee: { full_name: 'Alice' }, assigner: { full_name: 'Bob' }, who_due_to: 'Acme Corp' },
  { title: 'Update docs', task_id: 'T-002', status: 'Done', urgency: 'Low', priority: 'green', team_id: 'team-b', assignee: { full_name: 'Carol' }, assigner: { full_name: 'Dave' }, who_due_to: null },
  { title: 'Deploy v2', task_id: 'T-003', status: 'Not Started', urgency: 'Med', priority: 'yellow', team_id: 'team-a', assignee: { full_name: 'Bob' }, assigner: { full_name: 'Alice' }, who_due_to: 'Internal' },
]

describe('applyFilters', () => {
  it('returns all tasks with empty filters', () => {
    expect(applyFilters(tasks, {})).toHaveLength(3)
  })

  it('filters by status', () => {
    expect(applyFilters(tasks, { status: 'Done' })).toHaveLength(1)
    expect(applyFilters(tasks, { status: 'Done' })[0].title).toBe('Update docs')
  })

  it('filters by urgency', () => {
    expect(applyFilters(tasks, { urgency: 'High' })).toHaveLength(1)
  })

  it('filters by priority', () => {
    expect(applyFilters(tasks, { priority: 'red' })).toHaveLength(1)
  })

  it('filters by team', () => {
    expect(applyFilters(tasks, { team: 'team-a' })).toHaveLength(2)
  })

  it('searches by title', () => {
    expect(applyFilters(tasks, { search: 'login' })).toHaveLength(1)
  })

  it('searches by task_id', () => {
    expect(applyFilters(tasks, { search: 'T-002' })).toHaveLength(1)
  })

  it('searches by assignee name', () => {
    expect(applyFilters(tasks, { search: 'carol' })).toHaveLength(1)
  })

  it('searches by assigner name', () => {
    expect(applyFilters(tasks, { search: 'dave' })).toHaveLength(1)
  })

  it('searches by who_due_to', () => {
    expect(applyFilters(tasks, { search: 'acme' })).toHaveLength(1)
  })

  it('combines multiple filters', () => {
    expect(applyFilters(tasks, { status: 'In Progress', priority: 'red' })).toHaveLength(1)
    expect(applyFilters(tasks, { status: 'Done', priority: 'red' })).toHaveLength(0)
  })

  it('handles missing fields gracefully', () => {
    const sparse = [{ title: 'Bare task', status: 'Not Started', urgency: 'Med', priority: 'none' }]
    expect(applyFilters(sparse, { search: 'bare' })).toHaveLength(1)
    expect(applyFilters(sparse, { search: 'nobody' })).toHaveLength(0)
  })
})
