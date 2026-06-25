import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { isExternal } from '../lib/roleHelpers'
import { showToast } from '../components/ui/index'

// Projects list (member-scoped by RLS). Mirrors useHubs: plain select returns
// only projects where the caller is a member (projects_select = is_project_member).
export function useProjects() {
  const { profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchProjects = useCallback(async () => {
    if (!profile?.id) return
    const { data, error } = await supabase
      .from('projects')
      .select('*, project_members(profile_id, role)')
      .order('created_at', { ascending: false })
    if (error) { console.warn('projects fetch failed:', error.message); setLoading(false); return }
    const enriched = (data || []).map(p => ({
      ...p,
      member_count: p.project_members?.length || 0,
      my_role: p.project_members?.find(m => m.profile_id === profile.id)?.role || 'member',
      project_members: undefined,
    }))
    setProjects(enriched)
    setLoading(false)
  }, [profile?.id])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  const createProject = useCallback(async ({ name, description }) => {
    if (!profile?.id || !name?.trim()) return null
    if (isExternal(profile)) { showToast('External users cannot create projects', 'error'); return null }
    // Atomic project + owner row (SECURITY DEFINER RPC, migration 106).
    const { data, error } = await supabase.rpc('create_project_with_owner', {
      p_name: name.trim(),
      p_description: description?.trim() || null,
    })
    if (error || !data) {
      console.error('createProject failed:', error)
      showToast(error?.message || 'Failed to create project', 'error')
      return null
    }
    await fetchProjects()
    showToast('Project created')
    return data
  }, [profile?.id, fetchProjects])

  const updateProject = useCallback(async (projectId, updates) => {
    const { error } = await supabase.from('projects').update(updates).eq('id', projectId)
    if (error) { showToast(error.message || 'Failed to update project', 'error'); return false }
    await fetchProjects()
    return true
  }, [fetchProjects])

  const deleteProject = useCallback(async (projectId) => {
    const { error } = await supabase.from('projects').delete().eq('id', projectId)
    if (error) {
      showToast(error.message?.includes('permission')
        ? 'Only a project owner/admin can delete this project'
        : (error.message || 'Failed to delete project'), 'error')
      return false
    }
    await fetchProjects()
    showToast('Project deleted')
    return true
  }, [fetchProjects])

  return { projects, loading, createProject, updateProject, deleteProject, refetch: fetchProjects }
}

// Members of a single project (with profile detail). Add/remove/role-change are
// admin-gated by RLS; the friendly errors surface the rejection.
export function useProjectMembers(projectId) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchMembers = useCallback(async () => {
    if (!projectId) { setMembers([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('project_members')
      .select('project_id, profile_id, role, created_at, profile:profiles(id, full_name, avatar_url, email)')
      .eq('project_id', projectId)
    if (error) { console.warn('project_members fetch failed:', error.message); setLoading(false); return }
    setMembers((data || []).map(m => ({ ...m, profile: m.profile })))
    setLoading(false)
  }, [projectId])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  const addMember = useCallback(async (profileId, role = 'member') => {
    const { error } = await supabase.from('project_members').insert({ project_id: projectId, profile_id: profileId, role })
    if (error) { showToast(error.message || 'Failed to add member', 'error'); return false }
    await fetchMembers()
    return true
  }, [projectId, fetchMembers])

  const removeMember = useCallback(async (profileId) => {
    const { error } = await supabase.from('project_members').delete().eq('project_id', projectId).eq('profile_id', profileId)
    if (error) { showToast(error.message || 'Failed to remove member', 'error'); return false }
    await fetchMembers()
    return true
  }, [projectId, fetchMembers])

  const setRole = useCallback(async (profileId, role) => {
    const { error } = await supabase.from('project_members').update({ role }).eq('project_id', projectId).eq('profile_id', profileId)
    if (error) { showToast(error.message || 'Failed to change role', 'error'); return false }
    await fetchMembers()
    return true
  }, [projectId, fetchMembers])

  return { members, loading, addMember, removeMember, setRole, refetch: fetchMembers }
}
