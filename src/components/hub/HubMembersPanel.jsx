import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useHubMembers } from '../../hooks/useHubMembers'
import { useAuth } from '../../hooks/useAuth'
import { SlidePanel, ModalWrapper } from '../ui/animations'
import { Spinner } from '../ui/index'
import MemberPicker from './MemberPicker'
import { X, UserPlus, Shield, Crown, Trash2, LogOut, AlertTriangle } from 'lucide-react'

const ROLE_ICONS = { owner: Crown, admin: Shield }
const ROLE_COLORS = {
  owner: 'text-amber-500',
  admin: 'text-brand-500',
  member: 'text-slate-400'
}

export default function HubMembersPanel({ hubId, isOpen, onClose, myRole }) {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { members, loading, addMember, removeMember, updateRole, transferOwnership, leaveHub } = useHubMembers(hubId)
  const [showPicker, setShowPicker] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null) // member-row for transfer-confirm modal
  const [showLeave, setShowLeave] = useState(false)
  const [busy, setBusy] = useState(false)

  const canManage = myRole === 'owner' || myRole === 'admin'
  // Only the current owner (or a global Admin who happens to be a member)
  // can hand off ownership. Hub-level admins can manage members but not
  // transfer the crown.
  const canTransfer = myRole === 'owner' || isAdmin

  // Last-owner guard: if you're the only owner, leaving is blocked at the
  // DB level. Disable the button and explain why.
  const ownerCount = members.filter(m => m.role === 'owner').length
  const isOnlyOwner = myRole === 'owner' && ownerCount <= 1

  async function handleAdd(profileId) {
    const ok = await addMember(profileId)
    if (ok) setShowPicker(false)
  }

  async function confirmTransfer() {
    if (!transferTarget || busy) return
    setBusy(true)
    const ok = await transferOwnership(transferTarget.profile_id)
    setBusy(false)
    if (ok) setTransferTarget(null)
  }

  async function confirmLeave() {
    if (busy || !profile?.id) return
    setBusy(true)
    const ok = await leaveHub(profile.id)
    setBusy(false)
    if (ok) {
      setShowLeave(false)
      onClose?.()
      navigate('/hub')
    }
  }

  return (
    <>
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
                const isSelf = m.profile_id === profile?.id
                const canPromoteThis = canTransfer && !isSelf && m.role !== 'owner'
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

                    {canManage && !isSelf && m.role !== 'owner' && (
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
                        {canPromoteThis && (
                          <button
                            onClick={() => setTransferTarget(m)}
                            className="p-1 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                            title="Make owner (transfer ownership)"
                          >
                            <Crown size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => removeMember(m.profile_id)}
                          className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                          title="Remove member"
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

        {/* Leave hub footer — visible to every member of the hub.
            Disabled with a clear tooltip when you're the only owner. */}
        {profile?.id && members.some(m => m.profile_id === profile.id) && (
          <div className="border-t border-slate-200 dark:border-dark-border p-4">
            <button
              type="button"
              onClick={() => setShowLeave(true)}
              disabled={isOnlyOwner}
              title={isOnlyOwner ? 'Transfer ownership before leaving — you are the only owner.' : undefined}
              className="btn btn-secondary text-xs w-full flex items-center justify-center gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <LogOut size={13} />
              {isOnlyOwner ? 'Leave hub (transfer ownership first)' : 'Leave hub'}
            </button>
          </div>
        )}
      </SlidePanel>

      {/* Transfer-ownership confirm */}
      <ModalWrapper isOpen={!!transferTarget} onClose={() => !busy && setTransferTarget(null)}>
        <div className="p-6 max-w-md">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center text-amber-600 shrink-0">
              <Crown size={18} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Transfer ownership</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Make <span className="font-medium text-slate-800 dark:text-slate-200">
                  {transferTarget?.profile?.full_name}
                </span> the owner of this hub. You'll be demoted to <span className="font-medium">admin</span> and lose owner-only privileges (delete hub, transfer back).
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-5">
            <button type="button" className="btn-secondary" onClick={() => setTransferTarget(null)} disabled={busy}>
              Cancel
            </button>
            <motion.button
              type="button"
              className="btn btn-primary bg-amber-500 hover:bg-amber-600 border-amber-500"
              onClick={confirmTransfer}
              disabled={busy}
              whileTap={!busy ? { scale: 0.97 } : undefined}
            >
              {busy ? 'Transferring…' : 'Transfer ownership'}
            </motion.button>
          </div>
        </div>
      </ModalWrapper>

      {/* Leave-hub confirm */}
      <ModalWrapper isOpen={showLeave} onClose={() => !busy && setShowLeave(false)}>
        <div className="p-6 max-w-md">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-500/15 flex items-center justify-center text-red-600 shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Leave hub</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                You'll lose access to this hub's messages, files, to-dos, and cards. An owner or admin can re-add you later.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-5">
            <button type="button" className="btn-secondary" onClick={() => setShowLeave(false)} disabled={busy}>
              Cancel
            </button>
            <motion.button
              type="button"
              className="btn-danger"
              onClick={confirmLeave}
              disabled={busy}
              whileTap={!busy ? { scale: 0.97 } : undefined}
            >
              {busy ? 'Leaving…' : 'Leave hub'}
            </motion.button>
          </div>
        </div>
      </ModalWrapper>
    </>
  )
}
