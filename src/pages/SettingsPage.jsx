import { useState, useEffect, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { PageHeader, showToast } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import { Star, X, Send, Mail, Pencil, Trash2, Check, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { ModalWrapper } from '../components/ui/animations'
import AvatarCard from '../components/settings/AvatarCard'
import DisplayNameCard from '../components/settings/DisplayNameCard'
import NotificationSoundCard from '../components/settings/NotificationSoundCard'
import EmailDigestCard from '../components/settings/EmailDigestCard'
import ApiKeysCard from '../components/settings/ApiKeysCard'
import { setPendingInvite } from '../lib/pendingInvites'
import { usePageTitle } from '../hooks/usePageTitle'
import { getAccountType, getAccessLevel, summarizeTeams, filterUsers } from '../lib/userAccess'
import UserDrawer from '../components/settings/UserDrawer'

export default function SettingsPage() {
  usePageTitle('Settings')
  const { profile, isAdmin, isManager, isExternal } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [teams,    setTeams]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [newTeam,  setNewTeam]  = useState('')
  const [newTeamKind, setNewTeamKind] = useState('internal')
  const [teamPopoverId, setTeamPopoverId] = useState(null)
  // Collapsed role sections in the Admin Users table. Defaults to all
  // expanded; ephemeral (no localStorage). Adding 'Other' would be a
  // no-op since that section only renders when non-empty.
  const [collapsedRoles, setCollapsedRoles] = useState(() => new Set())
  // Users table filters + the drawer's selected user (drawer reads the LIVE
  // profile row so refetches flow straight into it).
  const [userSearch,     setUserSearch]     = useState('')
  const [filterTeamId,   setFilterTeamId]   = useState('')
  const [filterType,     setFilterType]     = useState('')
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole,  setInviteRole]  = useState('Staff')
  const [inviteTeamId, setInviteTeamId] = useState('')
  const [inviting,    setInviting]    = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)
  const [renamingTeamId, setRenamingTeamId] = useState(null)
  const [renameValue,    setRenameValue]    = useState('')
  const [deleteTeamTarget,      setDeleteTeamTarget]      = useState(null)
  const [deleteTeamConfirmText, setDeleteTeamConfirmText] = useState('')
  const [deletingTeam,          setDeletingTeam]          = useState(false)

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

  async function addTeam() {
    if (!newTeam.trim()) return
    const { error } = await supabase.from('teams').insert({ name: newTeam.trim(), kind: newTeamKind })
    if (error) showToast(error.message, 'error')
    else { showToast('Team added'); setNewTeam(''); fetchAll() }
  }

  function startRenameTeam(team) {
    setRenamingTeamId(team.id)
    setRenameValue(team.name)
    setTeamPopoverId(null)
  }

  function cancelRenameTeam() {
    setRenamingTeamId(null)
    setRenameValue('')
  }

  async function commitRenameTeam(team) {
    const next = renameValue.trim()
    if (!next || next === team.name) { cancelRenameTeam(); return }
    const { error } = await supabase.from('teams').update({ name: next }).eq('id', team.id)
    if (error) showToast(error.message, 'error')
    else { showToast('Team renamed'); cancelRenameTeam(); fetchAll() }
  }

  function startDeleteTeam(team) {
    setDeleteTeamTarget(team)
    setDeleteTeamConfirmText('')
    setTeamPopoverId(null)
  }

  async function confirmDeleteTeam() {
    if (!deleteTeamTarget) return
    if (deleteTeamConfirmText.trim() !== deleteTeamTarget.name) return
    setDeletingTeam(true)
    const { error } = await supabase.from('teams').delete().eq('id', deleteTeamTarget.id)
    setDeletingTeam(false)
    if (error) showToast(error.message, 'error')
    else {
      showToast('Team deleted')
      setDeleteTeamTarget(null)
      setDeleteTeamConfirmText('')
      fetchAll()
    }
  }

  async function updateTeamKind(id, kind) {
    const { error } = await supabase.from('teams').update({ kind }).eq('id', id)
    if (error) showToast(error.message, 'error')
    else { showToast(`Moved to ${kind === 'external' ? 'External' : 'Internal'}`); setTeamPopoverId(null); fetchAll() }
  }

  async function sendInvite() {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    if (!inviteTeamId) { showToast('Pick a team for the invite', 'error'); return }
    setInviting(true)
    // Record intended role + team so the first team-assignment in the Users
    // table (post sign-in) can apply them. Stored per-browser in localStorage.
    setPendingInvite(email, {
      role: inviteRole,
      teamId: inviteTeamId,
      inviterName: profile?.full_name || 'A team member'
    })
    const { error } = await supabase.functions.invoke('user-notify', {
      body: { type: 'invite', email, inviterName: profile?.full_name || 'A team member' }
    })
    setInviting(false)
    if (error) showToast('Failed to send invite', 'error')
    else {
      showToast('Invite sent to ' + email)
      setInviteEmail('')
      setInviteRole('Staff')
      // Keep inviteTeamId so repeat invites to the same team are quick
    }
  }

  async function deleteProfile() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.functions.invoke('admin-delete-user', {
      body: { userId: deleteTarget.id }
    })
    setDeleting(false)
    if (error) showToast(error.message || 'Failed to delete user', 'error')
    else {
      showToast(`${deleteTarget.full_name} has been deleted`)
      if (selectedUserId === deleteTarget.id) setSelectedUserId(null)
      setDeleteTarget(null)
      fetchAll()
    }
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

  // Role options for the invite form.
  //   Admin can create Manager accounts; Manager cannot (no Manager option).
  //   Both can create Agent / Client externals.
  const inviteRoleOptions = isAdmin
    ? ['Staff', 'Manager', 'Agent', 'Client']
    : ['Staff', 'Agent', 'Client']

  // Default inviteTeamId to the first eligible team once data loads.
  useEffect(() => {
    if (!loading && !inviteTeamId && managerTeams.length > 0) {
      setInviteTeamId(managerTeams[0].id)
    }
  }, [loading, managerTeams, inviteTeamId])

  // Keep inviteRole valid when role options change (e.g. Manager→Admin).
  useEffect(() => {
    if (!inviteRoleOptions.includes(inviteRole)) setInviteRole('Staff')
  }, [inviteRoleOptions, inviteRole])

  // Manager: only show unassigned users + themselves (for context)
  const visibleProfiles = isAdmin
    ? profiles
    : profiles.filter(p => {
        const hasTeams = p.profile_teams && p.profile_teams.length > 0
        return !hasTeams || p.id === profile?.id
      })

  const unassignedCount = profiles.filter(p => !p.profile_teams || p.profile_teams.length === 0).length

  // Search + Type/Team filters applied before grouping.
  const filteredProfiles = filterUsers(visibleProfiles, {
    search: userSearch, teamId: filterTeamId, type: filterType,
  })

  // Admin view: pin team-less users in a "Needs setup" section on top, then
  // split the rest into role-based sections mirroring the global hierarchy
  // (Admin / Manager / Staff / Agent / Client). Pure display-side grouping —
  // `profiles.role` is already synced to the canonical value via the
  // role-sync trigger (010). Manager view keeps the flat list — the filter
  // above narrows it to unassigned users + self.
  const needsSetupProfiles = isAdmin
    ? filteredProfiles.filter(p => !p.profile_teams || p.profile_teams.length === 0)
    : []
  const assignedProfiles = isAdmin
    ? filteredProfiles.filter(p => p.profile_teams && p.profile_teams.length > 0)
    : []
  const ROLE_SECTIONS = [
    { key: 'Admin',   label: 'Admins' },
    { key: 'Manager', label: 'Managers' },
    { key: 'Staff',   label: 'Staff' },
    { key: 'Agent',   label: 'Agents' },
    { key: 'Client',  label: 'Clients' },
  ]
  const profilesByRole = isAdmin
    ? ROLE_SECTIONS.map(s => ({ ...s, users: assignedProfiles.filter(p => p.role === s.key) }))
    : null
  // Defensive — surface any profile with an unrecognised role so we don't
  // silently hide them. Should be empty in practice.
  const unclassifiedProfiles = isAdmin
    ? assignedProfiles.filter(p => !ROLE_SECTIONS.some(s => s.key === p.role))
    : []

  const selectedUser = selectedUserId
    ? (profiles.find(p => p.id === selectedUserId) || null)
    : null

  function toggleRoleSection(key) {
    setCollapsedRoles(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function collapseAllRoles() {
    const all = ROLE_SECTIONS.map(s => s.key)
    if (unclassifiedProfiles.length > 0) all.push('Other')
    setCollapsedRoles(new Set(all))
  }
  function expandAllRoles() {
    setCollapsedRoles(new Set())
  }
  const allRoleKeys = isAdmin
    ? [...ROLE_SECTIONS.map(s => s.key), ...(unclassifiedProfiles.length > 0 ? ['Other'] : [])]
    : []
  const allCollapsed = isAdmin && allRoleKeys.length > 0 && allRoleKeys.every(k => collapsedRoles.has(k))

  if (loading) return <div className="p-8 text-slate-400 dark:text-slate-500">Loading...</div>

  return (
    <PageTransition>
      <div>
        <PageHeader
          title="Settings"
          subtitle={isAdmin ? 'Manage users, teams, and roles' : isManager ? `${unassignedCount} user${unassignedCount !== 1 ? 's' : ''} need${unassignedCount === 1 ? 's' : ''} team assignment` : 'Manage your account'}
        />

        <div className="p-4 sm:p-6 space-y-6 max-w-7xl">

          <AvatarCard />
          <DisplayNameCard />
          <NotificationSoundCard />

          <EmailDigestCard />
          <ApiKeysCard />

          {/* Teams — admin only */}
          {isAdmin && (
            <motion.div
              className="card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Teams</p>
              <div className="flex flex-col sm:flex-row gap-2 mb-2">
                <input
                  type="text"
                  value={newTeam}
                  onChange={e => setNewTeam(e.target.value)}
                  placeholder="New team name..."
                  className="form-input flex-1"
                  onKeyDown={e => e.key === 'Enter' && addTeam()}
                />
                <div className="flex gap-2">
                  <div className="inline-flex rounded-xl bg-slate-100 dark:bg-dark-bg border border-slate-200 dark:border-dark-border p-0.5">
                    <button
                      type="button"
                      onClick={() => setNewTeamKind('internal')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${newTeamKind === 'internal' ? 'bg-white dark:bg-dark-surface shadow-soft text-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >Internal</button>
                    <button
                      type="button"
                      onClick={() => setNewTeamKind('external')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${newTeamKind === 'external' ? 'bg-white dark:bg-dark-surface shadow-soft text-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >External</button>
                  </div>
                  <button className="btn-primary" onClick={addTeam}>Add Team</button>
                </div>
              </div>

              {['internal', 'external'].map(kind => {
                const list = teams.filter(t => (t.kind || 'internal') === kind)
                const label = kind === 'internal' ? 'Internal Teams (Company)' : 'External Teams (Clients)'
                return (
                  <div key={kind} className="mt-5">
                    <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{label}</p>
                    {list.length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-600 italic">No {kind} teams yet</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {list.map(t => (
                          <div key={t.id} className="relative">
                            {renamingTeamId === t.id ? (
                              <div className="flex items-center gap-1 bg-white dark:bg-dark-surface rounded-xl px-2 py-1 border border-brand-300 dark:border-brand-600">
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={e => setRenameValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') commitRenameTeam(t)
                                    else if (e.key === 'Escape') cancelRenameTeam()
                                  }}
                                  autoFocus
                                  className="form-input !py-1 !px-2 !text-sm w-32"
                                />
                                <button
                                  type="button"
                                  onClick={() => commitRenameTeam(t)}
                                  className="p-1 text-emerald-600 hover:text-emerald-700"
                                  title="Save"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelRenameTeam}
                                  className="p-1 text-slate-400 hover:text-slate-600"
                                  title="Cancel"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <motion.button
                                type="button"
                                onClick={() => setTeamPopoverId(teamPopoverId === t.id ? null : t.id)}
                                className="flex items-center gap-2 bg-white dark:bg-dark-surface rounded-xl px-3 py-1.5 border border-slate-100 dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                                layout
                              >
                                <span className="text-sm font-medium">{t.name}</span>
                              </motion.button>
                            )}
                            <AnimatePresence>
                              {teamPopoverId === t.id && renamingTeamId !== t.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setTeamPopoverId(null)}
                                  />
                                  <motion.div
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                    transition={{ duration: 0.12 }}
                                    className="absolute z-50 left-0 top-full mt-1 min-w-[180px] bg-white dark:bg-dark-surface rounded-xl border border-slate-200 dark:border-dark-border shadow-elevated overflow-hidden"
                                  >
                                    <button
                                      onClick={() => startRenameTeam(t)}
                                      className="w-full text-left text-sm px-3 py-2 hover:bg-slate-50 dark:hover:bg-dark-bg transition-colors inline-flex items-center gap-2"
                                    >
                                      <Pencil size={13} />
                                      Rename
                                    </button>
                                    <button
                                      onClick={() => updateTeamKind(t.id, kind === 'internal' ? 'external' : 'internal')}
                                      className="w-full text-left text-sm px-3 py-2 hover:bg-slate-50 dark:hover:bg-dark-bg transition-colors"
                                    >
                                      Move to {kind === 'internal' ? 'External' : 'Internal'}
                                    </button>
                                    <div className="border-t border-slate-100 dark:border-dark-border" />
                                    <button
                                      onClick={() => startDeleteTeam(t)}
                                      className="w-full text-left text-sm px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors inline-flex items-center gap-2"
                                    >
                                      <Trash2 size={13} />
                                      Delete team
                                    </button>
                                  </motion.div>
                                </>
                              )}
                            </AnimatePresence>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </motion.div>
          )}

          {/* Invite User — manager/admin only, hidden for external account types (Agent/Client) */}
          {isManager && !isExternal && (
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.025 }}
          >
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Invite User</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              Send an email invitation to a new user. They'll sign in with their Google account.
              Their role and team will be applied the first time you grant them team access after they sign in.
            </p>
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[16rem]">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="form-input pl-9 w-full"
                  onKeyDown={e => e.key === 'Enter' && sendInvite()}
                />
              </div>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="form-input text-sm min-w-[7rem]"
                aria-label="Role"
              >
                {inviteRoleOptions.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <select
                value={inviteTeamId}
                onChange={e => setInviteTeamId(e.target.value)}
                className="form-input text-sm min-w-[10rem]"
                aria-label="Team"
                disabled={managerTeams.length === 0}
              >
                {managerTeams.length === 0 && <option value="">No teams available</option>}
                {managerTeams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                className="btn-primary inline-flex items-center gap-2"
                onClick={sendInvite}
                disabled={inviting || !inviteEmail.trim() || !inviteTeamId}
              >
                <Send size={14} />
                {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </motion.div>
          )}

          {/* Users — manager/admin only, hidden for external account types (Agent/Client) */}
          {isManager && !isExternal && (
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {isAdmin ? `Users (${profiles.length})` : `New Users (${unassignedCount})`}
              </p>
              {isAdmin && allRoleKeys.length > 0 && (
                <button
                  type="button"
                  onClick={allCollapsed ? expandAllRoles : collapseAllRoles}
                  className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                >
                  {allCollapsed ? 'Expand all' : 'Collapse all'}
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              {isAdmin
                ? 'New users appear here after they sign in for the first time. Assign them teams and a role.'
                : 'Assign new users to one of your teams so they can start using the app.'}
            </p>
            {/* Search + filters */}
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search name, email, or team..."
                  className="form-input py-1.5 px-3 text-sm flex-1 min-w-[200px]"
                  aria-label="Search users"
                />
                <select
                  value={filterTeamId}
                  onChange={e => setFilterTeamId(e.target.value)}
                  className="form-input py-1.5 px-2 text-xs"
                  aria-label="Filter by team"
                >
                  <option value="">All teams</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  className="form-input py-1.5 px-2 text-xs"
                  aria-label="Filter by account type"
                >
                  <option value="">All types</option>
                  <option value="Internal">Internal</option>
                  <option value="Agent">Agent</option>
                  <option value="Client">Client</option>
                </select>
              </div>
            )}
            {visibleProfiles.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">No users need setup.</p>
            ) : filteredProfiles.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">No users match the current filters.</p>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="table-th">User</th>
                    <th className="table-th">Type</th>
                    <th className="table-th">Access</th>
                    <th className="table-th">Teams</th>
                    {isAdmin && <th className="table-th">Reports To</th>}
                    <th className="table-th" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {isAdmin ? (
                    <>
                      {needsSetupProfiles.length > 0 && (
                        <>
                          <tr>
                            <td colSpan={6} className="pt-5 pb-2">
                              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">
                                <AlertTriangle size={12} />
                                Needs setup ({needsSetupProfiles.length})
                              </span>
                            </td>
                          </tr>
                          {needsSetupProfiles.map(p => (
                            <UserSummaryRow key={p.id} user={p} isSelf={p.id === profile?.id} isAdmin={isAdmin} onOpen={() => setSelectedUserId(p.id)} />
                          ))}
                        </>
                      )}
                      {profilesByRole.map(section => {
                        const isCollapsed = collapsedRoles.has(section.key)
                        // With active filters, hide sections with no matches
                        // instead of showing a misleading "No X yet".
                        const filtering = !!(userSearch.trim() || filterTeamId || filterType)
                        if (filtering && section.users.length === 0) return null
                        return (
                          <Fragment key={section.key}>
                            <tr>
                              <td colSpan={6} className="pt-5 pb-2">
                                <button
                                  type="button"
                                  onClick={() => toggleRoleSection(section.key)}
                                  className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                                  aria-expanded={!isCollapsed}
                                >
                                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                  <span>{section.label} ({section.users.length})</span>
                                </button>
                              </td>
                            </tr>
                            {!isCollapsed && (
                              section.users.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="text-xs text-slate-400 dark:text-slate-600 italic py-2 pl-5">
                                    No {section.label.toLowerCase()} yet
                                  </td>
                                </tr>
                              ) : (
                                section.users.map(p => (
                                  <UserSummaryRow key={p.id} user={p} isSelf={p.id === profile?.id} isAdmin={isAdmin} onOpen={() => setSelectedUserId(p.id)} />
                                ))
                              )
                            )}
                          </Fragment>
                        )
                      })}
                      {unclassifiedProfiles.length > 0 && (() => {
                        const isCollapsed = collapsedRoles.has('Other')
                        return (
                          <Fragment>
                            <tr>
                              <td colSpan={6} className="pt-5 pb-2">
                                <button
                                  type="button"
                                  onClick={() => toggleRoleSection('Other')}
                                  className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                                  aria-expanded={!isCollapsed}
                                >
                                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                  <span>Other ({unclassifiedProfiles.length})</span>
                                </button>
                              </td>
                            </tr>
                            {!isCollapsed && unclassifiedProfiles.map(p => (
                              <UserSummaryRow key={p.id} user={p} isSelf={p.id === profile?.id} isAdmin={isAdmin} onOpen={() => setSelectedUserId(p.id)} />
                            ))}
                          </Fragment>
                        )
                      })()}
                    </>
                  ) : (
                    filteredProfiles.map(p => (
                      <UserSummaryRow key={p.id} user={p} isSelf={p.id === profile?.id} isAdmin={isAdmin} onOpen={() => setSelectedUserId(p.id)} />
                    ))
                  )}
                </tbody>
              </table>
              </div>
            )}
          </motion.div>
          )}

          {/* Per-user edit drawer — reads the LIVE profile row so refetches
              flow straight in. Manager edit rules are enforced inside. */}
          {isManager && !isExternal && (
            <UserDrawer
              user={selectedUser}
              teams={isAdmin ? teams : managerTeams}
              allProfiles={profiles}
              isAdmin={isAdmin}
              currentProfileId={profile?.id}
              approverName={profile?.full_name}
              onChanged={fetchAll}
              onClose={() => setSelectedUserId(null)}
              onDelete={(u) => setDeleteTarget(u)}
            />
          )}

        </div>

        {/* Delete team confirmation modal — requires typing the team name */}
        <ModalWrapper
          isOpen={!!deleteTeamTarget}
          onClose={() => !deletingTeam && (setDeleteTeamTarget(null), setDeleteTeamConfirmText(''))}
        >
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">Delete Team</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-200 mb-2">
              Deleting <strong>{deleteTeamTarget?.name}</strong> will:
            </p>
            <ul className="text-xs text-slate-500 dark:text-slate-400 mb-4 list-disc pl-5 space-y-1">
              <li>Remove every member's assignment to this team</li>
              <li>Delete this team's group chat</li>
              <li>Detach hubs and tasks (they remain, with no team)</li>
            </ul>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Type <span className="font-mono text-slate-900 dark:text-white">{deleteTeamTarget?.name}</span> to confirm
            </label>
            <input
              type="text"
              value={deleteTeamConfirmText}
              onChange={e => setDeleteTeamConfirmText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && deleteTeamConfirmText.trim() === deleteTeamTarget?.name && !deletingTeam) {
                  confirmDeleteTeam()
                }
              }}
              className="form-input w-full mb-5"
              autoFocus
              disabled={deletingTeam}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setDeleteTeamTarget(null); setDeleteTeamConfirmText('') }}
                disabled={deletingTeam}
                className="btn-ghost px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteTeam}
                disabled={deletingTeam || deleteTeamConfirmText.trim() !== deleteTeamTarget?.name}
                className="btn-danger px-4 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} />
                {deletingTeam ? 'Deleting...' : 'Delete Team'}
              </button>
            </div>
          </div>
        </ModalWrapper>

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

// Read-only summary row for the Users table. All editing lives in UserDrawer
// (click the row). See docs/plans/2026-07-05-settings-redesign-design.md.
function UserSummaryRow({ user, isSelf, isAdmin, onOpen }) {
  const accountType = getAccountType(user)
  const accessLevel = getAccessLevel(user)
  const { visible, overflow } = summarizeTeams(user.profile_teams)
  const isUnassigned = !user.profile_teams || user.profile_teams.length === 0

  const typeBadge = accountType === 'Agent'
    ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
    : accountType === 'Client'
      ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
      : 'bg-slate-100 text-slate-600 dark:bg-dark-hover dark:text-slate-300'
  const accessBadge = accessLevel === 'Admin'
    ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'
    : accessLevel === 'Manager'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
      : 'bg-slate-100 text-slate-500 dark:bg-dark-hover dark:text-slate-400'

  return (
    <tr
      onClick={onOpen}
      className={`border-b border-slate-100 dark:border-dark-border cursor-pointer transition-colors
        hover:bg-slate-50 dark:hover:bg-dark-hover/50 ${isUnassigned ? 'bg-yellow-500/5' : ''}`}
    >
      <td className="table-td">
        <div className="flex items-center gap-2.5">
          {user.avatar_url
            ? <img src={user.avatar_url} className="w-7 h-7 rounded-full" alt="" />
            : <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
                {user.full_name?.[0] || '?'}
              </div>
          }
          <div className="min-w-0">
            <div className="font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
              <span className="truncate">{user.full_name}</span>
              {isSelf && <span className="badge bg-brand-50 text-brand-700 text-[10px]">You</span>}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 truncate">{user.email}</div>
          </div>
        </div>
      </td>
      <td className="table-td">
        <span className={`badge text-[11px] ${typeBadge}`}>{accountType}</span>
      </td>
      <td className="table-td">
        {accessLevel
          ? <span className={`badge text-[11px] ${accessBadge}`}>{accessLevel}</span>
          : <span className="text-slate-300 dark:text-slate-600 text-xs">&mdash;</span>}
      </td>
      <td className="table-td">
        {isUnassigned ? (
          <span className="badge bg-yellow-500/15 text-yellow-700 text-[10px]">Needs setup</span>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {visible.map(t => (
              <span key={t.team_id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200 dark:bg-dark-hover dark:text-slate-300 dark:border-dark-border">
                {t.is_primary && <Star size={9} className="text-brand-500 dark:text-brand-400 fill-current" />}
                {t.name}
              </span>
            ))}
            {overflow > 0 && (
              <span className="text-xs text-slate-400 dark:text-slate-500">+{overflow}</span>
            )}
          </div>
        )}
      </td>
      {isAdmin && (
        <td className="table-td text-xs text-slate-500 dark:text-slate-400">
          {user.manager?.full_name || <span className="text-slate-300 dark:text-slate-600">&mdash;</span>}
        </td>
      )}
      <td className="table-td w-8 text-right">
        <ChevronRight size={14} className="inline text-slate-300 dark:text-slate-600" />
      </td>
    </tr>
  )
}
