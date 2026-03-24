import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { PageHeader, showToast } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import { Star, X, Plus, ChevronDown } from 'lucide-react'

export default function SettingsPage() {
  const { profile } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [teams,    setTeams]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [newTeam,  setNewTeam]  = useState('')
  const [saving,   setSaving]   = useState({})

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from('profiles').select('*, teams!profiles_team_id_fkey(id, name), profile_teams!profile_teams_profile_id_fkey(team_id, is_primary, team:teams!profile_teams_team_id_fkey(id, name))').order('full_name'),
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

  if (loading) return <div className="p-8 text-slate-400 dark:text-slate-500">Loading...</div>

  return (
    <PageTransition>
      <div>
        <PageHeader title="Settings" subtitle="Manage users, teams, and roles" />

        <div className="p-4 sm:p-6 space-y-6 max-w-7xl">

          {/* Teams */}
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

          {/* Users */}
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
          >
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
              Users ({profiles.length})
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              New users appear here after they sign in for the first time. Assign them teams and a role.
            </p>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Email</th>
                  <th className="table-th">Teams</th>
                  <th className="table-th">Role</th>
                  <th className="table-th">Reports To</th>
                  <th className="table-th">Save</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => (
                  <UserRow
                    key={p.id}
                    user={p}
                    teams={teams}
                    allProfiles={profiles}
                    isSelf={p.id === profile?.id}
                    saving={saving[p.id]}
                    onSave={(updates) => updateProfile(p.id, updates)}
                    onTeamsChange={fetchAll}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </motion.div>

        </div>
      </div>
    </PageTransition>
  )
}

function UserRow({ user, teams, allProfiles, isSelf, saving, onSave, onTeamsChange }) {
  const [role,      setRole]      = useState(user.role || 'Staff')
  const [reportsTo, setReportsTo] = useState(user.reports_to || '')
  const [addingTeam, setAddingTeam] = useState(false)

  // Multi-team data from profile_teams junction
  const userTeams = (user.profile_teams || []).map(pt => ({
    team_id: pt.team_id,
    is_primary: pt.is_primary,
    name: pt.team?.name || teams.find(t => t.id === pt.team_id)?.name || 'Unknown'
  }))
  const availableTeams = teams.filter(t => !userTeams.some(ut => ut.team_id === t.id))

  const dirty = role !== user.role || reportsTo !== (user.reports_to || '')

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
    }

    showToast('Team added')
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

  return (
    <tr className={`border-b border-slate-100 dark:border-dark-border ${userTeams.length === 0 ? 'bg-yellow-500/5' : ''}`}>
      <td className="table-td font-medium">
        <div className="flex items-center gap-2">
          {user.avatar_url
            ? <img src={user.avatar_url} className="w-6 h-6 rounded-full" alt="" />
            : <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
                {user.full_name?.[0] || '?'}
              </div>
          }
          {user.full_name}
          {userTeams.length === 0 && <span className="badge bg-yellow-500/15 text-yellow-700 text-xs">Needs setup</span>}
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
                {!isSelf && !t.is_primary && (
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
                {!isSelf && (
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
          {!isSelf && (
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
      <td className="table-td">
        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="form-input py-1 text-xs min-w-[6.5rem]"
          disabled={isSelf}
        >
          <option>Staff</option>
          <option>Manager</option>
          <option>Admin</option>
        </select>
      </td>
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
      <td className="table-td">
        {!isSelf && dirty && (
          <motion.button
            onClick={() => onSave({ role, reports_to: reportsTo || null })}
            disabled={saving}
            className="btn-primary py-1 px-3 text-xs"
            whileTap={{ scale: 0.95 }}
          >
            {saving ? '...' : 'Save'}
          </motion.button>
        )}
      </td>
    </tr>
  )
}
