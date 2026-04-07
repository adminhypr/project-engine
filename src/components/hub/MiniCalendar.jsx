import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export default function MiniCalendar({ events, onDateClick }) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Build calendar grid
  const cells = useMemo(() => {
    const year = month.getFullYear()
    const mo = month.getMonth()
    const firstDay = new Date(year, mo, 1).getDay()
    const daysInMonth = new Date(year, mo + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < firstDay; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, mo, d))
    return cells
  }, [month])

  // Events by date string
  const eventDates = useMemo(() => {
    const map = {}
    events.forEach(e => {
      const d = new Date(e.starts_at).toISOString().split('T')[0]
      if (!map[d]) map[d] = []
      map[d].push(e)
    })
    return map
  }, [events])

  function prev() { setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)) }
  function next() { setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)) }

  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={prev} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-500 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{monthLabel}</span>
        <button onClick={next} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-500 transition-colors">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px text-center">
        {DAYS.map(d => (
          <div key={d} className="text-xs text-slate-400 dark:text-slate-500 font-medium py-1">{d}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />
          const key = date.toISOString().split('T')[0]
          const hasEvents = !!eventDates[key]
          const isToday = date.getTime() === today.getTime()
          return (
            <button
              key={key}
              onClick={() => onDateClick(key)}
              className={`relative text-xs py-1.5 rounded-lg transition-colors
                ${isToday ? 'bg-brand-500 text-white font-bold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-hover'}
              `}
            >
              {date.getDate()}
              {hasEvents && (
                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isToday ? 'bg-white' : 'bg-brand-500'}`} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
