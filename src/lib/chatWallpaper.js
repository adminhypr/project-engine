// Per-conversation SHARED chat wallpaper (migration 107).
//
// The stored value (conversations.wallpaper) is a scheme-prefixed string:
//   'preset:<key>'  → one of WALLPAPER_PRESETS below (a CSS gradient)
//   'upload:<path>' → a dm-attachments object path, signed at render time
//   null            → no wallpaper (theme default)
//
// resolveWallpaperBackground() turns a stored value (+ an optional signed URL
// for the upload case) into a CSS `background` value, or null when there's
// nothing to render. Kept pure so it can be unit-tested without Supabase.

// Five neon gradient presets. Each `background` is a complete CSS background
// shorthand value (drop it straight onto `style={{ background }}`).
export const WALLPAPER_PRESETS = [
  {
    key: 'neon-aurora',
    label: 'Aurora',
    background:
      'linear-gradient(135deg, #7f00ff 0%, #2b5dff 45%, #00e5ff 100%)',
  },
  {
    key: 'neon-sunset',
    label: 'Sunset',
    background:
      'linear-gradient(135deg, #ff007a 0%, #ff5e3a 55%, #ffb347 100%)',
  },
  {
    key: 'neon-mint',
    label: 'Mint',
    background:
      'linear-gradient(135deg, #00ffa3 0%, #00d4c8 50%, #0fa968 100%)',
  },
  {
    key: 'neon-grape',
    label: 'Grape',
    background:
      'linear-gradient(135deg, #4b0082 0%, #6a00f4 50%, #b14aff 100%)',
  },
  {
    key: 'neon-ember',
    label: 'Ember',
    background:
      'linear-gradient(135deg, #ff1744 0%, #ff6d00 55%, #ffc400 100%)',
  },
]

const PRESET_BY_KEY = new Map(WALLPAPER_PRESETS.map((p) => [p.key, p]))

export function getPresetByKey(key) {
  return PRESET_BY_KEY.get(key) || null
}

// Parse a stored wallpaper value into { type, value }.
//   'preset:neon-aurora'  → { type: 'preset', value: 'neon-aurora' }
//   'upload:abc/def.jpg'  → { type: 'upload', value: 'abc/def.jpg' }
//   null / ''             → null
//   anything else         → null (unknown scheme; treated as no wallpaper)
export function parseWallpaper(wallpaper) {
  if (!wallpaper || typeof wallpaper !== 'string') return null
  const idx = wallpaper.indexOf(':')
  if (idx <= 0) return null
  const type = wallpaper.slice(0, idx)
  const value = wallpaper.slice(idx + 1)
  if (type === 'preset') return value ? { type, value } : null
  if (type === 'upload') return value ? { type, value } : null
  return null
}

// Returns a CSS `background` value for the given stored wallpaper, or null.
//   - preset → the gradient string.
//   - upload → `url(<signedUrl>) center/cover no-repeat` when signedUrl is
//              supplied, else null (caller hasn't signed the path yet).
//   - null / unknown / unknown-preset-key → null.
export function resolveWallpaperBackground(wallpaper, signedUrl) {
  const parsed = parseWallpaper(wallpaper)
  if (!parsed) return null
  if (parsed.type === 'preset') {
    const preset = getPresetByKey(parsed.value)
    return preset ? preset.background : null
  }
  if (parsed.type === 'upload') {
    return signedUrl ? `url("${signedUrl}") center / cover no-repeat` : null
  }
  return null
}
