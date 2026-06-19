import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '../useTheme'

// Controllable matchMedia mock for '(prefers-color-scheme: dark)'.
let mediaMatches = false
let changeHandlers = []

function installMatchMedia() {
  changeHandlers = []
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mediaMatches,
    media: query,
    addEventListener: (_e, cb) => changeHandlers.push(cb),
    removeEventListener: (_e, cb) => {
      changeHandlers = changeHandlers.filter((h) => h !== cb)
    },
    addListener: (cb) => changeHandlers.push(cb),
    removeListener: (cb) => {
      changeHandlers = changeHandlers.filter((h) => h !== cb)
    },
  }))
}

function emitOsChange(next) {
  mediaMatches = next
  act(() => {
    changeHandlers.forEach((cb) => cb({ matches: next }))
  })
}

// Capture the hook value through a probe component.
let captured = null
function Probe() {
  captured = useTheme()
  return null
}

function renderTheme() {
  captured = null
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  )
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    mediaMatches = false
    installMatchMedia()
  })
  afterEach(() => {
    captured = null
  })

  it('defaults to system mode and follows prefers-color-scheme on first load', () => {
    mediaMatches = true
    renderTheme()
    expect(captured.mode).toBe('system')
    expect(captured.dark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('pe-theme')).toBe('system')
  })

  it('system mode follows live OS changes', () => {
    mediaMatches = false
    renderTheme()
    expect(captured.dark).toBe(false)
    emitOsChange(true)
    expect(captured.dark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setMode persists explicit light/dark and ignores OS changes', () => {
    mediaMatches = false
    renderTheme()
    act(() => captured.setMode('dark'))
    expect(captured.mode).toBe('dark')
    expect(captured.dark).toBe(true)
    expect(localStorage.getItem('pe-theme')).toBe('dark')
    // OS flips to light — explicit dark stays put.
    emitOsChange(false)
    expect(captured.dark).toBe(true)
  })

  it('reload with stored system + OS dark resolves dark (bug fix)', () => {
    localStorage.setItem('pe-theme', 'system')
    mediaMatches = true
    renderTheme()
    expect(captured.mode).toBe('system')
    expect(captured.dark).toBe(true)
  })

  it('toggle() flips to an explicit mode based on effective dark state', () => {
    mediaMatches = false
    renderTheme()
    expect(captured.dark).toBe(false)
    act(() => captured.toggle())
    expect(captured.mode).toBe('dark')
    expect(captured.dark).toBe(true)
    act(() => captured.toggle())
    expect(captured.mode).toBe('light')
    expect(captured.dark).toBe(false)
  })

  it('legacy stored "dark" parses as explicit dark', () => {
    localStorage.setItem('pe-theme', 'dark')
    mediaMatches = false
    renderTheme()
    expect(captured.mode).toBe('dark')
    expect(captured.dark).toBe(true)
  })
})
