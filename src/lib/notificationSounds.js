// Synthesized notification sounds — no audio assets to bundle or host.
// Uses the Web Audio API directly. Users can pick between several curated
// presets per channel and set a shared volume level (soft/medium/loud).
//
// Preferences live in localStorage:
//   pe-sound-task            "1" | "0"      (default enabled)
//   pe-sound-message         "1" | "0"      (default enabled)
//   pe-sound-task-preset     preset id       (default "chime")
//   pe-sound-message-preset  preset id       (default "pop")
//   pe-sound-volume          "soft"|"medium"|"loud"  (default "medium")

const KEY_TASK            = 'pe-sound-task'
const KEY_MESSAGE         = 'pe-sound-message'
const KEY_TASK_PRESET     = 'pe-sound-task-preset'
const KEY_MESSAGE_PRESET  = 'pe-sound-message-preset'
const KEY_VOLUME          = 'pe-sound-volume'

export const SOUND_PREF_KEYS = {
  task: KEY_TASK,
  message: KEY_MESSAGE,
  taskPreset: KEY_TASK_PRESET,
  messagePreset: KEY_MESSAGE_PRESET,
  volume: KEY_VOLUME,
}

// ── Presets ──────────────────────────────────────────────────────────────
// Each preset is a sequence of tones with relative start offsets (seconds).
// `peak` is the 0-1 gain of the envelope apex before the volume multiplier
// is applied. Defaults: peak 0.18, type 'sine', dur inferred per entry.

const TASK_PRESETS = {
  chime: {
    label: 'Chime',
    tones: [
      { freq: 660, start: 0.00, dur: 0.09, peak: 0.18 },
      { freq: 880, start: 0.09, dur: 0.13, peak: 0.18 },
    ],
  },
  ding: {
    label: 'Ding',
    tones: [
      { freq: 1040, start: 0.00, dur: 0.22, peak: 0.20, type: 'triangle' },
    ],
  },
  alert: {
    label: 'Alert',
    tones: [
      { freq: 880, start: 0.00, dur: 0.08, peak: 0.22 },
      { freq: 740, start: 0.10, dur: 0.08, peak: 0.22 },
      { freq: 620, start: 0.20, dur: 0.14, peak: 0.22 },
    ],
  },
  bell: {
    label: 'Bell',
    tones: [
      { freq: 784, start: 0.00, dur: 0.42, peak: 0.20, type: 'triangle' },
      { freq: 1568, start: 0.00, dur: 0.20, peak: 0.08, type: 'sine' },
    ],
  },
  klaxon: {
    label: 'Klaxon (loud)',
    tones: [
      { freq: 520, start: 0.00, dur: 0.14, peak: 0.30, type: 'square' },
      { freq: 720, start: 0.14, dur: 0.14, peak: 0.30, type: 'square' },
      { freq: 520, start: 0.28, dur: 0.14, peak: 0.30, type: 'square' },
    ],
  },
}

const MESSAGE_PRESETS = {
  pop: {
    label: 'Pop',
    tones: [
      { freq: 520, start: 0.00, dur: 0.14, peak: 0.14 },
    ],
  },
  blip: {
    label: 'Blip',
    tones: [
      { freq: 1000, start: 0.00, dur: 0.07, peak: 0.16 },
    ],
  },
  tap: {
    label: 'Double tap',
    tones: [
      { freq: 380, start: 0.00, dur: 0.05, peak: 0.14 },
      { freq: 380, start: 0.09, dur: 0.05, peak: 0.14 },
    ],
  },
  ping: {
    label: 'Ping',
    tones: [
      { freq: 1320, start: 0.00, dur: 0.18, peak: 0.14, type: 'sine' },
    ],
  },
  whistle: {
    label: 'Whistle (loud)',
    tones: [
      { freq: 880, start: 0.00, dur: 0.09, peak: 0.26 },
      { freq: 1320, start: 0.09, dur: 0.12, peak: 0.26 },
    ],
  },
}

export const TASK_PRESET_OPTIONS = Object.entries(TASK_PRESETS)
  .map(([id, p]) => ({ id, label: p.label }))
export const MESSAGE_PRESET_OPTIONS = Object.entries(MESSAGE_PRESETS)
  .map(([id, p]) => ({ id, label: p.label }))

const VOLUME_MULTIPLIERS = { soft: 0.55, medium: 1.0, loud: 1.7 }
export const VOLUME_OPTIONS = [
  { id: 'soft',   label: 'Soft' },
  { id: 'medium', label: 'Medium' },
  { id: 'loud',   label: 'Loud' },
]

// ── Prefs ────────────────────────────────────────────────────────────────
function readRaw(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
export function writePref(key, value) {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}

function readBoolPref(key) {
  const v = readRaw(key)
  return v === null ? true : v === '1'
}
export function writeBoolPref(key, enabled) {
  writePref(key, enabled ? '1' : '0')
}

export function isTaskSoundEnabled()    { return readBoolPref(KEY_TASK) }
export function isMessageSoundEnabled() { return readBoolPref(KEY_MESSAGE) }

export function getTaskPreset() {
  const v = readRaw(KEY_TASK_PRESET)
  return v && TASK_PRESETS[v] ? v : 'chime'
}
export function getMessagePreset() {
  const v = readRaw(KEY_MESSAGE_PRESET)
  return v && MESSAGE_PRESETS[v] ? v : 'pop'
}
export function getVolume() {
  const v = readRaw(KEY_VOLUME)
  return v && VOLUME_MULTIPLIERS[v] != null ? v : 'medium'
}

// ── Playback ─────────────────────────────────────────────────────────────
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

function playTone({ freq, start = 0, dur = 0.12, peak = 0.18, type = 'sine' }, volumeMul = 1) {
  const ac = getCtx()
  if (!ac) return
  if (ac.state === 'suspended') ac.resume().catch(() => {})
  const now = ac.currentTime + start
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  const p = Math.max(0, Math.min(1, peak * volumeMul))
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(p, now + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  osc.connect(gain).connect(ac.destination)
  osc.start(now)
  osc.stop(now + dur + 0.02)
}

function playPreset(preset, volumeMul) {
  if (!preset) return
  for (const tone of preset.tones) playTone(tone, volumeMul)
}

function volumeMul(volId) {
  return VOLUME_MULTIPLIERS[volId] ?? 1
}

// ── Public API ───────────────────────────────────────────────────────────
export function playTaskSound() {
  if (!isTaskSoundEnabled()) return
  playPreset(TASK_PRESETS[getTaskPreset()], volumeMul(getVolume()))
}
export function playMessageSound() {
  if (!isMessageSoundEnabled()) return
  playPreset(MESSAGE_PRESETS[getMessagePreset()], volumeMul(getVolume()))
}

// Previews bypass the enabled flag. Callers may pass overrides so the
// Settings UI can demo a preset/volume before the user commits to it.
export function previewTaskSound(presetId = getTaskPreset(), volumeId = getVolume()) {
  playPreset(TASK_PRESETS[presetId] || TASK_PRESETS.chime, volumeMul(volumeId))
}
export function previewMessageSound(presetId = getMessagePreset(), volumeId = getVolume()) {
  playPreset(MESSAGE_PRESETS[presetId] || MESSAGE_PRESETS.pop, volumeMul(volumeId))
}
