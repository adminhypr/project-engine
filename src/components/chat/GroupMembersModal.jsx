import { useMemo, useState } from 'react'
import { X, Plus, Search, LogOut, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useProfiles } from '../../hooks/useTasks'
import { showToast } from '../ui'
import { ModalWrapper } from '../ui/animations'
import { memberCountLabel, groupDisplayName } from '../../lib/groupConversations'

export default function GroupMembersModal({
  isOpen, onClose, conversation, onLeft, onChanged,
}) {
  const { profile, isExternal } = useAuth()
  const { profiles } = useProfiles()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const existingIds = useMemo(
    () => new Set((conversation?.participants || []).map(p => p.id)),
    [conversation]
  )

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (profiles || [])
      .filter(p => !existingIds.has(p.id) && p.id !== profile?.id)
      .filter(p => !q || (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  }, [profiles, existingIds, profile?.id, query])

  async function addMember(uid) {
    if (busy || !conversation?.id) return
    setBusy(true)
    const { error } = await supabase.rpc('add_group_member', { cid: conversation.id, uid })
    setBusy(false)
    if (error) { showToast('Failed to add member', 'error'); return }
    showToast('Member added', 'success')
    onChanged?.()
  }

  async function leave() {
    if (busy || !conversation?.id) return
    if (!confirm('Leave this group? You will stop receiving messages.')) return
    setBusy(true)
    const { error } = await supabase.rpc('leave_group', { cid: conversation.id })
    setBusy(false)
    if (error) { showToast('Failed to leave group', 'error'); return }
    showToast('Left group', 'success')
    onLeft?.(conversation.id)
    onClose?.()
  }

  const participants = conversation?.participants || []

  return (
    <ModalWrapper isOpen={isOpen} onClose={busy ? () => {} : onClose}>
      <div className="flex flex-col max-h-[80vh]">
        <header className="px-4 py-3 border-b border-slate-200 dark:border-dark-border flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-brand-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {conversation ? groupDisplayName(conversation) : 'Group'}
              </div>
              <div className="text-[11px] text-slate-500">{memberCountLabel(participants)}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-4 overflow-y-auto">
          <section>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Current members
            </div>
            <div className="border border-slate-200 dark:border-dark-border rounded-lg max-h-48 overflow-y-auto">
              {participants.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">No members.</div>
              ) : participants.map(p => {
                const initial = (p.full_name || '?').charAt(0).toUpperCase()
                const isMe = p.id === profile?.id
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 border-slate-100 dark:border-slate-800"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold flex items-center justify-center overflow-hidden">
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" className="w-8 h-8 object-cover" />
                        : <span>{initial}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-900 dark:text-white truncate">
                        {p.full_name || p.email}{isMe && <span className="text-slate-400"> (you)</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {!isExternal && (
          <section>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Add people
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search people"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="border border-slate-200 dark:border-dark-border rounded-lg max-h-48 overflow-y-auto">
              {candidates.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">No one to add.</div>
              ) : candidates.map(p => {
                const initial = (p.full_name || '?').charAt(0).toUpperCase()
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 border-slate-100 dark:border-slate-800"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold flex items-center justify-center overflow-hidden">
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" className="w-8 h-8 object-cover" />
                        : <span>{initial}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-900 dark:text-white truncate">
                        {p.full_name || p.email}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addMember(p.id)}
                      disabled={busy}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-900/50 disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-slate-200 dark:border-dark-border flex items-center justify-between gap-2">
          {!isExternal ? (
            <button
              type="button"
              onClick={leave}
              disabled={busy}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              <LogOut className="w-4 h-4" />
              Leave group
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            Done
          </button>
        </footer>
      </div>
    </ModalWrapper>
  )
}
