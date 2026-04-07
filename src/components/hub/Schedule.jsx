import { useState } from 'react'
import { useHubEvents } from '../../hooks/useHubEvents'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../ui/index'
import MiniCalendar from './MiniCalendar'
import EventForm from './EventForm'
import { Plus, Trash2 } from 'lucide-react'

export default function Schedule({ hubId }) {
  const { profile } = useAuth()
  const { events, loading, createEvent, deleteEvent } = useHubEvents(hubId)
  const [showForm, setShowForm] = useState(false)
  const [selectedDate, setSelectedDate] = useState(null)

  if (loading) return <div className="py-8 flex justify-center"><Spinner /></div>

  async function handleCreate(eventData) {
    const ok = await createEvent(eventData)
    if (ok) setShowForm(false)
    return ok
  }

  function handleDateClick(date) {
    setSelectedDate(date)
    setShowForm(true)
  }

  // Upcoming events (next 14 days)
  const now = new Date()
  const upcoming = events.filter(e => new Date(e.starts_at) >= now).slice(0, 5)

  return (
    <div className="space-y-3">
      <MiniCalendar events={events} onDateClick={handleDateClick} />

      {!showForm ? (
        <button onClick={() => { setSelectedDate(null); setShowForm(true) }} className="btn btn-secondary text-xs w-full flex items-center justify-center gap-1.5">
          <Plus size={14} />
          Add event
        </button>
      ) : (
        <EventForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          defaultDate={selectedDate}
        />
      )}

      {upcoming.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Upcoming</p>
          {upcoming.map(evt => (
            <div key={evt.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors group">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: evt.color || '#6366f1' }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate">{evt.title}</p>
                <p className="text-xs text-slate-400">
                  {new Date(evt.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {!evt.all_day && ' ' + new Date(evt.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              {(evt.created_by === profile?.id) && (
                <button onClick={() => deleteEvent(evt.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-red-500 transition-all">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
