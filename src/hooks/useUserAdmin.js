import { supabase } from '../lib/supabase'
import { showToast } from '../components/ui'
import { getPendingInvite, clearPendingInvite } from '../lib/pendingInvites'

// All admin/manager user-management writes for the Settings page, extracted
// from UserRow (phase 2 of docs/plans/2026-07-05-settings-redesign-design.md)
// so the table row and the edit drawer share one implementation. Bodies are
// the original UserRow logic, parameterized by `user` — same queries, same
// toasts, same user-notify calls, same sticky-role rules (migration 038).
//
// `onChanged` is the refetch callback (SettingsPage.fetchAll). `approverName`
// personalizes the first-team approval email.
export function useUserAdmin({ approverName, onChanged }) {
  const userTeamsOf = (user) => (user.profile_teams || []).map(pt => ({
    team_id: pt.team_id,
    is_primary: pt.is_primary,
    role: pt.role || 'Staff',
  }))

  async function updateProfile(id, updates) {
    const { error } = await supabase.from('profiles').update(updates).eq('id', id)
    if (error) showToast(error.message, 'error')
    else { showToast('Updated'); onChanged() }
  }

  async function addTeamToUser(user, teamId) {
    const userTeams = userTeamsOf(user)
    const isPrimary = userTeams.length === 0 // First team = primary

    // If this is the user's first team and they have a pending invite that
    // specified a role (Agent/Client/Manager/Staff), apply that role to the
    // new profile_teams row. Otherwise default to 'Staff' per the DB default.
    const pending = isPrimary ? getPendingInvite(user.email) : null
    const invitedRole = pending?.role
    const insertBody = {
      profile_id: user.id,
      team_id: teamId,
      is_primary: isPrimary
    }
    if (invitedRole) insertBody.role = invitedRole

    const { error } = await supabase.from('profile_teams').insert(insertBody)
    if (error) { showToast(error.message, 'error'); return }

    // Sync profiles.team_id to primary team
    if (isPrimary) {
      const profileUpdates = { team_id: teamId }
      // Sticky roles: set profiles.role directly for Agent/Client so the
      // role-sync trigger (migration 038) leaves it untouched on future
      // per-team changes. 'Manager'/'Staff' are left to the trigger.
      if (invitedRole === 'Agent' || invitedRole === 'Client') {
        profileUpdates.role = invitedRole
      }
      await supabase.from('profiles').update(profileUpdates).eq('id', user.id)

      // First team = user approved — send approval notification email
      supabase.functions.invoke('user-notify', {
        body: { type: 'approved', userId: user.id, approverName: approverName || 'An administrator' }
      }).catch(() => {}) // Non-blocking — don't fail the team assignment if email fails

      if (pending) clearPendingInvite(user.email)
    }

    showToast(isPrimary ? 'Team added — approval email sent' : 'Team added')
    onChanged()
  }

  async function removeTeamFromUser(user, teamId) {
    const userTeams = userTeamsOf(user)
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
    onChanged()
  }

  async function setPrimaryTeam(user, teamId) {
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
    onChanged()
  }

  async function updateTeamRole(user, teamId, newRole) {
    const { error } = await supabase.from('profile_teams')
      .update({ role: newRole })
      .eq('profile_id', user.id)
      .eq('team_id', teamId)
    if (error) { showToast(error.message, 'error'); return }

    // Sticky global roles: Agent/Client must also be set on profiles.role
    // (the role-sync trigger treats them as sticky and will NEVER write
    // those values itself — it only syncs Staff/Manager). Admin is
    // preserved as-is and is set via the Admin toggle elsewhere.
    if (newRole === 'Agent' || newRole === 'Client') {
      if (user.role !== newRole && user.role !== 'Admin') {
        await supabase.from('profiles').update({ role: newRole }).eq('id', user.id)
      }
    } else if ((newRole === 'Staff' || newRole === 'Manager') &&
               (user.role === 'Agent' || user.role === 'Client')) {
      // Converting an external back to an internal: clear sticky role so
      // the trigger can resume syncing from per-team rows.
      await supabase.from('profiles').update({ role: newRole }).eq('id', user.id)
    }

    showToast(`Role updated to ${newRole}`)
    onChanged()
  }

  async function toggleAdmin(user) {
    const userTeams = userTeamsOf(user)
    const newRole = user.role === 'Admin' ? (userTeams.some(t => t.role === 'Manager') ? 'Manager' : 'Staff') : 'Admin'
    await updateProfile(user.id, { role: newRole })
  }

  // Account type for the drawer: Internal | Agent | Client. Writes the sticky
  // global role directly and re-labels every profile_teams row to match, so
  // the per-team rows and the global role never disagree. Going back to
  // Internal writes Staff everywhere and lets the 010 trigger resume syncing.
  // Admins are guarded upstream (drawer disables the control).
  async function setAccountType(user, type) {
    if (user.role === 'Admin') { showToast('Remove Admin access first', 'error'); return }
    const targetRole = type === 'Internal' ? 'Staff' : type
    const { error } = await supabase.from('profiles').update({ role: targetRole }).eq('id', user.id)
    if (error) { showToast(error.message, 'error'); return }
    const { error: ptError } = await supabase.from('profile_teams')
      .update({ role: targetRole })
      .eq('profile_id', user.id)
    if (ptError) { showToast(ptError.message, 'error'); return }
    showToast(type === 'Internal' ? 'Converted to internal user' : `Account type set to ${type}`)
    onChanged()
  }

  async function deleteUser(user) {
    const { error } = await supabase.functions.invoke('admin-delete-user', {
      body: { userId: user.id }
    })
    if (error) { showToast(error.message || 'Failed to delete user', 'error'); return false }
    showToast(`${user.full_name} has been deleted`)
    onChanged()
    return true
  }

  return {
    updateProfile,
    addTeamToUser,
    removeTeamFromUser,
    setPrimaryTeam,
    updateTeamRole,
    toggleAdmin,
    setAccountType,
    deleteUser,
  }
}
