import { createContext, useContext, useCallback, useEffect, useState } from 'react'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'pe-theme'

// Reads the stored mode. We persist the literal mode string:
//   'light' | 'dark'  → explicit override
//   'system'          → follow prefers-color-scheme live
// A missing/legacy value defaults to 'system'. (Older builds wrote only
// 'light'/'dark'; those still parse as explicit, preserving prior behavior.)
function readStoredMode() {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch { /* storage disabled */ }
  return 'system'
}

function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// Resolve the effective dark boolean for a given mode.
function resolveDark(mode) {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemPrefersDark() // 'system'
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredMode)
  const [dark, setDark] = useState(() => resolveDark(readStoredMode()))

  // Apply the effective dark class + persist the mode whenever either changes.
  useEffect(() => {
    const root = document.documentElement
    if (dark) root.classList.add('dark')
    else root.classList.remove('dark')
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch { /* storage disabled */ }
  }, [dark, mode])

  // When following the OS, recompute `dark` immediately and subscribe to live
  // OS changes. In explicit modes there is no listener and `dark` is fixed.
  useEffect(() => {
    if (mode !== 'system') {
      setDark(mode === 'dark')
      return
    }
    setDark(systemPrefersDark())
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e) => setDark(e.matches)
    // addEventListener is the modern API; fall back to addListener for old WebKit.
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [mode])

  const setMode = useCallback((next) => {
    if (next === 'light' || next === 'dark' || next === 'system') {
      setModeState(next)
    }
  }, [])

  // Existing global toggle: flips to an EXPLICIT mode based on the current
  // effective dark state (preserves the previous one-button UX).
  const toggle = useCallback(() => {
    setModeState(dark ? 'light' : 'dark')
  }, [dark])

  return (
    <ThemeContext.Provider value={{ dark, mode, toggle, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
