// src/lib/fuzzyMatch.js
export function fuzzyScore(query, target) {
  const q = (query || '').toLowerCase();
  const t = (target || '').toLowerCase();
  if (!q) return 1;
  let ti = 0, score = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let j = ti; j < t.length; j++) { if (t[j] === ch) { found = j; break; } }
    if (found === -1) return 0;
    if (found === ti) { streak++; score += 2 + streak; } else { streak = 0; score += 1; }
    if (found === 0) score += 3; // prefix bonus
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter(query, items, getText) {
  if (!query) return items;
  return items
    .map(it => ({ it, s: fuzzyScore(query, getText(it)) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.it);
}
