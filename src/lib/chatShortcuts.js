// src/lib/chatShortcuts.js
export function matchShortcut(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') return 'quickSwitcher';
  if (e.key === 'Escape') return 'closePanel';
  return null;
}
