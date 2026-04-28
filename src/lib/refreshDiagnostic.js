// Tab-return refresh diagnostic. Activated by either:
//   • appending ?pe_debug=1 to the URL (sticks for the session via sessionStorage)
//   • setting window.__pe_debug = true in DevTools, then location.reload()
//
// When active:
//   • <DiagnosticProfiler id="…">…</DiagnosticProfiler> wrappers (in App.jsx)
//     log every commit to window.__pe_renders
//   • window.fetch is monkey-patched to log {url, method, t, status, durMs}
//     to window.__pe_fetches
//   • visibilitychange events log to window.__pe_visibility
//
// Helpers exposed on window:
//   • window.__pe_mark(label)              — push a labeled timestamp
//   • window.__pe_clear()                  — reset all logs
//   • window.__pe_dump()                   — pretty-print + return everything
//   • window.__pe_dump_since(label)        — filter to events after a mark
//   • window.__pe_summary()                — one-line counts per component
//
// The probe is a no-op when the flag is unset, so production users never pay
// for it. Once we've identified the cause, the flag stays in place behind
// VITE_PE_DEBUG so we can re-enable it in five minutes.

function isEnabled() {
  if (typeof window === 'undefined') return false
  if (window.__pe_debug === true) return true
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('pe_debug') === '1') {
      sessionStorage.setItem('__pe_debug', '1')
      window.__pe_debug = true
      return true
    }
    if (sessionStorage.getItem('__pe_debug') === '1') {
      window.__pe_debug = true
      return true
    }
  } catch { /* SSR / sandboxed */ }
  return false
}

// Module-level singletons. Cheap and shared across the app.
let installed = false
let originalFetch = null
let t0 = 0
const now = () => Math.round(performance.now() - t0)

export function installRefreshDiagnostic() {
  if (typeof window === 'undefined') return
  if (!isEnabled()) return
  if (installed) return
  installed = true

  window.__pe_renders   = window.__pe_renders   || []
  window.__pe_fetches   = window.__pe_fetches   || []
  window.__pe_visibility = window.__pe_visibility || []
  window.__pe_marks     = window.__pe_marks     || []

  t0 = performance.now()

  // ---- visibility log ----
  document.addEventListener('visibilitychange', () => {
    window.__pe_visibility.push({ t: now(), state: document.visibilityState })
  })

  // ---- fetch monkey-patch ----
  if (!originalFetch) originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const start = now()
    const url = typeof input === 'string' ? input : input?.url
    const method = (init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase()
    let status = 0
    try {
      const res = await originalFetch(input, init)
      status = res.status
      window.__pe_fetches.push({ t: start, durMs: now() - start, method, url, status })
      return res
    } catch (err) {
      window.__pe_fetches.push({ t: start, durMs: now() - start, method, url, status: -1, err: String(err) })
      throw err
    }
  }

  // ---- helpers ----
  window.__pe_mark = (label) => {
    const m = { t: now(), label: String(label) }
    window.__pe_marks.push(m)
    // eslint-disable-next-line no-console
    console.log('[pe-mark]', m.t, label)
    return m
  }

  window.__pe_clear = () => {
    window.__pe_renders = []
    window.__pe_fetches = []
    window.__pe_visibility = []
    window.__pe_marks = []
    // eslint-disable-next-line no-console
    console.log('[pe] cleared diagnostic logs')
  }

  window.__pe_summary = () => {
    const counts = {}
    for (const r of window.__pe_renders || []) {
      counts[r.id] = (counts[r.id] || 0) + 1
    }
    const fetches = (window.__pe_fetches || []).length
    const vis = window.__pe_visibility || []
    const result = {
      totalRenders: (window.__pe_renders || []).length,
      perComponent: counts,
      totalFetches: fetches,
      visibilityFlips: vis.length,
      lastVisibility: vis[vis.length - 1],
    }
    // eslint-disable-next-line no-console
    console.table(counts)
    // eslint-disable-next-line no-console
    console.log('[pe-summary]', result)
    return result
  }

  window.__pe_dump = () => {
    const data = {
      renders: window.__pe_renders || [],
      fetches: window.__pe_fetches || [],
      visibility: window.__pe_visibility || [],
      marks: window.__pe_marks || [],
    }
    // eslint-disable-next-line no-console
    console.log('[pe-dump]', data)
    return data
  }

  window.__pe_dump_since = (label) => {
    const marks = window.__pe_marks || []
    const m = [...marks].reverse().find(x => x.label === label)
    if (!m) {
      // eslint-disable-next-line no-console
      console.warn('[pe] no mark found for label:', label)
      return null
    }
    const since = m.t
    return {
      since: m,
      renders:    (window.__pe_renders    || []).filter(r => r.t >= since),
      fetches:    (window.__pe_fetches    || []).filter(f => f.t >= since),
      visibility: (window.__pe_visibility || []).filter(v => v.t >= since),
    }
  }

  // eslint-disable-next-line no-console
  console.log('[pe] refresh diagnostic ACTIVE. helpers: __pe_mark(label), __pe_clear(), __pe_summary(), __pe_dump(), __pe_dump_since(label)')
}

// Called by React.Profiler onRender. Cheap when disabled.
export function logRender(id, phase, actualDuration) {
  if (typeof window === 'undefined' || !window.__pe_debug) return
  if (!window.__pe_renders) window.__pe_renders = []
  window.__pe_renders.push({
    t: now(),
    id,
    phase,
    durMs: Math.round(actualDuration * 100) / 100,
  })
}
