import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { CappedList } from './CappedList'

// monday.com-style colored group tokens. Tailwind can't purge-safely build
// class names from variables, so each semantic color is a fixed bundle of full
// class strings: `bar` (left accent), `dot`, `text`, `soft` (group-header bg),
// `solid` (filled status pill).
export const GROUP_COLORS = {
  slate:   { bar: 'border-l-slate-400',   dot: 'bg-slate-400',   text: 'text-slate-500 dark:text-slate-300',    soft: 'bg-slate-50 dark:bg-white/[0.03]',     solid: 'bg-slate-400' },
  blue:    { bar: 'border-l-blue-500',    dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-300',       soft: 'bg-blue-50 dark:bg-blue-500/10',       solid: 'bg-blue-500' },
  amber:   { bar: 'border-l-amber-500',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-300',     soft: 'bg-amber-50 dark:bg-amber-500/10',     solid: 'bg-amber-500' },
  orange:  { bar: 'border-l-orange-500',  dot: 'bg-orange-500',  text: 'text-orange-600 dark:text-orange-300',   soft: 'bg-orange-50 dark:bg-orange-500/10',   solid: 'bg-orange-500' },
  red:     { bar: 'border-l-red-500',     dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-300',         soft: 'bg-red-50 dark:bg-red-500/10',         solid: 'bg-red-500' },
  emerald: { bar: 'border-l-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-300', soft: 'bg-emerald-50 dark:bg-emerald-500/10', solid: 'bg-emerald-500' },
}

// Round member avatar — image if present, else a brand-colored initial.
export function Avatar({ profile, size = 24 }) {
  const name = profile?.full_name || '—'
  const px = `${size}px`
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" title={name} className="rounded-full object-cover ring-1 ring-black/5" style={{ width: px, height: px }} />
  }
  return (
    <span
      title={name}
      className={`rounded-full grid place-items-center ring-1 ring-black/5 font-semibold ${profile ? 'bg-brand-500 text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`}
      style={{ width: px, height: px, fontSize: Math.round(size * 0.42) }}
    >
      {profile ? name.charAt(0).toUpperCase() : '–'}
    </span>
  )
}

// Filled, monday-style status pill (solid color, white text). `color` is a
// GROUP_COLORS key.
export function StatusPill({ label, color = 'slate' }) {
  const c = GROUP_COLORS[color] || GROUP_COLORS.slate
  return (
    <span className={`inline-block w-full max-w-[124px] text-[11px] font-semibold text-white px-2 py-1 rounded-md text-center truncate ${c.solid}`}>
      {label}
    </span>
  )
}

/**
 * A monday.com-style grouped table.
 *
 * @param groups   [{ key, label, color, items: [...] }]  — color is a GROUP_COLORS key
 * @param columns  [{ key, header, width, align, headerClassName, cellClassName, render(item) }]
 *                 `width` is a CSS grid track ('minmax(200px,1fr)', '90px', …)
 * @param onRowClick  (item) => void   — whole-row click (cells stopPropagation as needed)
 * @param getRowKey   (item) => string
 * @param footer   node rendered under the table (e.g. an add-row)
 * @param emptyText shown when every group is empty
 * @param hideEmptyGroups  drop zero-item groups instead of showing their header
 */
export default function DataTable({
  groups,
  columns,
  onRowClick,
  getRowKey = (r) => r.id,
  footer,
  emptyText,
  hideEmptyGroups = false,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set())
  const toggle = (key) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const template = columns.map(c => c.width || 'minmax(0,1fr)').join(' ')
  const alignCls = (a) => (a === 'right' ? 'justify-end text-right' : a === 'center' ? 'justify-center text-center' : '')
  const shown = hideEmptyGroups ? groups.filter(g => g.items.length > 0) : groups
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Column header */}
          <div
            className="grid items-center gap-3 px-3 py-2 border-l-[3px] border-l-transparent border-b border-slate-100 dark:border-dark-border bg-slate-50/70 dark:bg-white/[0.02]"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map(c => (
              <div key={c.key} className={`flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 ${alignCls(c.align)} ${c.headerClassName || ''}`}>
                {c.header}
              </div>
            ))}
          </div>

          {total === 0 && emptyText && (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">{emptyText}</p>
          )}

          {shown.map(group => {
            const c = GROUP_COLORS[group.color] || GROUP_COLORS.slate
            const isCollapsed = collapsed.has(group.key)
            return (
              <div key={group.key} className="border-b border-slate-100 dark:border-dark-border last:border-b-0">
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 border-l-[3px] ${c.bar} ${c.soft} transition-colors`}
                >
                  {isCollapsed ? <ChevronRight size={14} className={c.text} /> : <ChevronDown size={14} className={c.text} />}
                  <span className={`text-xs font-bold ${c.text}`}>{group.label}</span>
                  <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{group.items.length}</span>
                </button>

                {/* Rows */}
                {!isCollapsed && group.items.length > 0 && (
                  <CappedList items={group.items} buttonClassName={`border-l-[3px] ${c.bar}`}>{(item) => (
                    <div
                      key={getRowKey(item)}
                      onClick={onRowClick ? () => onRowClick(item) : undefined}
                      className={`grid items-center gap-3 px-3 py-2 border-l-[3px] ${c.bar} border-t border-slate-50 dark:border-white/[0.04] ${onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-dark-hover' : ''} transition-colors`}
                      style={{ gridTemplateColumns: template }}
                    >
                      {columns.map(col => (
                        <div key={col.key} className={`min-w-0 flex items-center ${alignCls(col.align)} ${col.cellClassName || ''}`}>
                          {col.render(item)}
                        </div>
                      ))}
                    </div>
                  )}</CappedList>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {footer}
    </div>
  )
}
