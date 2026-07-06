import { useState, useEffect } from 'react'
import { Shield, Star, X, Plus, Trash2, Mail } from 'lucide-react'
import { SlidePanel, ModalWrapper } from '../ui/animations'
import { useUserAdmin } from '../../hooks/useUserAdmin'
import { getAccountType, getAccessLevel } from '../../lib/userAccess'

// Per-user edit drawer for the Settings page (phase 3 of
// docs/plans/2026-07-05-settings-redesign-design.md). The Users table is a
// read-only summary; every write happens here, one clearly-labeled section
// per concept. All writes go through useUserAdmin (same paths the old inline
// row used) and save immediately with a toast.

const SECTION = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500'

function Section({ title, children, hint }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 dark:border-dark-border">
      <div className={SECTION}>{title}</div>
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </div>
  )
}

const EXTERNAL_DESCRIPTIONS = {
  Agent:  'Works hubs they’re invited to. No task views, can’t create hubs.',
  Client: 'Views hubs they’re invited to. No task views, can’t create hubs.',
}

export default function UserDrawer({
  user,            // enriched profile row (null = closed)
  teams,
  allProfiles,
  isAdmin,         // viewer is Admin
  currentProfileId,
  approverName,
  onChanged,       // refetch
  onClose,
  onDelete,        // opens the page-level delete confirm modal
}) {
  const admin = useUserAdmin({ approverName, onChanged })
  const [nameValue, setNameValue] = useState(user?.full_name || '')
  const [confirmAdmin, setConfirmAdmin] = useState(false) // pending grant/revoke
  const [addingTeam, setAddingTeam] = useState(false)

  useEffect(() => {
    setNameValue(user?.full_name || '')
    setConfirmAdmin(false)
    setAddingTeam(false)
  }, [user?.id])

  if (!user) return <SlidePanel isOpen={false} onClose={onClose} />

  const isSelf = user.id === currentProfileId
  const userTeams = (user.profile_teams || []).map(pt => ({
    team_id: pt.team_id,
    is_primary: pt.is_primary,
    role: pt.role || 'Staff',
    name: pt.team?.name || teams.find(t => t.id === pt.team_id)?.name || 'Unknown',
  }))
  const isUnassigned = userTeams.length === 0
  // Same edit rules as the old inline row: Admin edits anyone but self;
  // Manager edits only unassigned users (first-team setup flow).
  const canEdit = isAdmin ? !isSelf : (isUnassigned && !isSelf)

  const accountType = getAccountType(user)
  const isExternalUser = accountType !== 'Internal'
  const accessLevel = getAccessLevel(user)
  const availableTeams = teams.filter(t => !userTeams.some(ut => ut.team_id === t.id))
  const managerOptions = allProfiles.filter(p =>
    (p.role === 'Manager' || p.role === 'Admin')
    && p.id !== user.id
    && p.reports_to !== user.id
  )

  const commitName = () => {
    const next = nameValue.trim()
    if (next && next !== (user.full_name || '')) admin.updateProfile(user.id, { full_name: next })
  }

  return (
    <>
    <SlidePanel isOpen={!!user} onClose={onClose} width={440}>
      <div className="h-full flex flex-col bg-white dark:bg-dark-card">
        {/* Identity */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-dark-border flex items-start gap-3">
          {user.avatar_url
            ? <img src={user.avatar_url} className="w-10 h-10 rounded-full" alt="" />
            : <div className="w-10 h-10 rounded-full bg-brand-500 flex items-center justify-center text-white font-bold">
                {user.full_name?.[0] || '?'}
              </div>
          }
          <div className="min-w-0 flex-1">
            {isAdmin ? (
              <input
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                className="form-input py-1 px-2 text-sm font-semibold w-full"
                aria-label="Full name"
              />
            ) : (
              <div className="font-semibold text-slate-900 dark:text-white truncate">{user.full_name}</div>
            )}
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Mail size={11} /> {user.email}
              {isSelf && <span className="badge bg-brand-50 text-brand-700 text-[10px]">You</span>}
              {isUnassigned && <span className="badge bg-yellow-500/15 text-yellow-700 text-[10px]">Needs setup</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Account type */}
          <Section
            title="Account type"
            hint={user.role === 'Admin'
              ? 'Admins are internal. Remove Admin access to change the account type.'
              : 'Internal staff use tasks and teams. External users only see hubs they’re invited to.'}
          >
            <div className="flex gap-2">
              {['Internal', 'External'].map(opt => {
                const active = opt === 'Internal' ? !isExternalUser : isExternalUser
                const disabled = !canEdit || user.role === 'Admin'
                return (
                  <button
                    key={opt}
                    disabled={disabled}
                    onClick={() => {
                      if (active) return
                      admin.setAccountType(user, opt === 'Internal' ? 'Internal' : 'Agent')
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors
                      ${active
                        ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/40'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-dark-border dark:text-slate-400'}
                      ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
            {isExternalUser && (
              <div className="mt-2 space-y-1.5">
                {['Agent', 'Client'].map(t => (
                  <label key={t} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors
                    ${accountType === t
                      ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-500/10 dark:border-brand-500/40'
                      : 'border-slate-200 dark:border-dark-border'}
                    ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <input
                      type="radio"
                      name="external-type"
                      checked={accountType === t}
                      disabled={!canEdit}
                      onChange={() => admin.setAccountType(user, t)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t}</span>
                      <span className="block text-xs text-slate-400 dark:text-slate-500">{EXTERNAL_DESCRIPTIONS[t]}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Section>

          {/* Access level — internal users only */}
          {!isExternalUser && (
            <Section
              title="Access level"
              hint="Manager access comes from team roles below — make them a Manager on at least one team. Admin overrides everything."
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`badge text-xs ${
                  accessLevel === 'Admin'
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'
                  : accessLevel === 'Manager'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-dark-hover dark:text-slate-300'
                }`}>
                  <Shield size={11} className="inline mr-1 -mt-px" />{accessLevel}
                </span>
                {isAdmin && !isSelf && (
                  <button onClick={() => setConfirmAdmin(true)} className="btn text-xs px-2.5 py-1.5">
                    {user.role === 'Admin' ? 'Remove Admin access' : 'Grant Admin access'}
                  </button>
                )}
              </div>
            </Section>
          )}

          {/* Teams */}
          <Section
            title="Teams"
            hint={isExternalUser
              ? 'Hubs this external user was invited through.'
              : 'The primary team drives default views and reports.'}
          >
            <div className="space-y-1.5">
              {userTeams.map(t => (
                <div key={t.team_id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-dark-border">
                  <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{t.name}</span>
                  {!isExternalUser && (
                    canEdit ? (
                      <select
                        value={t.role === 'Manager' ? 'Manager' : 'Staff'}
                        onChange={e => admin.updateTeamRole(user, t.team_id, e.target.value)}
                        className="form-input w-auto shrink-0 py-0.5 px-1.5 text-xs"
                        aria-label={`Role in ${t.name}`}
                      >
                        <option value="Staff">Staff</option>
                        {isAdmin && <option value="Manager">Manager</option>}
                      </select>
                    ) : (
                      t.role !== 'Staff' && <span className="badge bg-amber-100 text-amber-700 text-[10px] dark:bg-amber-500/20 dark:text-amber-300">{t.role}</span>
                    )
                  )}
                  {canEdit ? (
                    <button
                      onClick={() => !t.is_primary && admin.setPrimaryTeam(user, t.team_id)}
                      className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                        t.is_primary
                          ? 'text-brand-600 dark:text-brand-400 font-medium'
                          : 'text-slate-300 hover:text-brand-500 dark:text-slate-600'
                      }`}
                      title={t.is_primary ? 'Primary team' : 'Make primary'}
                    >
                      <Star size={11} className={t.is_primary ? 'fill-current' : ''} />
                      {t.is_primary ? 'Primary' : ''}
                    </button>
                  ) : t.is_primary && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-brand-600 dark:text-brand-400 font-medium">
                      <Star size={11} className="fill-current" /> Primary
                    </span>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => admin.removeTeamFromUser(user, t.team_id)}
                      className="p-1 rounded text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 transition-colors"
                      title={`Remove from ${t.name}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              {userTeams.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">No teams yet — add one below to approve this user.</p>
              )}
              {canEdit && (
                addingTeam ? (
                  <select
                    autoFocus
                    className="form-input py-1 px-2 text-xs w-full"
                    onChange={e => { if (e.target.value) { admin.addTeamToUser(user, e.target.value); setAddingTeam(false) } }}
                    onBlur={() => setAddingTeam(false)}
                    defaultValue=""
                  >
                    <option value="">Select team...</option>
                    {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                ) : availableTeams.length > 0 && (
                  <button
                    onClick={() => setAddingTeam(true)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-brand-500 border border-dashed border-slate-200 dark:border-dark-border dark:text-slate-500 dark:hover:text-brand-400 transition-colors"
                  >
                    <Plus size={11} /> Add team
                  </button>
                )
              )}
            </div>
          </Section>

          {/* Reporting — internal users only */}
          {!isExternalUser && isAdmin && (
            <Section title="Reports to" hint="Their manager sees their tasks in Team View and gets escalation emails.">
              <select
                value={user.reports_to || ''}
                onChange={e => admin.updateProfile(user.id, { reports_to: e.target.value || null })}
                className="form-input py-1.5 text-sm w-full"
                disabled={isSelf}
              >
                <option value="">— None —</option>
                {managerOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
                ))}
              </select>
            </Section>
          )}

          {/* Danger zone */}
          {isAdmin && !isSelf && (
            <Section title="Danger zone">
              <button
                onClick={() => onDelete(user)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 transition-colors"
              >
                <Trash2 size={12} /> Delete user
              </button>
            </Section>
          )}
        </div>
      </div>
    </SlidePanel>

    {/* Admin grant/revoke confirm — outside the SlidePanel so its fixed
        positioning isn't trapped by the panel's transform. */}
    <ModalWrapper isOpen={confirmAdmin} onClose={() => setConfirmAdmin(false)}>
        <div className="p-5 max-w-sm">
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {user.role === 'Admin' ? `Remove Admin access from ${user.full_name}?` : `Make ${user.full_name} an Admin?`}
          </h3>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {user.role === 'Admin'
              ? 'They drop back to Manager or Staff based on their team roles, and lose user management, all-team reports, and admin overview.'
              : 'Admins can manage every user, team, and report across the company. This overrides their team roles.'}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setConfirmAdmin(false)} className="btn text-xs px-3 py-1.5">Cancel</button>
            <button
              onClick={() => { admin.toggleAdmin(user); setConfirmAdmin(false) }}
              className="btn-primary text-xs px-3 py-1.5"
            >
              {user.role === 'Admin' ? 'Remove Admin' : 'Grant Admin'}
            </button>
          </div>
        </div>
      </ModalWrapper>
    </>
  )
}
