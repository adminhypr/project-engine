import { useRef } from 'react'
import { X, Upload, Trash2, Loader2, Check } from 'lucide-react'
import { ModalWrapper } from '../../ui/animations'
import { WALLPAPER_PRESETS, parseWallpaper } from '../../../lib/chatWallpaper'

/**
 * Modal to set the SHARED wallpaper for a conversation (migration 107).
 * Whoever changes it changes it for everyone in the conversation.
 *
 * Props:
 *   isOpen, onClose
 *   wallpaper          — current stored value ('preset:<key>' | 'upload:<path>' | null)
 *   busy               — write/upload in flight
 *   onSetPreset(key)   — apply a neon preset
 *   onUploadImage(file)— upload + apply an image
 *   onRemove()         — clear the wallpaper
 */
export default function WallpaperPicker({
  isOpen,
  onClose,
  wallpaper,
  busy,
  onSetPreset,
  onUploadImage,
  onRemove,
}) {
  const fileRef = useRef(null)
  const parsed = parseWallpaper(wallpaper)
  const activePresetKey = parsed?.type === 'preset' ? parsed.value : null
  const hasWallpaper = !!parsed

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (file) onUploadImage?.(file)
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-md card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-dark-border">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Chat wallpaper</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-2.5">
            {WALLPAPER_PRESETS.map((p) => {
              const active = activePresetKey === p.key
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={busy}
                  onClick={() => onSetPreset?.(p.key)}
                  className={`relative h-20 rounded-lg overflow-hidden ring-2 transition disabled:opacity-60 ${
                    active
                      ? 'ring-brand-500'
                      : 'ring-transparent hover:ring-slate-300 dark:hover:ring-dark-border'
                  }`}
                  style={{ background: p.background }}
                  title={p.label}
                  aria-label={`Set ${p.label} wallpaper`}
                  aria-pressed={active}
                >
                  {active && (
                    <span className="absolute top-1.5 right-1.5 grid place-items-center w-5 h-5 rounded-full bg-brand-600 text-white shadow-soft">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  )}
                  {/* Dark label — the presets are light, so dark text + a soft
                      light halo stays readable on every swatch. */}
                  <span className="absolute bottom-1 left-2 text-[11px] font-semibold text-slate-700 [text-shadow:0_1px_2px_rgba(255,255,255,0.65)]">
                    {p.label}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="btn btn-secondary flex items-center gap-1.5 disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload image
            </button>
            {hasWallpaper && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove?.()}
                className="btn btn-secondary flex items-center gap-1.5 text-red-600 dark:text-red-400 disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Changes the wallpaper for everyone here.
          </p>
        </div>
      </div>
    </ModalWrapper>
  )
}
