// Pure helpers for card grouping/sorting. Mirrors the shape of
// hub_modules helpers in src/hooks/useHubModules.js but column ids are
// dynamic (one per hub_card_columns row), not the fixed three-column
// constant from the module grid.

export function sortCards(arr) {
  arr.sort((a, b) =>
    ((a.position ?? 0) - (b.position ?? 0)) ||
    a.id.localeCompare(b.id)
  )
  return arr
}

export function groupCardsByColumn(cards, columnIds) {
  const out = {}
  for (const id of columnIds) out[id] = []
  for (const c of cards) {
    if (out[c.column_id]) out[c.column_id].push(c)
  }
  for (const id of columnIds) sortCards(out[id])
  return out
}
