import { useState } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, Plus, Trash2, Copy, Check, Terminal, AlertTriangle } from 'lucide-react'
import { useApiKeys } from '../../hooks/useApiKeys'
import { showToast } from '../ui'

// "API Keys" settings card. Generate a personal access token for the `hypr` dev
// CLI, see your existing keys (prefix + last used), and delete them. The full
// key is shown exactly once, right after creation.
export default function ApiKeysCard() {
  const { keys, loading, create, remove } = useApiKeys()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState(null) // the just-created plaintext key
  const [copied, setCopied] = useState(false)

  const generate = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const key = await create(name)
    setBusy(false)
    if (key) { setFresh(key); setName('') }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(fresh); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { showToast('Copy failed — select and copy manually', 'error') }
  }

  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={15} className="text-brand-500" />
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">API Keys</p>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Personal access tokens for the <code className="text-[11px]">hypr</code> CLI — connect to your Dev Projects and work tasks from the terminal. A key acts as you, scoped to projects you belong to.
      </p>

      {/* Just-created key (shown once) */}
      {fresh && (
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3">
          <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200 mb-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>Copy your key now — it won't be shown again.</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-[12px] bg-white dark:bg-dark-bg rounded px-2 py-1.5 border border-amber-200 dark:border-amber-500/30">{fresh}</code>
            <button onClick={copy} className="btn-ghost text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5 shrink-0">
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </button>
          </div>
          <p className="text-[11px] text-amber-700 dark:text-amber-300/80 mt-2 inline-flex items-center gap-1.5">
            <Terminal size={12} /> Then run <code className="text-[11px]">hypr login</code> and paste it.
          </p>
          <button onClick={() => setFresh(null)} className="text-[11px] text-amber-700 dark:text-amber-300 underline mt-1">Dismiss</button>
        </div>
      )}

      {/* Existing keys */}
      <div className="space-y-1.5 mb-3">
        {loading && keys.length === 0 && <p className="text-sm text-slate-400 py-2">Loading…</p>}
        {!loading && keys.length === 0 && <p className="text-sm text-slate-400 py-2">No keys yet.</p>}
        {keys.map((k) => (
          <div key={k.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-dark-hover">
            <KeyRound size={14} className="text-slate-400 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-slate-800 dark:text-slate-100 truncate">{k.name}</span>
              <span className="block text-[11px] text-slate-400">
                <code>{k.key_prefix}…</code> · created {fmtDate(k.created_at)} · last used {k.last_used_at ? fmtDate(k.last_used_at) : 'never'}
              </span>
            </span>
            <button onClick={() => remove(k.id)} className="text-slate-400 hover:text-red-500 p-1 shrink-0" title="Delete key">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Generate */}
      <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-dark-border">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') generate() }}
          placeholder="Key name (e.g. my-laptop)"
          className="form-input text-sm flex-1"
        />
        <button onClick={generate} disabled={!name.trim() || busy} className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0">
          <Plus size={14} /> Generate
        </button>
      </div>
    </motion.div>
  )
}
