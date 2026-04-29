import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../../../lib/supabase'
import { useHubCardColumns } from '../../../hooks/useHubCardColumns'
import { useHubCards } from '../../../hooks/useHubCards'
import { useHubMembers } from '../../../hooks/useHubMembers'
import { showToast } from '../../ui/index'
import CardSteps from './CardSteps'
import CardComments from './CardComments'
import { X, Trash2, Plus, Check } from 'lucide-react'

// Inline assignee picker — pattern lifted from
// `src/components/hub/todos/TodoItemPage.jsx` (toggle button reveals
// member list with multi-select check icons). Scoped to hub members.
function AssigneePicker({ hubId, assignedIds, onAdd }) {
  const { members } = useHubMembers(hubId)
  const [open, setOpen] = useState(false)

  const candidates = (members || [])
    .map(m => m.profile || m)
    .filter(p => p?.id && !assignedIds.includes(p.id))

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 hover:text-brand-500 hover:border-brand-400"
      >
        <Plus size={11} /> Add
      </button>
    )
  }

  if (candidates.length === 0) {
    return (
      <span className="text-xs text-slate-400">
        No more members
        <button onClick={() => setOpen(false)} className="ml-2 text-slate-500 hover:text-slate-700">
          <X size={11} className="inline" />
        </button>
      </span>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-slate-300 dark:border-slate-600 text-slate-500"
      >
        <X size={11} /> Close
      </button>
      <div className="absolute left-0 top-full mt-1 z-10 w-56 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated p-1 space-y-0.5">
        {candidates.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={async () => {
              await onAdd(p.id)
              setOpen(false)
            }}
            className="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-sm hover:bg-slate-50 dark:hover:bg-dark-hover"
          >
            {p.avatar_url ? (
              <img src={p.avatar_url} className="w-6 h-6 rounded-full" alt="" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
                {p.full_name?.[0] || '?'}
              </div>
            )}
            <span className="flex-1 truncate">{p.full_name}</span>
            <Check size={12} className="text-slate-300" />
          </button>
        ))}
      </div>
    </div>
  )
}

export default function CardDetailPanel({ moduleId, hubId }) {
  const [params, setParams] = useSearchParams()
  const cardId = params.get('card')
  const [card, setCard] = useState(null)
  const { columns } = useHubCardColumns(moduleId)
  const { updateCard, deleteCard, assignCard, unassignCard } = useHubCards(moduleId)

  useEffect(() => {
    if (!cardId) { setCard(null); return }
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('hub_cards')
        .select('*, assignees:hub_card_assignees(profile:profiles(id, full_name, avatar_url))')
        .eq('id', cardId).maybeSingle()
      if (alive && data) setCard({ ...data, assignees: (data.assignees || []).map(a => a.profile).filter(Boolean) })
    })()
    return () => { alive = false }
  }, [cardId])

  // Realtime: keep the panel's local card row + assignees in sync with
  // edits coming from the kanban grid (move column, rename title, etc.).
  useEffect(() => {
    if (!cardId) return
    const ch = supabase.channel(`card-detail-${cardId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_cards', filter: `id=eq.${cardId}` },
        async () => {
          const { data } = await supabase
            .from('hub_cards')
            .select('*, assignees:hub_card_assignees(profile:profiles(id, full_name, avatar_url))')
            .eq('id', cardId).maybeSingle()
          if (data) setCard({ ...data, assignees: (data.assignees || []).map(a => a.profile).filter(Boolean) })
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_card_assignees', filter: `card_id=eq.${cardId}` },
        async () => {
          const { data } = await supabase
            .from('hub_cards')
            .select('*, assignees:hub_card_assignees(profile:profiles(id, full_name, avatar_url))')
            .eq('id', cardId).maybeSingle()
          if (data) setCard(prev => prev ? { ...prev, assignees: (data.assignees || []).map(a => a.profile).filter(Boolean) } : prev)
        }
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [cardId])

  function close() {
    const next = new URLSearchParams(params)
    next.delete('card')
    setParams(next)
  }

  // Esc to close + lock body scroll while panel is open. Mirrors the
  // ExpandedModuleModal pattern so card detail and module-expand feel
  // alike — Basecamp's full-page card view rather than a side panel.
  useEffect(() => {
    if (!cardId) return
    function onKey(e) { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [cardId])

  if (!cardId || !card) return null

  const assignedIds = (card.assignees || []).map(a => a.id)

  return (
    <AnimatePresence>
      <motion.div
        key="card-detail-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] bg-black/60 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
        onClick={close}
      >
        <motion.div
          key="card-detail-panel"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0,  scale: 1 }}
          exit={{ opacity: 0, y: 8,    scale: 0.98 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="bg-white dark:bg-dark-card rounded-2xl shadow-elevated w-full max-w-3xl my-auto flex flex-col"
          style={{ minHeight: '60vh', maxHeight: '92vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header — close button only; title is editable below in the body */}
          <div className="flex items-center justify-end px-5 py-3 border-b border-slate-100 dark:border-dark-border shrink-0">
            <button
              type="button"
              onClick={close}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 sm:px-10 py-6">
            <input
              value={card.title}
              onChange={e => setCard({ ...card, title: e.target.value })}
              onBlur={() => updateCard(card.id, { title: card.title })}
              placeholder="Card title"
              aria-label="Card title"
              className="text-2xl font-bold bg-transparent w-full focus:outline-none focus:ring-0 mb-5"
            />

            <dl className="grid grid-cols-[110px_1fr] gap-y-3 text-sm mb-6">
              <dt className="text-slate-500 self-center">Column</dt>
              <dd>
                <select
                  value={card.column_id}
                  onChange={async e => { await updateCard(card.id, { column_id: e.target.value }); setCard({ ...card, column_id: e.target.value }) }}
                  className="form-input py-1 text-sm"
                >
                  {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </dd>

              <dt className="text-slate-500 self-center">Due on</dt>
              <dd>
                <input
                  type="date"
                  value={card.due_date || ''}
                  onChange={async e => {
                    const v = e.target.value || null
                    await updateCard(card.id, { due_date: v })
                    setCard({ ...card, due_date: v })
                  }}
                  className="form-input py-1 text-sm"
                />
              </dd>

              <dt className="text-slate-500 self-center">Assigned</dt>
              <dd className="flex items-center gap-1 flex-wrap">
                {(card.assignees || []).map(a => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 dark:bg-dark-hover rounded-full text-xs">
                    {a.full_name}
                    <button onClick={() => unassignCard(card.id, a.id)} className="text-slate-400 hover:text-red-500"><X size={11} /></button>
                  </span>
                ))}
                <AssigneePicker
                  hubId={hubId}
                  assignedIds={assignedIds}
                  onAdd={async (profileId) => { await assignCard(card.id, [profileId]) }}
                />
              </dd>
            </dl>

            <section className="mb-6">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Notes</h4>
              <textarea
                value={card.notes || ''}
                onChange={e => setCard({ ...card, notes: e.target.value })}
                onBlur={() => updateCard(card.id, { notes: card.notes })}
                placeholder="Add notes…"
                rows={6}
                className="form-input w-full text-sm"
              />
            </section>

            <section className="mb-6">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Steps</h4>
              <CardSteps cardId={card.id} />
            </section>

            <section className="mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Comments</h4>
              <CardComments cardId={card.id} hubId={hubId} />
            </section>

            <div className="pt-4 border-t border-slate-100 dark:border-dark-border flex justify-end">
              <button
                onClick={async () => {
                  if (!confirm('Delete this card?')) return
                  const ok = await deleteCard(card.id)
                  if (ok) { showToast('Card deleted'); close() }
                }}
                className="btn btn-ghost text-red-500 text-sm inline-flex items-center gap-1"
              >
                <Trash2 size={13} /> Delete card
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
