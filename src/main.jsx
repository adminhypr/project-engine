import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { installRefreshDiagnostic } from './lib/refreshDiagnostic'
import { reloadOnceForStaleChunk } from './lib/chunkReload'

installRefreshDiagnostic()

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
