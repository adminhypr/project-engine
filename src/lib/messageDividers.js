function sameDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

export function dividerLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'Today';
  const y = new Date(now);
  y.setUTCDate(now.getUTCDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function firstUnreadId(messages, lastReadAt) {
  if (!lastReadAt) return null;
  const cut = new Date(lastReadAt);
  const hit = (messages || []).find(m => new Date(m.created_at) > cut);
  return hit ? hit.id : null;
}
