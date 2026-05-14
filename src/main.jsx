import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import './index.css'
import { installRefreshDiagnostic } from './lib/refreshDiagnostic'
import { reloadOnceForStaleChunk, isChunkLoadError } from './lib/chunkReload'

installRefreshDiagnostic()

// Sentry init — gated on VITE_SENTRY_DSN so local builds without the
// env var stay silent. Errors flow through Sentry → sentry-to-campfire
// edge function → "Errors" campfire in Systems Development hub.
// See docs/plans/2026-05-14-sentry-campfire-design.md.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Stale-chunk errors are expected post-deploy noise. The
    // vite:preloadError handler below + the ErrorBoundary already
    // handle them with a reload; no point spamming Sentry.
    beforeSend(event, hint) {
      const err = hint?.originalException
      if (err && isChunkLoadError(err)) return null
      return event
    },
    // Capture browser performance + tracing but at a conservative
    // sample rate — free tier is 5k events/month.
    tracesSampleRate: 0.1,
  })
}

// Vite emits `vite:preloadError` whenever a module preload fails (the
// typical post-deploy stale-chunk scenario: the existing tab has the
// OLD index.html pointing at OLD content-hashed asset URLs that no
// longer exist after a Vercel rebuild). Recommended fix per Vite docs:
// reload so the browser fetches the new index.html with the new asset
// map. Cooldown-guarded so we don't reload-loop if the network is
// genuinely down.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    const reloaded = reloadOnceForStaleChunk('vite:preloadError')
    if (reloaded) event.preventDefault?.()
    // If suppressed (cooldown), let the error propagate so ErrorBoundary
    // shows the manual retry UI.
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
