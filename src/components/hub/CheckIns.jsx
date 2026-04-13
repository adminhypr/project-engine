import { useState } from 'react'
import { useHubCheckIns } from '../../hooks/useHubCheckIns'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../ui/index'
import CheckInPromptCard from './CheckInPromptCard'
import { Plus } from 'lucide-react'

export default function CheckIns({ hubId }) {
  const { profile, isManager } = useAuth()
  const { prompts, responses, loading, createPrompt, submitResponse, deletePrompt } = useHubCheckIns(hubId)
  const [showNew, setShowNew]     = useState(false)
  const [question, setQuestion]   = useState('')
  const [schedule, setSchedule]   = useState('daily')
  const [creating, setCreating]   = useState(false)

  if (loading) return <div className="py-8 flex justify-center"><Spinner /></div>

  async function handleCreate(e) {
    e.preventDefault()
    if (!question.trim() || creating) return
    setCreating(true)
    const ok = await createPrompt(question.trim(), schedule)
    if (ok) { setShowNew(false); setQuestion('') }
    setCreating(false)
  }

  return (
    <div className="space-y-3">
      {isManager && !showNew && (
        <button onClick={() => setShowNew(true)} className="btn btn-secondary text-xs w-full flex items-center justify-center gap-1.5">
          <Plus size={14} />
          New check-in question
        </button>
      )}

      {showNew && (
        <form onSubmit={handleCreate} className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="e.g. What did you work on today?"
            className="form-input w-full text-sm"
          />
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-500 dark:text-slate-400">Frequency:</label>
            <select value={schedule} onChange={e => setSchedule(e.target.value)} className="form-input text-xs py-1.5">
              <option value="daily">Every weekday</option>
              <option value="weekly_monday">Weekly (Monday)</option>
              <option value="weekly_friday">Weekly (Friday)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowNew(false)} className="btn btn-ghost text-xs">Cancel</button>
            <button type="submit" disabled={!question.trim() || creating} className="btn btn-primary text-xs disabled:opacity-40">
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {prompts.length === 0 && !showNew && (
        <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
          {isManager ? 'No check-in questions yet. Create one to get started.' : 'No check-in questions set up yet.'}
        </p>
      )}

      {prompts.map(prompt => (
        <CheckInPromptCard
          key={prompt.id}
          hubId={hubId}
          prompt={prompt}
          responses={responses.filter(r => r.prompt_id === prompt.id)}
          profileId={profile?.id}
          isManager={isManager}
          onSubmitResponse={submitResponse}
          onDelete={deletePrompt}
        />
      ))}
    </div>
  )
}
