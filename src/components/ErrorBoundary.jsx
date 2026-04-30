import { Component } from 'react'
import { isChunkLoadError, reloadOnceForStaleChunk } from '../lib/chunkReload'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, isChunkError: false }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error),
    }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
    // Stale-chunk fallback: if main.jsx's vite:preloadError handler
    // missed it (e.g. the failure surfaced inside a synchronous render
    // path of an already-loaded module that depends on a missing
    // chunk), reload here. Cooldown guards against loops.
    if (isChunkLoadError(error)) {
      reloadOnceForStaleChunk('ErrorBoundary')
    }
  }

  render() {
    if (this.state.hasError) {
      // For chunk-load errors: swap the warning UI for a "Loading the
      // latest version…" message. The reload is already in flight (or
      // suppressed by cooldown — in which case the manual button still
      // works since it bypasses the cooldown).
      const isChunk = this.state.isChunkError
      const title = isChunk ? 'Loading the latest version…' : 'Something went wrong'
      const body = isChunk
        ? 'A new version of the app was just deployed. Refreshing automatically — if this takes more than a few seconds, click below.'
        : (this.state.error?.message || 'An unexpected error occurred.')
      return (
        <div className="h-full flex items-center justify-center p-12">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-elevated max-w-md text-center p-8">
            <div className="text-4xl mb-4">{isChunk ? '🔄' : '⚠️'}</div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{title}</h2>
            <p className="text-slate-500 text-sm mb-4">{body}</p>
            <button
              onClick={() => {
                if (isChunk) {
                  // Explicit user click — force a reload bypassing the
                  // sessionStorage cooldown.
                  window.location.reload()
                } else {
                  this.setState({ hasError: false, error: null, isChunkError: false })
                }
              }}
              className="px-4 py-2 bg-brand-500 text-white rounded-xl text-sm font-semibold hover:bg-brand-600 transition-colors"
            >
              {isChunk ? 'Reload now' : 'Try Again'}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
