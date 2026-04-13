import { useState, useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import CheckInResponseForm from './CheckInResponseForm'
import RichContentRenderer from '../ui/RichContentRenderer'

const SCHEDULE_LABELS = {
  daily: 'Every weekday',
  weekly_monday: 'Weekly (Mon)',
  weekly_friday: 'Weekly (Fri)',
}

export default function CheckInPromptCard({ hubId, prompt, responses, profileId, isManager, onSubmitResponse, onDelete }) {
  const today = new Date().toISOString().split('T')[0]

  const myResponse = responses.find(r => r.author_id === profileId && r.response_date === today)

  // Group responses by date (last 7 days)
  const grouped = useMemo(() => {
    const byDate = {}
    responses.forEach(r => {
      if (!byDate[r.response_date]) byDate[r.response_date] = []
      byDate[r.response_date].push(r)
    })
    return Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 7)
  }, [responses])

  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card overflow-hidden">
      <div className="px-4 py-3 flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{prompt.question}</h4>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{SCHEDULE_LABELS[prompt.schedule] || prompt.schedule}</p>
        </div>
        {isManager && (
          <button onClick={() => onDelete(prompt.id)} className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all shrink-0" title="Deactivate">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Today's response form */}
      {!myResponse && (
        <div className="px-4 pb-3">
          <CheckInResponseForm hubId={hubId} promptId={prompt.id} onSubmit={onSubmitResponse} />
        </div>
      )}

      {/* Responses grouped by date */}
      {grouped.length > 0 && (
        <div className="border-t border-slate-200/60 dark:border-dark-border px-4 py-3 bg-slate-50/50 dark:bg-dark-bg/50 space-y-3 max-h-64 overflow-y-auto">
          {grouped.map(([date, items]) => (
            <div key={date}>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
              <div className="space-y-1.5">
                {items.map(r => (
                  <div key={r.id} className="flex items-start gap-2">
                    {r.author?.avatar_url ? (
                      <img src={r.author.avatar_url} className="w-5 h-5 rounded-full mt-0.5" alt="" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-slate-300 dark:bg-dark-border flex items-center justify-center text-white text-xs font-bold mt-0.5">
                        {r.author?.full_name?.[0] || '?'}
                      </div>
                    )}
                    <div>
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{r.author?.full_name}</span>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        <RichContentRenderer content={r.content} mentions={r.mentions} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
