import { useRef, useState, useCallback, useEffect } from 'react'
import { Play, Pause, Music2 } from 'lucide-react'
import { formatFileSize } from '../../lib/chatAttachments'

// Custom inline audio player for chat attachments. We drive a hidden <audio>
// element via refs and render our own play/pause, scrubber, time readout, and
// playback-speed toggle so the chrome matches the chat (dark-mode aware) rather
// than the browser default. Width caps at ~420px to sit inside a message column.

const SPEEDS = [1, 1.5, 2]

function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function AudioPlayer({ src, name, size }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [ready, setReady] = useState(false)

  // Sync playback rate whenever the speed toggle changes.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIdx]
  }, [speedIdx])

  const togglePlay = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [])

  const onTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrent(audioRef.current.currentTime)
  }, [])

  const onLoadedMeta = useCallback(() => {
    const el = audioRef.current
    if (el && isFinite(el.duration)) setDuration(el.duration)
    setReady(true)
  }, [])

  const onSeek = useCallback((e) => {
    const el = audioRef.current
    if (!el) return
    const t = Number(e.target.value)
    el.currentTime = t
    setCurrent(t)
  }, [])

  const cycleSpeed = useCallback(() => {
    setSpeedIdx(i => (i + 1) % SPEEDS.length)
  }, [])

  const pct = duration > 0 ? (current / duration) * 100 : 0

  return (
    <div className="mt-2 w-full max-w-[420px] rounded-xl border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50 p-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMeta}
        className="hidden"
      />

      {/* File name + size */}
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Music2 className="w-4 h-4 text-brand-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
          {name || 'Audio'}
        </span>
        {size != null && (
          <span className="text-xs text-slate-400 shrink-0">{formatFileSize(size)}</span>
        )}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="w-9 h-9 shrink-0 grid place-items-center rounded-full bg-brand-600 hover:bg-brand-700 text-white transition-colors"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        <input
          type="range"
          min={0}
          max={duration || 0}
          step="0.1"
          value={current}
          onChange={onSeek}
          disabled={!ready || duration === 0}
          aria-label="Seek"
          className="flex-1 h-1.5 appearance-none rounded-full cursor-pointer bg-slate-200 dark:bg-dark-border accent-brand-600"
          style={{
            background: `linear-gradient(to right, var(--chat-accent, #4f46e5) ${pct}%, transparent ${pct}%)`,
          }}
        />

        <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400 shrink-0 w-[72px] text-right">
          {fmtTime(current)} / {fmtTime(duration)}
        </span>

        <button
          type="button"
          onClick={cycleSpeed}
          aria-label="Playback speed"
          title="Playback speed"
          className="shrink-0 px-2 py-1 rounded-md text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-200/70 dark:bg-white/10 hover:bg-slate-300/70 dark:hover:bg-white/20 transition-colors"
        >
          {SPEEDS[speedIdx]}x
        </button>
      </div>
    </div>
  )
}
