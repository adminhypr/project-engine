import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Mail } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { showToast } from '../ui'

// Per-user toggle for the offline notification digest. When OFF, the
// 15-min digest cron skips this user entirely. The bell still shows
// everything in real-time — this only controls email behavior.
export default function EmailDigestCard() {
  const { profile } = useAuth()
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!profile?.id) return
    supabase
      .from('profiles')
      .select('email_digest_enabled')
      .eq('id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data?.email_digest_enabled !== null && data?.email_digest_enabled !== undefined) {
          setEnabled(data.email_digest_enabled)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [profile?.id])

  async function toggle(next) {
    if (!profile?.id) return
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ email_digest_enabled: next })
      .eq('id', profile.id)
    setSaving(false)
    if (error) {
      showToast('Failed to save preference', 'error')
      return
    }
    setEnabled(next)
    showToast(next ? 'Email summaries on' : 'Email summaries off')
  }

  return (
    <motion.div
      className="card p-4 sm:p-5"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-start gap-3">
        <Mail size={18} className="text-brand-500 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Email summary when offline</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Get one summary email every 15 minutes covering everything you missed (comments, mentions, messages, new tasks). Sent only when you've been away from the app for 5+ minutes. The notification bell still works in real-time regardless.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
          <input
            type="checkbox"
            checked={enabled}
            disabled={loading || saving}
            onChange={(e) => toggle(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-200 dark:bg-dark-hover rounded-full peer peer-checked:bg-brand-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-5"></div>
        </label>
      </div>
    </motion.div>
  )
}
