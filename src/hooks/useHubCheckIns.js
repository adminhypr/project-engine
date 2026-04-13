import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubCheckIns(hubId) {
  const { profile } = useAuth()
  const [prompts, setPrompts]     = useState([])
  const [responses, setResponses] = useState([])
  const [loading, setLoading]     = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchData = useCallback(async () => {
    if (!hubRef.current) return
    const [{ data: promptData, error: pErr }, { data: responseData, error: rErr }] = await Promise.all([
      supabase
        .from('hub_check_in_prompts')
        .select('*, creator:profiles!hub_check_in_prompts_created_by_fkey(id, full_name)')
        .eq('hub_id', hubRef.current)
        .eq('active', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('hub_check_in_responses')
        .select('*, author:profiles!hub_check_in_responses_author_id_fkey(id, full_name, avatar_url), prompt:hub_check_in_prompts!inner(hub_id)')
        .eq('prompt.hub_id', hubRef.current)
        .order('response_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100)
    ])
    if (pErr || rErr) showToast('Failed to load check-ins', 'error')
    setPrompts(promptData || [])
    setResponses(responseData || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!hubId) return
    setLoading(true)
    fetchData()
  }, [hubId, fetchData])

  useEffect(() => {
    if (!hubId) return
    const channel = supabase
      .channel(`hub-checkins-${hubId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_check_in_responses' },
        (payload) => {
          const promptIds = new Set(prompts.map(p => p.id))
          if (promptIds.has(payload.new?.prompt_id)) fetchData()
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId, fetchData, prompts])

  const createPrompt = useCallback(async (question, schedule = 'daily') => {
    if (!hubRef.current || !profile?.id) return false
    const { error } = await supabase.from('hub_check_in_prompts').insert({
      hub_id: hubRef.current,
      created_by: profile.id,
      question, schedule
    })
    if (error) { showToast('Failed to create check-in', 'error'); return false }
    await fetchData()
    return true
  }, [profile?.id, fetchData])

  const submitResponse = useCallback(async (promptId, content, mentions = []) => {
    if (!profile?.id || !content.trim()) return false
    const { data, error } = await supabase.from('hub_check_in_responses').upsert({
      prompt_id: promptId,
      author_id: profile.id,
      content: content.trim(),
      mentions,
      response_date: new Date().toISOString().split('T')[0]
    }, { onConflict: 'prompt_id,author_id,response_date' }).select().single()
    if (error) { showToast('Failed to submit response', 'error'); return false }

    if (data && mentions.length > 0) {
      // For upserts, clean old mentions first
      await supabase.from('hub_mentions').delete().eq('entity_type', 'check_in_response').eq('entity_id', data.id)
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile.id)
      if (uniqueUsers.length > 0) {
        const prompt = prompts.find(p => p.id === promptId)
        const hId = prompt?.hub_id || hubRef.current
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hId,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'check_in_response',
            entity_id: data.id,
          }))
        )
      }
    }
    await fetchData()
    return true
  }, [profile?.id, fetchData, prompts])

  const deletePrompt = useCallback(async (promptId) => {
    const { error } = await supabase.from('hub_check_in_prompts').update({ active: false }).eq('id', promptId)
    if (error) showToast('Failed to remove check-in', 'error')
    await fetchData()
  }, [fetchData])

  return { prompts, responses, loading, createPrompt, submitResponse, deletePrompt }
}
