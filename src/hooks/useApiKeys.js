import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'

// Personal access tokens for the `hypr` dev CLI (migration 112). The plaintext
// key is generated + hashed CLIENT-SIDE; only the sha256 hash + a display prefix
// are stored, so the server never sees the secret. The full key is returned from
// create() exactly once for the caller to show.

function randomKey() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return 'hypr_' + hex
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function useApiKeys() {
  const { profile } = useAuth()
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchKeys = useCallback(async () => {
    if (!profile?.id) { setKeys([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, name, key_prefix, last_used_at, created_at')
      .order('created_at', { ascending: false })
    if (error) { console.warn('api_keys fetch failed:', error.message); setLoading(false); return }
    setKeys(data || [])
    setLoading(false)
  }, [profile?.id])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  // Returns the plaintext key ONCE (null on failure). Never retrievable again.
  const create = useCallback(async (name) => {
    if (!profile?.id || !name?.trim()) return null
    const key = randomKey()
    const key_hash = await sha256hex(key)
    const { error } = await supabase.from('api_keys').insert({
      profile_id: profile.id,
      name: name.trim(),
      key_prefix: key.slice(0, 13), // "hypr_" + first 8 hex
      key_hash,
    })
    if (error) { showToast(error.message || 'Failed to create key', 'error'); return null }
    await fetchKeys()
    return key
  }, [profile?.id, fetchKeys])

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from('api_keys').delete().eq('id', id)
    if (error) { showToast(error.message || 'Failed to delete key', 'error'); return }
    await fetchKeys()
  }, [fetchKeys])

  return { keys, loading, create, remove }
}
