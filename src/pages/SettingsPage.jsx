import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { PageHeader, showToast } from '../components/ui'
import { PageTransition } from '../components/ui/animations'

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
      supabase.from('profiles').select('*, teams(id, name)').order('full_name'),
      supabase.from('teams').select('*').order('name')
    ])
    // Resolve manager names client-side
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

  if (loading) return <div className="p-8 text-navy-400">Loading...</div>

  return (
    <PageTransition>
      <div>
        <PageHeader title="Settings" subtitle="Manage users, teams, and roles" />

        <div className="p-6 space-y-6 max-w-7xl">

          {/* Teams */}
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-4">Teams</p>
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
                  className="flex items-center gap-2 bg-white/50 backdrop-blur-sm rounded-xl px-3 py-1.5 border border-navy-100/20"
                  layout
                >
                  <span className="text-sm font-medium">{t.name}</span>
                  <button
                    onClick={() => deleteTeam(t.id)}
                    className="text-navy-400 hover:text-red-500 text-xs transition-colors"
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
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-4">
              Users ({profiles.length})
            </p>
            <p className="text-xs text-navy-400 mb-4">
              New users appear here after they sign in for the first time. Assign them a team and role.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Email</th>
                  <th className="table-th">Team</th>
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
                  />
                ))}
              </tbody>
            </table>
          </motion.div>

        </div>
      </div>
    </PageTransition>
  )
}

function UserRow({ user, teams, allProfiles, isSelf, saving, onSave }) {
  const [teamId,    setTeamId]    = useState(user.team_id || '')
  const [role,      setRole]      = useState(user.role || 'Staff')
  const [reportsTo, setReportsTo] = useState(user.reports_to || '')

  const dirty = teamId !== (user.team_id || '')
    || role !== user.role
    || reportsTo !== (user.reports_to || '')

  // Eligible managers: Managers and Admins, excluding self and anyone who reports to this user (circular)
  const managerOptions = allProfiles.filter(p =>
    (p.role === 'Manager' || p.role === 'Admin')
    && p.id !== user.id
    && p.reports_to !== user.id // prevent direct circular
  )

  return (
    <tr className={`border-b border-navy-100/20 ${!user.team_id ? 'bg-yellow-500/5' : ''}`}>
      <td className="table-td font-medium">
        <div className="flex items-center gap-2">
          {user.avatar_url
            ? <img src={user.avatar_url} className="w-6 h-6 rounded-full" alt="" />
            : <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold">
                {user.full_name?.[0] || '?'}
              </div>
          }
          {user.full_name}
          {!user.team_id && <span className="badge bg-yellow-500/15 text-yellow-700 text-xs">Needs setup</span>}
          {isSelf && <span className="badge bg-orange-500/15 text-orange-700 text-xs">You</span>}
        </div>
      </td>
      <td className="table-td text-navy-500 text-xs">{user.email}</td>
      <td className="table-td">
        <select
          value={teamId}
          onChange={e => setTeamId(e.target.value)}
          className="form-input py-1 text-xs min-w-[8rem]"
          disabled={isSelf}
        >
          <option value="">— No team —</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
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
            onClick={() => onSave({ team_id: teamId || null, role, reports_to: reportsTo || null })}
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
