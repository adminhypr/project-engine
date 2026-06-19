import { describe, it, expect } from 'vitest';
import { dividerLabel, firstUnreadId } from '@/lib/messageDividers';

describe('dividerLabel', () => {
  const today = new Date('2026-06-19T12:00:00Z');
  it('labels today', () => {
    expect(dividerLabel('2026-06-19T08:00:00Z', today)).toBe('Today');
  });
  it('labels yesterday', () => {
    expect(dividerLabel('2026-06-18T08:00:00Z', today)).toBe('Yesterday');
  });
  it('labels an older date with a month/day string', () => {
    expect(dividerLabel('2026-06-12T08:00:00Z', today)).toMatch(/June 12/);
  });
});

describe('firstUnreadId', () => {
  const msgs = [
    { id: '1', created_at: '2026-06-19T10:00:00Z' },
    { id: '2', created_at: '2026-06-19T11:00:00Z' },
    { id: '3', created_at: '2026-06-19T12:00:00Z' },
  ];
  it('returns the first message created after last_read_at', () => {
    expect(firstUnreadId(msgs, '2026-06-19T10:30:00Z')).toBe('2');
  });
  it('returns null when everything is read', () => {
    expect(firstUnreadId(msgs, '2026-06-19T23:00:00Z')).toBe(null);
  });
  it('returns null when last_read_at is missing', () => {
    expect(firstUnreadId(msgs, null)).toBe(null);
  });
});
