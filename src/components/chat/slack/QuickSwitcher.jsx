import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hash, MessageSquare, CheckSquare, Search } from 'lucide-react'
import { ModalWrapper } from '../../ui/animations'
import { buildSidebarSections } from '../../../lib/slackSidebar'
import { groupDisplayName } from '../../../lib/groupConversations'
import { fuzzyFilter } from '../../../lib/fuzzyMatch'
import PresenceDot from '../PresenceDot'

// Cmd/Ctrl+K quick switcher for the Slack /chat takeover (design Task 4.2).
//
// PRESENTATION-ONLY: it receives the contact-list result as props from
// ChatPage's SINGLE useContactList instance — it must NOT call useContactList
// itself (that would re-introduce the double-subscription bug). It reuses the
// same taxonomy helper (buildSidebarSections) and label conventions as the
// sidebar (groupDisplayName for channels, dm.name for DMs, task.title for tasks)
// so the candidate list mirrors exactly what the sidebar shows.
//
// Each candidate: { key, id, label, kind, profileId, online }
//   - id is the conversation id to navigate to (null for "start a DM" rows that
//     have no conversation yet — those resolve via createOrOpen(profileId) on
//     select, mirroring ChannelSidebar.selectDm).
//
// Props:
//   open                       — visibility
//   onClose()                  — close request (Esc / backdrop / after select)
//   sections, groups, campfires, tasks, presence — useContactList result
//   createOrOpen(profileId)    — resolve/create a DM conversation, returns its id
//   onSelectConversation(id)   — navigate to /chat/:id

export default function QuickSwitcher({
  open,
  onClose,
  sections = { recent: [], teammates: [], company: [] },
  groups = [],
  campfires = [],
  tasks = [],
  presence = new Map(),
  createOrOpen,
  onSelectConversation,
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Flatten the sidebar taxonomy into a single candidate list. Channels first,
  // then direct messages, then task chats — the order the sidebar uses.
  const candidates = useMemo(() => {
    const { channels, directMessages, taskChats } = buildSidebarSections({
      sections, groups, campfires, tasks,
    })
    const out = []
    for (const c of channels) {
      out.push({
        key: `c-${c.id}`, id: c.id, label: groupDisplayName(c) || 'Channel', kind: 'channel',
      })
    }
    for (const dm of directMessages) {
      out.push({
        key: `d-${dm.conversationId || dm.profileId}`,
        id: dm.conversationId || null,
        profileId: dm.profileId,
        label: dm.name || 'Unknown',
        kind: 'dm',
        online: !!presence.get(dm.profileId)?.online,
        status: presence.get(dm.profileId)?.status,
      })
    }
    for (const t of taskChats) {
      out.push({ key: `t-${t.id}`, id: t.id, label: t.title || 'Task', kind: 'task' })
    }
    return out
  }, [sections, groups, campfires, tasks, presence])

  // Empty query → all candidates (in taxonomy order). Typing → fuzzy-ranked.
  const results = useMemo(
    () => fuzzyFilter(q.trim(), candidates, (x) => x.label),
    [q, candidates],
  )

  // Reset query + selection each time the switcher opens; autofocus the input.
  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      // Focus after the modal mounts.
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open])

  // Keep the selection in range as the result set shrinks while typing.
  useEffect(() => {
    setSel((s) => (results.length === 0 ? 0 : Math.min(s, results.length - 1)))
  }, [results.length])

  const choose = useCallback(async (cand) => {
    if (!cand) return
    onClose?.()
    if (cand.id) {
      onSelectConversation?.(cand.id)
      return
    }
    // Start-a-DM row with no conversation yet — resolve via createOrOpen.
    if (cand.kind === 'dm' && cand.profileId) {
      const convId = await createOrOpen?.(cand.profileId)
      if (convId) onSelectConversation?.(convId)
    }
  }, [onClose, onSelectConversation, createOrOpen])

  // Keyboard nav. Esc is handled by ModalWrapper (useEscapeToClose) — we don't
  // re-handle it here to avoid double-closing.
  const onKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => (results.length === 0 ? 0 : (s + 1) % results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => (results.length === 0 ? 0 : (s - 1 + results.length) % results.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[sel])
    }
  }, [results, sel, choose])

  // Scroll the active row into view as selection moves.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${sel}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [sel])

  return (
    <ModalWrapper isOpen={open} onClose={onClose}>
      <div className="slack-chat" onKeyDown={onKeyDown}>
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-dark-border">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a conversation…"
            className="flex-1 bg-transparent text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
            aria-label="Search conversations"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No matches</p>
          ) : (
            results.map((cand, i) => (
              <button
                key={cand.key}
                type="button"
                data-idx={i}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(cand)}
                aria-current={i === sel ? 'true' : undefined}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-left ${
                  i === sel
                    ? 'bg-brand-50 dark:bg-brand-500/15'
                    : 'hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                <span className="w-5 shrink-0 grid place-items-center text-slate-400">
                  {cand.kind === 'channel' ? (
                    <Hash className="w-4 h-4" />
                  ) : cand.kind === 'task' ? (
                    <CheckSquare className="w-4 h-4" />
                  ) : cand.profileId ? (
                    <PresenceDot online={cand.online} status={cand.status} className="ring-0" />
                  ) : (
                    <MessageSquare className="w-4 h-4" />
                  )}
                </span>
                <span className="flex-1 min-w-0 truncate text-[15px] text-slate-900 dark:text-white">
                  {cand.label}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {cand.kind === 'channel' ? 'Channel' : cand.kind === 'task' ? 'Task' : 'DM'}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </ModalWrapper>
  )
}
