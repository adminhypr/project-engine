// Auto-recovery for stale lazy-chunk imports after a deploy.
//
// Vercel rebuilds → asset filenames change (content-hashed) → existing
// browser tabs holding the OLD index.html still try to fetch the OLD
// chunk URLs → 404 → the lazy `import()` rejects → user sees
// "Failed to fetch dynamically imported module: …/TeamChatPage-XXX.js".
//
// This helper provides a single place to trigger a one-shot reload
// guarded by a sessionStorage cooldown so we can't loop forever (e.g.
// if reload itself also fails because the network is genuinely down).

const RELOAD_TIMESTAMP_KEY = 'pe-chunk-reload-at'
const RELOAD_COOLDOWN_MS   = 10_000  // 10s between reloads, max

/**
 * Reload the page once unless we already reloaded within the cooldown
 * window. Returns true if a reload was triggered, false if suppressed.
 */
export function reloadOnceForStaleChunk(reason) {
  if (typeof window === 'undefined') return false
  let last = 0
  try { last = Number(window.sessionStorage.getItem(RELOAD_TIMESTAMP_KEY) || 0) } catch {}
  if (Date.now() - last < RELOAD_COOLDOWN_MS) {
    console.warn(`[chunk-reload] suppressed (${reason}): already reloaded within ${RELOAD_COOLDOWN_MS}ms`)
    return false
  }
  try { window.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now())) } catch {}
  console.warn(`[chunk-reload] reloading (${reason})`)
  window.location.reload()
  return true
}

/**
 * Heuristic: does this error look like a stale-chunk / failed-import
 * error that a reload would fix?
 */
export function isChunkLoadError(error) {
  if (!error) return false
  const name = String(error.name || '')
  const msg  = String(error.message || error)
  if (name === 'ChunkLoadError') return true
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    /Loading chunk \S+ failed/.test(msg) ||
    msg.includes('error loading dynamically imported module')
  )
}
