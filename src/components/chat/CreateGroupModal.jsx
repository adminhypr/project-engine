import { useMemo, useState } from 'react'
import { X, Check, Search, Users } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useProfiles } from '../../hooks/useTasks'
import { showToast } from '../ui'
import { ModalWrapper } from '../ui/animations'

export default function CreateGroupModal({ isOpen, onClose, onCreated, createGroup }) {
  const { profile } = useAuth()
  const { profiles } = useProfiles()
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(() => {
    const myTeamIds = new Set(profile?.team_ids || (profile?.team_id ? [profile.team_id] : []))
    const q = query.trim().toLowerCase()
    return (profiles || [])
      .filter(p => p.id !== profile?.id)
      .filter(p => !q || (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      .map(p => ({
        ...p,
        isTeammate: (p.team_ids || []).some(tid => myTeamIds.has(tid)),
      }))
      .sort((a, b) => {
        if (a.isTeammate !== b.isTeammate) return a.isTeammate ? -1 : 1
        return (a.full_name || '').localeCompare(b.full_name || '')
      })
  }, [profiles, profile, query])

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    if (busy) return
    if (selected.size === 0) {
      showToast('Pick at least one member', 'error')
      return
    }
    setBusy(true)
    const convId = await createGroup(title, [...selected])
    setBusy(false)
    if (!convId) return
    showToast('Group created', 'success')
    onCreated?.(convId)
    // Reset + close
    setTitle('')
    setQuery('')
    setSelected(new Set())
    onClose?.()
  }

  function close() {
    if (busy) return
    setTitle('')
    setQuery('')
    setSelected(new Set())
    onClose?.()
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={close}>
      <div className="flex flex-col max-h-[80vh]">
        <header className="px-4 py-3 border-b border-slate-200 dark:border-dark-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-brand-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">New group</h2>
          </div>
          <button type="button" onClick={close} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-3 overflow-y-auto">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Group name</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Launch planning"
              maxLength={120}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-dark-border text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>

          <div>
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Members ({selected.size} selected)
            </span>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search people"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto border border-slate-200 dark:border-dark-border rounded-lg">
            {candidates.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">No matches.</div>
            ) : (
              candidates.map(p => {
                const isSel = selected.has(p.id)
                const initial = (p.full_name || '?').charAt(0).toUpperCase()
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left border-b last:border-b-0 border-slate-100 dark:border-slate-800 ${
                      isSel
                        ? 'bg-brand-50 dark:bg-brand-900/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 font-semibold flex items-center justify-center overflow-hidden">
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" className="w-8 h-8 object-cover" />
                        : <span>{initial}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {p.full_name || p.email}
                      </div>
                      {p.isTeammate && (
                        <div className="text-[11px] text-slate-500">Teammate</div>
                      )}
                    </div>
                    {isSel && <Check className="w-4 h-4 text-brand-600" />}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <footer className="px-4 py-3 border-t border-slate-200 dark:border-dark-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || selected.size === 0}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </footer>
      </div>
    </ModalWrapper>
  )
}
