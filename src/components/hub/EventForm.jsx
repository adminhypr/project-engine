import { useState } from 'react'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

export default function EventForm({ onSubmit, onCancel, defaultDate }) {
  const [title, setTitle]   = useState('')
  const [desc, setDesc]     = useState('')
  const [date, setDate]     = useState(defaultDate || new Date().toISOString().split('T')[0])
  const [time, setTime]     = useState('09:00')
  const [allDay, setAllDay] = useState(false)
  const [color, setColor]   = useState(COLORS[0])
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    const starts_at = allDay ? `${date}T00:00:00` : `${date}T${time}:00`
    const ok = await onSubmit({
      title: title.trim(),
      description: desc.trim() || null,
      starts_at,
      ends_at: null,
      all_day: allDay,
      color
    })
    if (!ok) setSaving(false)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" className="form-input w-full text-sm font-semibold" />
      <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" className="form-input w-full text-sm" />
      <div className="flex items-center gap-3 flex-wrap">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="form-input text-xs py-1.5" />
        {!allDay && <input type="time" value={time} onChange={e => setTime(e.target.value)} className="form-input text-xs py-1.5" />}
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
          All day
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Color:</span>
        {COLORS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-1 ring-slate-300 dark:ring-slate-600' : 'hover:scale-110'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">Cancel</button>
        <button type="submit" disabled={!title.trim() || saving} className="btn btn-primary text-xs disabled:opacity-40">
          {saving ? 'Saving...' : 'Add event'}
        </button>
      </div>
    </form>
  )
}
