import { useState } from 'react'
import { X, UserPlus, Trash2 } from 'lucide-react'
import { ModalWrapper } from '../ui/animations'
import { useProfiles } from '../../hooks/useTasks'

// Manage who belongs to a Dev Project. Membership is what makes a project
// visible to someone (RLS: projects_select = is_project_member) AND who shows
// up in the assignee pickers. Owner/admins add & remove; everyone can view the
// roster. useProjectMembers (passed in, shared with the page) owns the writes.
const ROLE_BADGE = {
  owner:  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  admin:  'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  member: 'bg-slate-100 text-slate-600 dark:bg-dark-border dark:text-slate-400',
}

function Avatar({ profile }) {
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
  }
  const initial = (profile?.full_name || '?').charAt(0).toUpperCase()
  return (
    <span className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 text-xs font-medium flex items-center justify-center shrink-0">
      {initial}
    </span>
  )
}

export default function ProjectMembersModal({ projectMembers, isAdmin, currentUserId, onClose }) {
  const { members, addMember, removeMember, loading } = projectMembers
  const { profiles } = useProfiles({ excludeExternals: true })  // Agent/Client aren't on the dev board
  const [adding, setAdding] = useState('')      // profileId selected to add
  const [busy, setBusy] = useState(false)

  const memberIds = new Set(members.map(m => m.profile_id))
  const addable = profiles
    .filter(p => !memberIds.has(p.id))
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))

  const add = async () => {
    if (!adding || busy) return
    setBusy(true)
    await addMember(adding, 'member')
    setAdding('')
    setBusy(false)
  }

  const remove = async (m) => {
    if (busy) return
    if (!confirm(`Remove ${m.profile?.full_name || 'this member'} from the project?`)) return
    setBusy(true)
    await removeMember(m.profile_id)
    setBusy(false)
  }

  return (
    <ModalWrapper isOpen onClose={onClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-md p-5 shadow-elevated">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Project members</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={18} /></button>
        </div>

        <div className="space-y-0.5 max-h-72 overflow-y-auto -mx-1 px-1">
          {loading && members.length === 0 && (
            <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
          )}
          {members.map(m => {
            const canRemove = isAdmin && m.role !== 'owner' && m.profile_id !== currentUserId
            return (
              <div key={m.profile_id} className="flex items-center gap-2.5 py-1.5">
                <Avatar profile={m.profile} />
                <span className="flex-1 min-w-0 text-sm text-slate-800 dark:text-slate-100 truncate">
                  {m.profile?.full_name || 'Unknown'}
                  {m.profile_id === currentUserId && <span className="text-slate-400"> (you)</span>}
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${ROLE_BADGE[m.role] || ROLE_BADGE.member}`}>{m.role}</span>
                {canRemove && (
                  <button onClick={() => remove(m)} disabled={busy} className="text-slate-400 hover:text-red-500 p-1 disabled:opacity-50" title="Remove from project">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {isAdmin ? (
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-dark-border">
            {addable.length === 0 ? (
              <p className="text-xs text-slate-400">Everyone is already a member.</p>
            ) : (
              <div className="flex items-center gap-2">
                <select value={adding} onChange={e => setAdding(e.target.value)} className="form-input flex-1 text-sm">
                  <option value="">Add a member…</option>
                  {addable.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email || 'Unknown'}</option>)}
                </select>
                <button onClick={add} disabled={!adding || busy} className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0">
                  <UserPlus size={14} /> Add
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 pt-3 border-t border-slate-100 dark:border-dark-border text-[11px] text-slate-400">
            Only project owners/admins can add or remove members.
          </p>
        )}
      </div>
    </ModalWrapper>
  )
}
