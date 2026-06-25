import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// A long board column / list section is capped to this many rows; the rest hide
// behind a "Show all" toggle so an imported 100+ item backlog stays glanceable.
export const COLUMN_CAP = 8

// Render-prop list: shows at most COLUMN_CAP items with an expand/collapse
// toggle. `items` is the full array; `children` is (item, index) => node.
export function CappedList({ items, children, buttonClassName = '' }) {
  const [expanded, setExpanded] = useState(false)
  const total = items.length
  const shown = expanded ? items : items.slice(0, COLUMN_CAP)
  return (
    <>
      {shown.map(children)}
      {total > COLUMN_CAP && (
        <ShowMoreRow
          expanded={expanded}
          total={total}
          onToggle={() => setExpanded(v => !v)}
          className={buttonClassName}
        />
      )}
    </>
  )
}

// The toggle row. Used standalone where the caller manages its own slice (the
// drag-and-drop board columns, which need expanded state alongside their cards).
export function ShowMoreRow({ expanded, total, onToggle, className = '' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={`w-full py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 inline-flex items-center justify-center gap-1 ${className}`}
    >
      {expanded
        ? <>Show less <ChevronUp size={13} /></>
        : <>Show all {total} <ChevronDown size={13} /></>}
    </button>
  )
}
