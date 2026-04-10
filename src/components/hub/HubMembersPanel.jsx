import { useState } from 'react'
import { useHubMembers } from '../../hooks/useHubMembers'
import { useAuth } from '../../hooks/useAuth'
import { SlidePanel } from '../ui/animations'
import { Spinner } from '../ui/index'
import MemberPicker from './MemberPicker'
import { X, UserPlus, Shield, Crown, Trash2 } from 'lucide-react'

const ROLE_ICONS = { owner: Crown, admin: Shield }
const ROLE_COLORS = {
  owner: 'text-amber-500',
  admin: 'text-brand-500',
  member: 'text-slate-400'
}

export default function HubMembersPanel({ hubId, isOpen, onClose, myRole }) {
  const { profile } = useAuth()
  const { members, loading, addMember, removeMember, updateRole } = useHubMembers(hubId)
  const [showPicker, setShowPicker] = useState(false)
  const canManage = myRole === 'owner' || myRole === 'admin'

  async function handleAdd(profileId) {
    const ok = await addMember(profileId)
    if (ok) setShowPicker(false)
  }

  return (
    <SlidePanel isOpen={isOpen} onClose={onClose} width={380}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-dark-border">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Members ({members.length})</h3>
        <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {canManage && !showPicker && (
          <button onClick={() => setShowPicker(true)} className="btn btn-secondary text-xs w-full mb-4 flex items-center justify-center gap-1.5">
            <UserPlus size={14} />
            Add member
          </button>
        )}

        {showPicker && (
          <div className="mb-4">
            <MemberPicker
              existingIds={members.map(m => m.profile_id)}
              onSelect={handleAdd}
              onCancel={() => setShowPicker(false)}
            />
          </div>
        )}

        {loading ? (
          <div className="py-8 flex justify-center"><Spinner /></div>
        ) : (
          <div className="space-y-1">
            {members.map(m => {
              const RoleIcon = ROLE_ICONS[m.role]
              return (
                <div key={m.profile_id} className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-slate-50 dark:hover:bg-dark-hover group">
                  {m.profile?.avatar_url ? (
                    <img src={m.profile.avatar_url} className="w-8 h-8 rounded-full" alt="" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
                      {m.profile?.full_name?.[0] || '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{m.profile?.full_name}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      {RoleIcon && <RoleIcon size={10} className={ROLE_COLORS[m.role]} />}
                      {m.role}
                    </p>
                  </div>

                  {canManage && m.profile_id !== profile?.id && m.role !== 'owner' && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {myRole === 'owner' && (
                        <select
                          value={m.role}
                          onChange={e => updateRole(m.profile_id, e.target.value)}
                          className="text-xs border border-slate-200 dark:border-dark-border rounded-lg px-1.5 py-0.5 bg-white dark:bg-dark-card"
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      )}
                      <button
                        onClick={() => removeMember(m.profile_id)}
                        className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SlidePanel>
  )
}
