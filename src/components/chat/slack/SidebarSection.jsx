import { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// Collapsible Slack-style sidebar section. Collapse state persists per-title to
// localStorage under `pe-slack-sec-{title}`.
//
// Props:
//   title       — section header text (rendered title-case-ish, 13px/700)
//   defaultOpen — initial open state when nothing is persisted (default true)
//   children    — the rows

function storageKey(title) {
  return `pe-slack-sec-${title}`
}

function readOpen(title, fallback) {
  try {
    const raw = localStorage.getItem(storageKey(title))
    if (raw === null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

export default function SidebarSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(() => readOpen(title, defaultOpen))

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev
      try { localStorage.setItem(storageKey(title), next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }, [title])

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1 px-3 py-1 text-sidebar-hdr font-bold text-white/50 hover:text-white/80 select-none"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span>{title}</span>
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </div>
  )
}
