import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { PageHeader, showToast } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import { Star, X, Plus, Send, Mail, Pencil, Trash2, Check, AlertTriangle, Shield } from 'lucide-react'
import { ModalWrapper } from '../components/ui/animations'
import AvatarCard from '../components/settings/AvatarCard'

export default function SettingsPage() {
  const { profile, isAdmin } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [teams,    setTeams]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [newTeam,  setNewTeam]  = useState('')
  const [saving,   setSaving]   = useState({})
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting,    setInviting]    = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from('profiles').select('*, teams!profiles_team_id_fkey(id, name), profile_teams!profile_teams_profile_id_fkey(team_id, is_primary, role, team:teams!profile_teams_team_id_fkey(id, name))').order('full_name'),
      supabase.from('teams').select('*').order('name')
    ])
    const profileList = p || []
    const profileMap = Object.fromEntries(profileList.map(pr => [pr.id, pr]))
    const enriched = profileList.map(pr => ({
      ...pr,
      manager: pr.reports_to ? { id: pr.reports_to, full_name: profileMap[pr.reports_to]?.full_name } : null
    }))
    setProfiles(enriched)
    setTeams(t || [])
    setLoading(false)
  }

  async function updateProfile(id, updates) {
    setSaving(s => ({ ...s, [id]: true }))
    const { error } = await supabase.from('profiles').update(updates).eq('id', id)
    setSaving(s => ({ ...s, [id]: false }))
    if (error) showToast(error.message, 'error')
    else { showToast('Updated'); fetchAll() }
  }

  async function addTeam() {
    if (!newTeam.trim()) return
    const { error } = await supabase.from('teams').insert({ name: newTeam.trim() })
    if (error) showToast(error.message, 'error')
    else { showToast('Team added'); setNewTeam(''); fetchAll() }
  }

  async function deleteTeam(id) {
    if (!window.confirm('Delete this team? Members will be unassigned.')) return
    const { error } = await supabase.from('teams').delete().eq('id', id)
    if (error) showToast(error.message, 'error')
    else { showToast('Team deleted'); fetchAll() }
  }

  async function sendInvite() {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setInviting(true)
    const { error } = await supabase.functions.invoke('user-notify', {
      body: { type: 'invite', email, inviterName: profile?.full_name || 'A team member' }
    })
    setInviting(false)
    if (error) showToast('Failed to send invite', 'error')
    else { showToast('Invite sent to ' + email); setInviteEmail('') }
  }

  async function deleteProfile() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.functions.invoke('admin-delete-user', {
      body: { userId: deleteTarget.id }
    })
    setDeleting(false)
    if (error) showToast(error.message || 'Failed to delete user', 'error')
    else { showToast(`${deleteTarget.full_name} has been deleted`); setDeleteTarget(null); fetchAll() }
  }

  // Manager: only teams where they have Manager role (per-team roles)
  const mgrTeamIds = (profile?.all_teams || [])
    .filter(t => t.role === 'Manager')
    .map(t => t.id)
  // Fallback to all team_ids if no per-team role data yet
  const myTeamIds = mgrTeamIds.length > 0
    ? mgrTeamIds
    : (profile?.team_ids || (profile?.team_id ? [profile.team_id] : []))
  const managerTeams = isAdmin ? teams : teams.filter(t => myTeamIds.includes(t.id))

  // Manager: only show unassigned users + themselves (for context)
  const visibleProfiles = isAdmin
    ? profiles
    : profiles.filter(p => {
        const hasTeams = p.profile_teams && p.profile_teams.length > 0
        return !hasTeams || p.id === profile?.id
      })

  const unassignedCount = profiles.filter(p => !p.profile_teams || p.profile_teams.length === 0).length

  if (loading) return <div className="p-8 text-slate-400 dark:text-slate-500">Loading...</div>

  return (
    <PageTransition>
      <div>
        <PageHeader
          title="Settings"
          subtitle={isAdmin ? 'Manage users, teams, and roles' : `${unassignedCount} user${unassignedCount !== 1 ? 's' : ''} need${unassignedCount === 1 ? 's' : ''} team assignment`}
        />

        <div className="p-4 sm:p-6 space-y-6 max-w-7xl">

          <AvatarCard />

          {/* Teams — admin only */}
          {isAdmin && (
            <motion.div
              className="card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Teams</p>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newTeam}
                  onChange={e => setNewTeam(e.target.value)}
                  placeholder="New team name..."
                  className="form-input flex-1"
                  onKeyDown={e => e.key === 'Enter' && addTeam()}
                />
                <button className="btn-primary" onClick={addTeam}>Add Team</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {teams.map(t => (
                  <motion.div
                    key={t.id}
                    className="flex items-center gap-2 bg-white dark:bg-dark-surface rounded-xl px-3 py-1.5 border border-slate-100 dark:border-dark-border"
                    layout
                  >
                    <span className="text-sm font-medium">{t.name}</span>
                    <button
                      onClick={() => deleteTeam(t.id)}
                      className="text-slate-400 dark:text-slate-500 hover:text-red-500 text-xs transition-colors"
                    >✕</button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Invite User */}
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.025 }}
          >
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Invite User</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              Send an email invitation to a new user. They'll sign in with their Google account.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="form-input pl-9 flex-1 w-full"
                  onKeyDown={e => e.key === 'Enter' && sendInvite()}
                />
              </div>
              <button
                className="btn-primary inline-flex items-center gap-2"
                onClick={sendInvite}
                disabled={inviting || !inviteEmail.trim()}
              >
                <Send size={14} />
                {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </motion.div>

          {/* Users */}
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
          >
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
              {isAdmin ? `Users (${profiles.length})` : `New Users (${unassignedCount})`}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              {isAdmin
                ? 'New users appear here after they sign in for the first time. Assign them teams and a role.'
                : 'Assign new users to one of your teams so they can start using the app.'}
            </p>
            {visibleProfiles.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">No users need setup.</p>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="table-th">Name</th>
                    <th className="table-th">Email</th>
                    <th className="table-th">Teams</th>
                    {isAdmin && <th className="table-th">Admin</th>}
                    {isAdmin && <th className="table-th">Reports To</th>}
                    {isAdmin && <th className="table-th">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleProfiles.map(p => (
                    <UserRow
                      key={p.id}
                      user={p}
                      teams={isAdmin ? teams : managerTeams}
                      allProfiles={profiles}
                      isSelf={p.id === profile?.id}
                      saving={saving[p.id]}
                      onSave={(updates) => updateProfile(p.id, updates)}
                      onTeamsChange={fetchAll}
                      isAdmin={isAdmin}
                      approverName={profile?.full_name}
                      onDelete={() => setDeleteTarget(p)}
                    />
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </motion.div>

        </div>

        {/* Delete user confirmation modal */}
        <ModalWrapper isOpen={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">Delete User</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-200 mb-1">
              Are you sure you want to delete <strong>{deleteTarget?.full_name}</strong>?
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
              This will permanently remove their account and all associated tasks, comments, and team memberships.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="btn-ghost px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={deleteProfile}
                disabled={deleting}
                className="btn-danger px-4 py-2 text-sm inline-flex items-center gap-2"
              >
                <Trash2 size={14} />
                {deleting ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          </div>
        </ModalWrapper>
      </div>
    </PageTransition>
  )
}

function UserRow({ user, teams, allProfiles, isSelf, saving, onSave, onTeamsChange, isAdmin, approverName, onDelete }) {
  const [reportsTo, setReportsTo] = useState(user.reports_to || '')
  const [addingTeam, setAddingTeam] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue,   setNameValue]   = useState(user.full_name || '')

  // Multi-team data from profile_teams junction
  const userTeams = (user.profile_teams || []).map(pt => ({
    team_id: pt.team_id,
    is_primary: pt.is_primary,
    role: pt.role || 'Staff',
    name: pt.team?.name || teams.find(t => t.id === pt.team_id)?.name || 'Unknown'
  }))
  const availableTeams = teams.filter(t => !userTeams.some(ut => ut.team_id === t.id))

  const dirty = reportsTo !== (user.reports_to || '') || nameValue.trim() !== (user.full_name || '')

  // For managers: can only edit unassigned users (not themselves or already-assigned users)
  const isUnassigned = userTeams.length === 0
  const canEdit = isAdmin ? !isSelf : (isUnassigned && !isSelf)

  // Eligible managers: Managers and Admins, excluding self and anyone who reports to this user (circular)
  const managerOptions = allProfiles.filter(p =>
    (p.role === 'Manager' || p.role === 'Admin')
    && p.id !== user.id
    && p.reports_to !== user.id
  )

  async function addTeamToUser(teamId) {
    const isPrimary = userTeams.length === 0 // First team = primary
    const { error } = await supabase.from('profile_teams').insert({
      profile_id: user.id,
      team_id: teamId,
      is_primary: isPrimary
    })
    if (error) { showToast(error.message, 'error'); return }

    // Sync profiles.team_id to primary team
    if (isPrimary) {
      await supabase.from('profiles').update({ team_id: teamId }).eq('id', user.id)

      // First team = user approved — send approval notification email
      supabase.functions.invoke('user-notify', {
        body: { type: 'approved', userId: user.id, approverName: approverName || 'An administrator' }
      }).catch(() => {}) // Non-blocking — don't fail the team assignment if email fails
    }

    showToast(isPrimary ? 'Team added — approval email sent' : 'Team added')
    setAddingTeam(false)
    onTeamsChange()
  }

  async function removeTeamFromUser(teamId) {
    const team = userTeams.find(t => t.team_id === teamId)
    const { error } = await supabase.from('profile_teams').delete()
      .eq('profile_id', user.id)
      .eq('team_id', teamId)
    if (error) { showToast(error.message, 'error'); return }

    // If we removed the primary, promote the next team (if any)
    if (team?.is_primary) {
      const remaining = userTeams.filter(t => t.team_id !== teamId)
      if (remaining.length > 0) {
        await supabase.from('profile_teams')
          .update({ is_primary: true })
          .eq('profile_id', user.id)
          .eq('team_id', remaining[0].team_id)
        await supabase.from('profiles').update({ team_id: remaining[0].team_id }).eq('id', user.id)
      } else {
        await supabase.from('profiles').update({ team_id: null }).eq('id', user.id)
      }
    }

    showToast('Team removed')
    onTeamsChange()
  }

  async function setPrimaryTeam(teamId) {
    // Unset current primary
    await supabase.from('profile_teams')
      .update({ is_primary: false })
      .eq('profile_id', user.id)
      .eq('is_primary', true)

    // Set new primary
    const { error } = await supabase.from('profile_teams')
      .update({ is_primary: true })
      .eq('profile_id', user.id)
      .eq('team_id', teamId)
    if (error) { showToast(error.message, 'error'); return }

    // Sync profiles.team_id
    await supabase.from('profiles').update({ team_id: teamId }).eq('id', user.id)

    showToast('Primary team updated')
    onTeamsChange()
  }

  async function updateTeamRole(teamId, newRole) {
    const { error } = await supabase.from('profile_teams')
      .update({ role: newRole })
      .eq('profile_id', user.id)
      .eq('team_id', teamId)
    if (error) { showToast(error.message, 'error'); return }
    showToast(`Role updated to ${newRole}`)
    onTeamsChange()
  }

  async function toggleAdmin() {
    const newRole = user.role === 'Admin' ? (userTeams.some(t => t.role === 'Manager') ? 'Manager' : 'Staff') : 'Admin'
    onSave({ role: newRole })
  }

  return (
    <tr className={`border-b border-slate-100 dark:border-dark-border ${isUnassigned ? 'bg-yellow-500/5' : ''}`}>
      <td className="table-td font-medium">
        <div className="flex items-center gap-2">
          {user.avatar_url
            ? <img src={user.avatar_url} className="w-6 h-6 rounded-full" alt="" />
            : <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
                {user.full_name?.[0] || '?'}
              </div>
          }
          {isAdmin && editingName ? (
            <input
              autoFocus
              value={nameValue}
              onChange={e => setNameValue(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={e => { if (e.key === 'Enter') setEditingName(false); if (e.key === 'Escape') { setNameValue(user.full_name || ''); setEditingName(false) } }}
              className="form-input py-0.5 px-1.5 text-sm min-w-[8rem]"
            />
          ) : (
            <span className="flex items-center gap-1 group/name">
              {nameValue.trim() !== (user.full_name || '') ? nameValue : user.full_name}
              {isAdmin && (
                <button
                  onClick={() => setEditingName(true)}
                  className="text-slate-300 hover:text-brand-500 dark:text-slate-600 dark:hover:text-brand-400 opacity-0 group-hover/name:opacity-100 transition-all"
                  title="Edit name"
                >
                  <Pencil size={11} />
                </button>
              )}
            </span>
          )}
          {isUnassigned && <span className="badge bg-yellow-500/15 text-yellow-700 text-xs">Needs setup</span>}
          {isSelf && <span className="badge bg-brand-50 text-brand-700 text-xs">You</span>}
        </div>
      </td>
      <td className="table-td text-slate-500 dark:text-slate-400 text-xs">{user.email}</td>
      <td className="table-td">
        <div className="flex flex-wrap items-center gap-1.5 min-w-[10rem]">
          <AnimatePresence mode="popLayout">
            {userTeams.map(t => (
              <motion.span
                key={t.team_id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium border transition-colors
                  ${t.is_primary
                    ? 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/30'
                    : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-dark-hover dark:text-slate-300 dark:border-dark-border'
                  }`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                layout
              >
                {canEdit && !t.is_primary && (
                  <button
                    onClick={() => setPrimaryTeam(t.team_id)}
                    className="text-slate-300 hover:text-brand-500 dark:text-slate-500 dark:hover:text-brand-400 transition-colors"
                    title="Set as primary team"
                  >
                    <Star size={10} />
                  </button>
                )}
                {t.is_primary && (
                  <Star size={10} className="text-brand-500 dark:text-brand-400 fill-current" />
                )}
                {t.name}
                {isAdmin && !isSelf && (
                  <button
                    onClick={() => updateTeamRole(t.team_id, t.role === 'Manager' ? 'Staff' : 'Manager')}
                    className={`text-[10px] font-semibold px-1 py-px rounded transition-colors ml-0.5
                      ${t.role === 'Manager'
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:hover:bg-amber-500/30'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-500 dark:hover:bg-slate-600'
                      }`}
                    title={`Click to change to ${t.role === 'Manager' ? 'Staff' : 'Manager'}`}
                  >
                    {t.role === 'Manager' ? 'Mgr' : 'Staff'}
                  </button>
                )}
                {!(isAdmin && !isSelf) && t.role === 'Manager' && (
                  <span className="text-[10px] font-semibold px-1 py-px rounded bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 ml-0.5">Mgr</span>
                )}
                {canEdit && (
                  <button
                    onClick={() => removeTeamFromUser(t.team_id)}
                    className="text-slate-300 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors ml-0.5"
                  >
                    <X size={10} />
                  </button>
                )}
              </motion.span>
            ))}
          </AnimatePresence>
          {canEdit && (
            addingTeam ? (
              <select
                autoFocus
                className="form-input py-0.5 px-1.5 text-xs min-w-[7rem]"
                onChange={e => { if (e.target.value) addTeamToUser(e.target.value) }}
                onBlur={() => setAddingTeam(false)}
                defaultValue=""
              >
                <option value="">Select team...</option>
                {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : availableTeams.length > 0 && (
              <button
                onClick={() => setAddingTeam(true)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-xs text-slate-400 hover:text-brand-500 hover:bg-slate-50 dark:hover:bg-dark-hover dark:text-slate-500 dark:hover:text-brand-400 border border-dashed border-slate-200 dark:border-dark-border transition-colors"
              >
                <Plus size={10} />
              </button>
            )
          )}
        </div>
      </td>
      {isAdmin && (
        <td className="table-td">
          {isSelf ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 dark:text-purple-300">
              <Shield size={12} /> Admin
            </span>
          ) : (
            <button
              onClick={toggleAdmin}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all
                ${user.role === 'Admin'
                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-300 dark:hover:bg-purple-500/30'
                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-500 dark:hover:bg-slate-600'
                }`}
              title={user.role === 'Admin' ? 'Remove Admin access' : 'Grant Admin access'}
            >
              <Shield size={12} />
              {user.role === 'Admin' ? 'Admin' : '—'}
            </button>
          )}
        </td>
      )}
      {isAdmin && (
        <td className="table-td">
          <select
            value={reportsTo}
            onChange={e => setReportsTo(e.target.value)}
            className="form-input py-1 text-xs min-w-[10rem]"
            disabled={isSelf}
          >
            <option value="">— None —</option>
            {managerOptions.map(p => (
              <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
            ))}
          </select>
        </td>
      )}
      {isAdmin && (
        <td className="table-td">
          <div className="flex items-center gap-1.5">
            {dirty && (isSelf ? nameValue.trim() !== (user.full_name || '') : true) && (
              <motion.button
                onClick={() => onSave(isSelf
                  ? { full_name: nameValue.trim() || user.full_name }
                  : { reports_to: reportsTo || null, full_name: nameValue.trim() || user.full_name }
                )}
                disabled={saving}
                className="btn-primary py-1 px-3 text-xs"
                whileTap={{ scale: 0.95 }}
              >
                {saving ? '...' : 'Save'}
              </motion.button>
            )}
            {!isSelf && (
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:text-slate-600 dark:hover:text-red-400 dark:hover:bg-red-500/10 transition-all"
                title="Delete user"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  )
}
