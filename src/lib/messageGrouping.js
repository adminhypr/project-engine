export const groupGapMs = 5 * 60 * 1000;

function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getUTCFullYear() === db.getUTCFullYear()
    && da.getUTCMonth() === db.getUTCMonth()
    && da.getUTCDate() === db.getUTCDate();
}

export function isLeadMessage(cur, prev) {
  if (!prev) return true;
  if (cur.author_id !== prev.author_id) return true;
  if (!sameDay(prev.created_at, cur.created_at)) return true;
  return (new Date(cur.created_at) - new Date(prev.created_at)) > groupGapMs;
}
