import { useState, useMemo } from 'react'
import { X, Upload, Loader2, CheckCircle2, AlertTriangle, Bug as BugIcon, Inbox, CheckSquare } from 'lucide-react'
import { ModalWrapper } from '../ui/animations'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { showToast } from '../ui'
import { mapQAItem } from '../../lib/projectBoard'
import { generateTaskId } from '../../lib/helpers'

const POS_STEP = 1000

// One-time bulk importer for an external QA/backlog list. Takes a pasted JSON
// array of { taskname, description, type, status } and fans it out by status:
//
//   status "Done"  → a REAL completed Feature task (card in the project's Done
//                    column), assigned to the importer. Covers both bugs and
//                    features — "already tracked + completed".
//   open Bug       → a lightweight `bugs` row (Reported).
//   open anything  → a lightweight `feature_requests` row (Requested).
//
// Done items go through the task tables (so they're real board cards), open
// items stay lightweight. Member RLS applies under the caller's auth.
// Duplicates (same title already in the project) are skipped so a double-run
// can't duplicate.
export default function ImportQAModal({ project, columns, features, requests, bugs, onFeaturesRefetch, onClose }) {
  const { profile } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  // The column completed items land in (maps_to_status = 'Done').
  const doneCol = useMemo(
    () => (columns || []).find(c => c.maps_to_status === 'Done') || null,
    [columns],
  )

  // Titles already in this project — dedupe target (across all three lanes).
  const existingTitles = useMemo(() => {
    const s = new Set()
    for (const r of (requests?.requests || [])) s.add((r.title || '').trim())
    for (const b of (bugs?.bugs || [])) s.add((b.title || '').trim())
    for (const f of (features || [])) s.add((f.title || '').trim())
    return s
  }, [requests?.requests, bugs?.bugs, features])

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
    const c = { feat: 0, featFromBug: 0, req: 0, bug: 0 }
    for (const m of parsed.fresh) {
      if (m.lane === 'feature') { c.feat++; if (m.wasBug) c.featFromBug++ }
      else if (m.lane === 'bug') c.bug++
      else c.req++
    }
    return c
  }, [parsed])

  // Completed items need somewhere to land — block import if the project has no
  // Done column.
  const blockedNoDoneCol = (counts?.feat || 0) > 0 && !doneCol

  async function runImport() {
    if (!parsed?.fresh?.length || busy || !profile?.id) return
    if (blockedNoDoneCol) { showToast('This project has no "Done" column to receive completed items.', 'error'); return }
    setBusy(true)

    const featItems = parsed.fresh.filter(m => m.lane === 'feature')
    const reqItems  = parsed.fresh.filter(m => m.lane === 'request')
    const bugItems  = parsed.fresh.filter(m => m.lane === 'bug')

    let err = null
    let featCount = 0

    // 1) Completed items → real Done Feature tasks (self-assigned, in the Done
    //    column). Batched: one tasks insert + one task_assignees insert. The
    //    assignee row is created already-completed so the per-assignee
    //    aggregate (migration 044) keeps the task Done instead of reopening it.
    if (featItems.length) {
      const nowIso = new Date().toISOString()
      const colFeats = (features || []).filter(f => f.project_column_id === doneCol.id)
      const featBase = colFeats.reduce((mx, f) => Math.max(mx, f.project_pos || 0), 0)
      const taskRows = featItems.map((m, i) => ({
        task_id:           generateTaskId(),
        assigned_to:       profile.id,
        assigned_by:       profile.id,
        assignment_type:   'Self',
        team_id:           profile.team_id || null,
        title:             m.title,
        urgency:           'Med',
        notes:             m.description,
        date_assigned:     nowIso,
        status:            'Done',
        project_id:        project.id,
        project_column_id: doneCol.id,
        project_pos:       featBase + (i + 1) * POS_STEP,
      }))
      const { data: inserted, error: tErr } = await supabase.from('tasks').insert(taskRows).select('id')
      err = tErr
      if (!err && inserted?.length) {
        featCount = inserted.length
        const assigneeRows = inserted.map(t => ({
          task_id: t.id, profile_id: profile.id, is_primary: true,
          completed_at: nowIso, completed_by: profile.id,
        }))
        const { error: aErr } = await supabase.from('task_assignees').insert(assigneeRows)
        if (aErr) err = aErr
      }
    }

    // 2) Open items → lightweight backlog rows.
    if (!err && reqItems.length) {
      const reqBase = (requests?.requests || []).reduce((mx, r) => Math.max(mx, r.pos || 0), 0)
      const reqRows = reqItems.map((m, i) => ({
        project_id: project.id, title: m.title, description: m.description,
        requester_id: profile.id, status: m.status, pos: reqBase + (i + 1) * POS_STEP,
      }))
      err = (await supabase.from('feature_requests').insert(reqRows)).error
    }
    if (!err && bugItems.length) {
      const bugBase = (bugs?.bugs || []).reduce((mx, b) => Math.max(mx, b.pos || 0), 0)
      const bugRows = bugItems.map((m, i) => ({
        project_id: project.id, title: m.title, description: m.description,
        reporter_id: profile.id, severity: 'Medium', status: m.status, pos: bugBase + (i + 1) * POS_STEP,
      }))
      err = (await supabase.from('bugs').insert(bugRows)).error
    }

    setBusy(false)
    if (err) { showToast(err.message || 'Import failed', 'error'); return }

    await onFeaturesRefetch?.(true)
    await requests?.refetch?.()
    await bugs?.refetch?.()
    setResult({ features: featCount, requests: reqItems.length, bugs: bugItems.length })
    showToast(`Imported ${featCount + reqItems.length + bugItems.length} items`)
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
              Imported <strong>{result.features}</strong> completed feature{result.features !== 1 ? 's' : ''},{' '}
              <strong>{result.requests}</strong> feature request{result.requests !== 1 ? 's' : ''} and{' '}
              <strong>{result.bugs}</strong> bug{result.bugs !== 1 ? 's' : ''} into {project.name}.
            </p>
            <button onClick={onClose} className="btn-primary text-sm px-4 py-2 mt-4">Done</button>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Paste a JSON array of <code className="text-[11px]">{'{ taskname, description, type, status }'}</code>.
              {' '}<strong>status "Done"</strong> → a completed Feature card in the Done column (bugs &amp; features alike).
              {' '}Open <strong>Bug</strong> → Bug lane; open <strong>Missing Feature / Enhancement</strong> → Feature Requests.
              Items whose title already exists in this project are skipped.
            </p>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder='[ { "taskname": "Tenant profile — edit", "description": "…", "type": "Feature", "status": "Done" } ]'
              rows={8}
              className="w-full resize-y rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />

            {parsed?.error && (
              <p className="mt-2 text-xs text-red-500 inline-flex items-center gap-1"><AlertTriangle size={12} /> {parsed.error}</p>
            )}

            {counts && (
              <div className="mt-3 rounded-lg border border-slate-200 dark:border-dark-border p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                  <CheckSquare size={13} className="text-emerald-500" />
                  <span><strong>{counts.feat}</strong> completed → Done feature{counts.feat !== 1 ? 's' : ''}</span>
                  {counts.featFromBug > 0 && <span className="text-slate-400">({counts.featFromBug} from bugs)</span>}
                </div>
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                  <Inbox size={13} className="text-slate-400" />
                  <span><strong>{counts.req}</strong> open feature request{counts.req !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                  <BugIcon size={13} className="text-slate-400" />
                  <span><strong>{counts.bug}</strong> open bug{counts.bug !== 1 ? 's' : ''}</span>
                </div>
                {(parsed.dupes > 0 || parsed.invalid > 0) && (
                  <div className="text-slate-400 pt-1.5 border-t border-slate-100 dark:border-dark-border">
                    {parsed.dupes > 0 && <span>{parsed.dupes} duplicate{parsed.dupes !== 1 ? 's' : ''} skipped. </span>}
                    {parsed.invalid > 0 && <span>{parsed.invalid} invalid row{parsed.invalid !== 1 ? 's' : ''} skipped.</span>}
                  </div>
                )}
                {blockedNoDoneCol && (
                  <div className="text-red-500 pt-1.5 border-t border-slate-100 dark:border-dark-border inline-flex items-center gap-1">
                    <AlertTriangle size={12} /> This project has no “Done” column to receive completed items.
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} disabled={busy} className="btn text-sm px-4 py-2 disabled:opacity-40">Cancel</button>
              <button
                onClick={runImport}
                disabled={busy || fresh === 0 || blockedNoDoneCol}
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
