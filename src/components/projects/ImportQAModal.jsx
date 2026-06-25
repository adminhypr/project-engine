import { useState, useMemo } from 'react'
import { X, Upload, Loader2, CheckCircle2, AlertTriangle, Bug as BugIcon, Inbox } from 'lucide-react'
import { ModalWrapper } from '../ui/animations'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { showToast } from '../ui'
import { mapQAItem } from '../../lib/projectBoard'

const POS_STEP = 1000

// One-time bulk importer for an external QA/backlog list. Takes a pasted JSON
// array of { taskname, description, type, status } and fans it out into the two
// LIGHTWEIGHT project tables — feature_requests (Missing Feature / Enhancement)
// and bugs (Bug). Neither is a task, so this is just two batched inserts under
// the caller's auth (member RLS applies). Done items land in the terminal status
// (request → Promoted, bug → Confirmed). Duplicates (same title already in the
// project) are skipped so a double-run can't duplicate.
export default function ImportQAModal({ project, requests, bugs, onClose }) {
  const { profile } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // Titles already in this project — dedupe target.
  const existingTitles = useMemo(() => {
    const s = new Set()
    for (const r of (requests?.requests || [])) s.add((r.title || '').trim())
    for (const b of (bugs?.bugs || [])) s.add((b.title || '').trim())
    return s
  }, [requests?.requests, bugs?.bugs])

  // Parse + map the pasted JSON, splitting fresh rows from dupes/invalids.
  const parsed = useMemo(() => {
    const t = text.trim()
    if (!t) return null
    let data
    try { data = JSON.parse(t) } catch { return { error: 'That is not valid JSON.' } }
    if (!Array.isArray(data)) return { error: 'Expected a JSON array of items.' }

    const seen = new Set()
    const fresh = []
    let invalid = 0, dupes = 0
    for (const raw of data) {
      const m = mapQAItem(raw)
      if (!m) { invalid++; continue }
      if (existingTitles.has(m.title) || seen.has(m.title)) { dupes++; continue }
      seen.add(m.title)
      fresh.push(m)
    }
    return { total: data.length, invalid, dupes, fresh }
  }, [text, existingTitles])

  const counts = useMemo(() => {
    if (!parsed?.fresh) return null
    const c = { reqRequested: 0, reqPromoted: 0, bugReported: 0, bugConfirmed: 0 }
    for (const m of parsed.fresh) {
      if (m.lane === 'bug') m.status === 'Confirmed' ? c.bugConfirmed++ : c.bugReported++
      else m.status === 'Promoted' ? c.reqPromoted++ : c.reqRequested++
    }
    return c
  }, [parsed])

  async function runImport() {
    if (!parsed?.fresh?.length || busy || !profile?.id) return
    setBusy(true)

    const reqItems = parsed.fresh.filter(m => m.lane === 'request')
    const bugItems = parsed.fresh.filter(m => m.lane === 'bug')
    const reqBase = (requests?.requests || []).reduce((mx, r) => Math.max(mx, r.pos || 0), 0)
    const bugBase = (bugs?.bugs || []).reduce((mx, b) => Math.max(mx, b.pos || 0), 0)

    const reqRows = reqItems.map((m, i) => ({
      project_id: project.id, title: m.title, description: m.description,
      requester_id: profile.id, status: m.status, pos: reqBase + (i + 1) * POS_STEP,
    }))
    const bugRows = bugItems.map((m, i) => ({
      project_id: project.id, title: m.title, description: m.description,
      reporter_id: profile.id, severity: 'Medium', status: m.status, pos: bugBase + (i + 1) * POS_STEP,
    }))

    let err = null
    if (reqRows.length) err = (await supabase.from('feature_requests').insert(reqRows)).error
    if (!err && bugRows.length) err = (await supabase.from('bugs').insert(bugRows)).error

    setBusy(false)
    if (err) { showToast(err.message || 'Import failed', 'error'); return }

    await requests?.refetch?.()
    await bugs?.refetch?.()
    setResult({ requests: reqRows.length, bugs: bugRows.length })
    showToast(`Imported ${reqRows.length + bugRows.length} items`)
  }

  const fresh = parsed?.fresh?.length || 0

  return (
    <ModalWrapper isOpen onClose={busy ? () => {} : onClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-lg p-5 shadow-elevated">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white inline-flex items-center gap-2">
            <Upload size={16} /> Import QA list
          </h3>
          <button onClick={onClose} disabled={busy} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-40"><X size={18} /></button>
        </div>

        {result ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Imported <strong>{result.requests}</strong> feature request{result.requests !== 1 ? 's' : ''} and{' '}
              <strong>{result.bugs}</strong> bug{result.bugs !== 1 ? 's' : ''} into {project.name}.
            </p>
            <button onClick={onClose} className="btn-primary text-sm px-4 py-2 mt-4">Done</button>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Paste a JSON array of <code className="text-[11px]">{'{ taskname, description, type, status }'}</code>.
              {' '}<strong>Bug</strong> → Bug lane (Done = Confirmed); <strong>Missing Feature / Enhancement</strong> → Feature Requests (Done = Promoted).
              Items whose title already exists in this project are skipped.
            </p>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder='[ { "taskname": "QA-01 [Dashboard]", "description": "…", "type": "Bug", "status": "Pending" } ]'
              rows={8}
              className="w-full resize-y rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />

            {parsed?.error && (
              <p className="mt-2 text-xs text-red-500 inline-flex items-center gap-1"><AlertTriangle size={12} /> {parsed.error}</p>
            )}

            {counts && (
              <div className="mt-3 rounded-lg border border-slate-200 dark:border-dark-border p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                  <Inbox size={13} className="text-slate-400" />
                  <span><strong>{counts.reqRequested + counts.reqPromoted}</strong> feature requests</span>
                  <span className="text-slate-400">({counts.reqRequested} Requested · {counts.reqPromoted} Promoted)</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                  <BugIcon size={13} className="text-slate-400" />
                  <span><strong>{counts.bugReported + counts.bugConfirmed}</strong> bugs</span>
                  <span className="text-slate-400">({counts.bugReported} Reported · {counts.bugConfirmed} Confirmed)</span>
                </div>
                {(parsed.dupes > 0 || parsed.invalid > 0) && (
                  <div className="text-slate-400 pt-1.5 border-t border-slate-100 dark:border-dark-border">
                    {parsed.dupes > 0 && <span>{parsed.dupes} duplicate{parsed.dupes !== 1 ? 's' : ''} skipped. </span>}
                    {parsed.invalid > 0 && <span>{parsed.invalid} invalid row{parsed.invalid !== 1 ? 's' : ''} skipped.</span>}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} disabled={busy} className="btn text-sm px-4 py-2 disabled:opacity-40">Cancel</button>
              <button
                onClick={runImport}
                disabled={busy || fresh === 0}
                className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2 disabled:opacity-40"
              >
                {busy
                  ? <><Loader2 size={14} className="animate-spin" /> Importing…</>
                  : <>Import {fresh} item{fresh !== 1 ? 's' : ''}</>}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalWrapper>
  )
}
