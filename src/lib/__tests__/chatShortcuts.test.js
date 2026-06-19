import { describe, it, expect } from 'vitest';
import { matchShortcut } from '@/lib/chatShortcuts';

const ev = (o) => ({ key: '', metaKey: false, ctrlKey: false, shiftKey: false, ...o });

it('matches Cmd/Ctrl+K to quickSwitcher', () => {
  expect(matchShortcut(ev({ key: 'k', metaKey: true }))).toBe('quickSwitcher');
  expect(matchShortcut(ev({ key: 'k', ctrlKey: true }))).toBe('quickSwitcher');
});
it('matches Escape to closePanel', () => {
  expect(matchShortcut(ev({ key: 'Escape' }))).toBe('closePanel');
});
it('returns null for unmapped keys', () => {
  expect(matchShortcut(ev({ key: 'a' }))).toBe(null);
});
