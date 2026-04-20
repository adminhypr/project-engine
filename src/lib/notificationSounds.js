// Synthesized notification sounds — no audio assets to bundle or host.
// Uses the Web Audio API directly. Each sound is a short enveloped tone
// pair so it reads as a distinct chime but is quiet enough not to annoy.
//
// Preferences live in localStorage:
//   pe-sound-task      "1" | "0"   (default: enabled)
//   pe-sound-message   "1" | "0"   (default: enabled)

const KEY_TASK    = 'pe-sound-task'
const KEY_MESSAGE = 'pe-sound-message'

export const SOUND_PREF_KEYS = { task: KEY_TASK, message: KEY_MESSAGE }

function readPref(key) {
  try {
    const v = localStorage.getItem(key)
    // Default to enabled when unset.
    return v === null ? true : v === '1'
  } catch { return true }
}

export function writePref(key, enabled) {
  try { localStorage.setItem(key, enabled ? '1' : '0') } catch { /* noop */ }
}

export function isTaskSoundEnabled()    { return readPref(KEY_TASK) }
export function isMessageSoundEnabled() { return readPref(KEY_MESSAGE) }

// Lazy-initialize AudioContext — many browsers require it be created after a
// user gesture; we do it on first play. If the page is in the background
// when the first tone would play, the context may be in 'suspended' state
// and the tone is silently dropped (acceptable).
let ctx = null
function getCtx() {
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  } catch { ctx = null }
  return ctx
}

// Play one short enveloped tone. Caller schedules sequences with offsets.
function tone({ freq, start = 0, dur = 0.12, peak = 0.18, type = 'sine' }) {
  const ac = getCtx()
  if (!ac) return
  // Resume on demand — interactive apps often land here after user input.
  if (ac.state === 'suspended') ac.resume().catch(() => {})
  const now = ac.currentTime + start
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  // ADSR-ish envelope: quick attack, medium decay, silent tail.
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  osc.connect(gain).connect(ac.destination)
  osc.start(now)
  osc.stop(now + dur + 0.02)
}

export function playTaskSound() {
  if (!isTaskSoundEnabled()) return
  // Two-note ascending chime — reads as "new task".
  tone({ freq: 660, start: 0.00, dur: 0.09, peak: 0.16 })
  tone({ freq: 880, start: 0.09, dur: 0.13, peak: 0.16 })
}

export function playMessageSound() {
  if (!isMessageSoundEnabled()) return
  // Single softer tone — reads as "new message".
  tone({ freq: 520, start: 0.00, dur: 0.14, peak: 0.12 })
}

// Test helpers so the Settings card can preview a sound when the user
// toggles it on (bypasses the enabled check).
export function previewTaskSound() {
  tone({ freq: 660, start: 0.00, dur: 0.09, peak: 0.16 })
  tone({ freq: 880, start: 0.09, dur: 0.13, peak: 0.16 })
}
export function previewMessageSound() {
  tone({ freq: 520, start: 0.00, dur: 0.14, peak: 0.12 })
}
