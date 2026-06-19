import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, ListFilter, MoreVertical } from 'lucide-react'

// Collapsible Slack-style sidebar section. Collapse state persists per-title to
// localStorage under `pe-slack-sec-{title}`.
//
// Props:
//   title       — section header text (rendered title-case-ish, 13px/700)
//   defaultOpen — initial open state when nothing is persisted (default true)
//   children    — the rows
//
// Optional hover-revealed header actions (Slack parity). Only rendered when the
// corresponding prop is supplied — no dead controls:
//   onAdd()     — "+" button (e.g. create channel / start DM)
//   onFilter()  — find / filter button (ListFilter icon)
//   headerMenu  — array of { label, onClick } → "⋯" kebab opening a small popover

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

export default function SidebarSection({
  title,
  defaultOpen = true,
  children,
  onAdd,
  onFilter,
  headerMenu,
}) {
  const [open, setOpen] = useState(() => readOpen(title, defaultOpen))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev
      try { localStorage.setItem(storageKey(title), next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }, [title])

  // Close the kebab popover on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const hasMenu = Array.isArray(headerMenu) && headerMenu.length > 0
  const stop = (e) => e.stopPropagation()

  const actionBtn =
    'grid place-items-center w-5 h-5 rounded text-white/50 hover:text-white hover:bg-white/10 opacity-0 group-hover/sec:opacity-100 focus:opacity-100 focus:outline-none'

  return (
    <div className="mt-4 first:mt-2 mb-1">
      <div className="group/sec relative flex items-center pr-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-1 px-3 py-0.5 text-sidebar-hdr font-bold text-white/55 hover:text-white/80 select-none"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <span className="truncate">{title}</span>
        </button>

        <div className="flex items-center gap-0.5">
          {onFilter && (
            <button
              type="button"
              aria-label={`Filter ${title}`}
              title="Filter"
              onClick={(e) => { stop(e); onFilter() }}
              className={actionBtn}
            >
              <ListFilter className="w-3.5 h-3.5" />
            </button>
          )}
          {onAdd && (
            <button
              type="button"
              aria-label={`Add to ${title}`}
              title="Add"
              onClick={(e) => { stop(e); onAdd() }}
              className={actionBtn}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          {hasMenu && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-label={`More actions for ${title}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="More"
                onClick={(e) => { stop(e); setMenuOpen(o => !o) }}
                className={`${actionBtn} ${menuOpen ? 'opacity-100' : ''}`}
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-6 z-20 min-w-[160px] py-1 rounded-md bg-slack-sidebar border border-white/10 shadow-elevated"
                >
                  {headerMenu.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      onClick={(e) => { stop(e); setMenuOpen(false); item.onClick?.() }}
                      className="w-full text-left px-3 py-1.5 text-[13px] text-white/80 hover:bg-white/10"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {open && <div className="flex flex-col gap-px mt-0.5">{children}</div>}
    </div>
  )
}
