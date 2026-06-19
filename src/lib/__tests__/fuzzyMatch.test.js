import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyFilter } from '@/lib/fuzzyMatch';

describe('fuzzyScore', () => {
  it('returns >0 for a subsequence match', () => {
    expect(fuzzyScore('mre', 'Marie Anne')).toBeGreaterThan(0);
  });
  it('returns 0 when not a subsequence', () => {
    expect(fuzzyScore('xyz', 'Marie')).toBe(0);
  });
  it('scores a contiguous prefix higher than a scattered match', () => {
    expect(fuzzyScore('mar', 'Marie')).toBeGreaterThan(fuzzyScore('mre', 'Marie Anne'));
  });
  it('is case-insensitive', () => {
    expect(fuzzyScore('MAR', 'marie')).toBeGreaterThan(0);
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { id: '1', label: 'Marie Anne' },
    { id: '2', label: 'Systems Dev' },
    { id: '3', label: 'Mark Rivera' },
  ];
  it('returns matches sorted by score desc', () => {
    const r = fuzzyFilter('mar', items, x => x.label);
    expect(r[0].id).toBe('1'); // "Mar" prefix beats scattered
  });
  it('returns all items for an empty query', () => {
    expect(fuzzyFilter('', items, x => x.label)).toHaveLength(3);
  });
});
