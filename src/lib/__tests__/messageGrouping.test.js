import { describe, it, expect } from 'vitest';
import { isLeadMessage, groupGapMs } from '@/lib/messageGrouping';

const m = (author_id, created_at) => ({ author_id, created_at });

describe('isLeadMessage', () => {
  it('is a lead when there is no previous message', () => {
    expect(isLeadMessage(m('a', '2026-06-19T10:00:00Z'), null)).toBe(true);
  });
  it('is a lead when the author changes', () => {
    const prev = m('a', '2026-06-19T10:00:00Z');
    const cur  = m('b', '2026-06-19T10:00:30Z');
    expect(isLeadMessage(cur, prev)).toBe(true);
  });
  it('is NOT a lead for same author within the gap window', () => {
    const prev = m('a', '2026-06-19T10:00:00Z');
    const cur  = m('a', '2026-06-19T10:02:00Z'); // 2 min
    expect(isLeadMessage(cur, prev)).toBe(false);
  });
  it('is a lead for same author after the gap window (>5min)', () => {
    const prev = m('a', '2026-06-19T10:00:00Z');
    const cur  = m('a', '2026-06-19T10:06:00Z'); // 6 min
    expect(isLeadMessage(cur, prev)).toBe(true);
  });
  it('is a lead when the calendar day changes', () => {
    const prev = m('a', '2026-06-19T23:59:00Z');
    const cur  = m('a', '2026-06-20T00:00:30Z');
    expect(isLeadMessage(cur, prev)).toBe(true);
  });
  it('exposes the gap window constant', () => {
    expect(groupGapMs).toBe(5 * 60 * 1000);
  });
});
