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

// Light, soft gradient presets — chosen to blend well with chat text (dark text
// in light mode; under the readability scrim they stay legible in dark mode too).
// Keys are kept stable (the `neon-*` prefix is historical) so any already-set
// conversation just picks up the lighter gradient. Each `background` is a
// complete CSS background shorthand (drop straight onto `style={{ background }}`).
export const WALLPAPER_PRESETS = [
  {
    key: 'neon-aurora',
    label: 'Aurora',
    background:
      'linear-gradient(135deg, #dbeafe 0%, #e0e7ff 50%, #cffafe 100%)',
  },
  {
    key: 'neon-sunset',
    label: 'Sunset',
    background:
      'linear-gradient(135deg, #ffe4e6 0%, #fee2d5 55%, #fef3c7 100%)',
  },
  {
    key: 'neon-mint',
    label: 'Mint',
    background:
      'linear-gradient(135deg, #d1fae5 0%, #ccfbf1 50%, #cffafe 100%)',
  },
  {
    key: 'neon-grape',
    label: 'Grape',
    background:
      'linear-gradient(135deg, #ede9fe 0%, #f3e8ff 50%, #fae8ff 100%)',
  },
  {
    key: 'neon-ember',
    label: 'Ember',
    background:
      'linear-gradient(135deg, #fee2e2 0%, #ffedd5 55%, #fef9c3 100%)',
  },
  {
    key: 'soft-cloud',
    label: 'Cloud',
    background:
      'linear-gradient(135deg, #f8fafc 0%, #eef2f7 50%, #e6ebf3 100%)',
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
