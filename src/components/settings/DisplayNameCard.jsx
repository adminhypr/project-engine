import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui'
import { Check, RotateCcw, Loader2 } from 'lucide-react'

export default function DisplayNameCard() {
  const { profile, session, refreshProfile } = useAuth()
  const googleName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    null

  const [value, setValue] = useState(profile?.full_name || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(profile?.full_name || '')
  }, [profile?.full_name])

  if (!profile) return null

  const trimmed = value.trim()
  const dirty = trimmed !== (profile.full_name || '').trim()
  const canReset = !!googleName && (profile.full_name || '').trim() !== googleName.trim()

  async function save(next) {
    const target = (next ?? trimmed).trim()
    if (!target) {
      showToast('Name cannot be empty', 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: target })
      .eq('id', profile.id)
    setSaving(false)
    if (error) {
      showToast(error.message || 'Failed to update name', 'error')
      return
    }
    setValue(target)
    showToast('Display name updated')
    refreshProfile?.()
  }

  return (
    <div className="card p-4 mb-6">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Display name</h3>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && dirty && !saving) save() }}
          className="form-input text-sm flex-1"
          placeholder={googleName || 'Your name'}
          maxLength={80}
          disabled={saving}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!dirty || saving || !trimmed}
            onClick={() => save()}
            className="btn btn-primary text-xs flex items-center gap-1.5 disabled:opacity-40"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
          {canReset && (
            <button
              type="button"
              disabled={saving}
              onClick={() => save(googleName)}
              className="btn btn-ghost text-xs flex items-center gap-1.5 disabled:opacity-40"
              title="Reset to the name on your Google account"
            >
              <RotateCcw size={12} />
              Reset to Google name
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
        {googleName
          ? <>Default is your Google account name (<span className="font-medium">{googleName}</span>). You can customize it here.</>
          : 'Your display name is shown throughout the app.'}
      </p>
    </div>
  )
}
