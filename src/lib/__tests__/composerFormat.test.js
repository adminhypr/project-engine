import { describe, it, expect } from 'vitest';
import { wrapSelection, prefixLines } from '@/lib/composerFormat';

describe('wrapSelection', () => {
  it('wraps the selected range with the given marker', () => {
    const r = wrapSelection('hello world', 0, 5, '~');
    expect(r.text).toBe('~hello~ world');
    expect(r.selStart).toBe(1);
    expect(r.selEnd).toBe(6);
  });
});

describe('prefixLines', () => {
  it('prefixes every selected line (blockquote)', () => {
    const r = prefixLines('a\nb', 0, 3, '> ');
    expect(r.text).toBe('> a\n> b');
  });
  it('numbers ordered lists', () => {
    const r = prefixLines('a\nb', 0, 3, (i) => `${i + 1}. `);
    expect(r.text).toBe('1. a\n2. b');
  });
});
