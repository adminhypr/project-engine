import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Users, Flame, ClipboardList, ChevronDown } from 'lucide-react'
import ContactRow from './ContactRow'
import { groupDisplayName, memberCountLabel } from '../../lib/groupConversations'
import { totalUnread } from '../../lib/chatSectionUnread'
import { useAuth } from '../../hooks/useAuth'

// Per-user collapsed state for each section in the chat widget.
// Persisted under `pe-chat-section-collapsed` so the user's choice
// survives reloads. Default = expanded for every section.
const STORAGE_KEY = 'pe-chat-section-collapsed'

function readCollapsedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function persist(next) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* noop */ }
  return next
}

function useCollapsedSections() {
  const [state, setState] = useState(readCollapsedState)
  const toggle = useCallback((key) => {
    setState(prev => persist({ ...prev, [key]: !prev[key] }))
  }, [])
  // "Collapse/expand all" against the currently-visible sections only.
  // If any visible section is expanded → collapse all. Otherwise expand all.
  const setAll = useCallback((visibleKeys, collapsed) => {
    setState(prev => {
      const next = { ...prev }
      for (const k of visibleKeys) next[k] = collapsed
      return persist(next)
    })
  }, [])
  // Listen for cross-tab updates so opening the widget on two tabs stays
  // consistent. Cheap; only fires when localStorage actually changes.
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== STORAGE_KEY) return
      setState(readCollapsedState())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return [state, toggle, setAll]
}

function SectionHeader({ title, count, unreadCount = 0, collapsed, onToggle }) {
  const ariaLabel = unreadCount > 0
    ? `${title}, ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`
    : title
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 select-none"
      aria-expanded={!collapsed}
      aria-label={ariaLabel}
    >
      <motion.span
        animate={{ rotate: collapsed ? -90 : 0 }}
        transition={{ duration: 0.15 }}
        className="inline-flex"
      >
        <ChevronDown size={11} />
      </motion.span>
      <span>{title}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-[10px] font-medium text-slate-400 normal-case tracking-normal">
          ({count})
        </span>
      )}
      {unreadCount > 0 && (
        <span
          className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white normal-case tracking-normal leading-none"
          title={`${unreadCount} unread`}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

function CollapsibleBody({ collapsed, children }) {
  return (
    <AnimatePresence initial={false}>
      {!collapsed && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Small colored dot derived from task urgency. Mirrors the UrgencyBadge colors
// in src/components/ui/index.jsx but as a compact circle suitable for a row.
function UrgencyDot({ urgency }) {
  const color =
    urgency === 'High' ? 'bg-red-500'
    : urgency === 'Med' ? 'bg-orange-500'
    : urgency === 'Low' ? 'bg-emerald-500'
    : 'bg-slate-300'
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color} flex-shrink-0`}
      title={urgency ? `${urgency} urgency` : undefined}
      aria-hidden="true"
    />
  )
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function PeopleSection({ sectionKey, title, rows, presence, onOpen, collapsed, onToggle, selectedId }) {
  if (!rows || rows.length === 0) return null
  const unread = totalUnread(rows, 'people')
  return (
    <div className="mb-2">
      <SectionHeader title={title} count={rows.length} unreadCount={unread} collapsed={collapsed} onToggle={() => onToggle(sectionKey)} />
      <CollapsibleBody collapsed={collapsed}>
        {rows.map(row => (
          <ContactRow
            key={row.profile.id}
            row={row}
            online={presence.get(row.profile.id)?.online || false}
            onClick={onOpen}
            selected={!!selectedId && row.conversation?.id === selectedId}
          />
        ))}
      </CollapsibleBody>
    </div>
  )
}

// Used for both Groups (Users icon) and Campfires (Flame icon, warmer tint).
// Campfires are kind='hub' conversations — one per project hub, named by hub.
function GroupRow({ conversation, onClick, selected = false, Icon = Users, iconClass = 'bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200' }) {
  const unread = conversation.unread || 0
  const preview = conversation.last_message_preview
  return (
    <button
      type="button"
      onClick={() => onClick(conversation.id)}
      aria-current={selected ? 'true' : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2 text-left ${
        selected ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
      }`}
    >
      <div className="relative w-9 h-9 flex-shrink-0">
        <div className={`w-9 h-9 rounded-full ${iconClass} flex items-center justify-center`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {groupDisplayName(conversation)}
          </span>
          {unread > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {preview || memberCountLabel(conversation.participants)}
        </div>
      </div>
    </button>
  )
}

function CampfiresSection({ campfires, onOpenCampfire, collapsed, onToggle, selectedId }) {
  if (!campfires || campfires.length === 0) return null
  const unread = totalUnread(campfires)
  return (
    <div className="mb-2">
      <SectionHeader title="Campfires" count={campfires.length} unreadCount={unread} collapsed={collapsed} onToggle={() => onToggle('campfires')} />
      <CollapsibleBody collapsed={collapsed}>
        {campfires.map(c => (
          <GroupRow
            key={c.id}
            conversation={c}
            onClick={onOpenCampfire}
            selected={c.id === selectedId}
            Icon={Flame}
            iconClass="bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-300"
          />
        ))}
      </CollapsibleBody>
    </div>
  )
}

function GroupsSection({ groups, onOpenGroup, collapsed, onToggle, selectedId }) {
  if (!groups || groups.length === 0) return null
  const unread = totalUnread(groups)
  return (
    <div className="mb-2">
      <SectionHeader title="Groups" count={groups.length} unreadCount={unread} collapsed={collapsed} onToggle={() => onToggle('groups')} />
      <CollapsibleBody collapsed={collapsed}>
        {groups.map(g => (
          <GroupRow key={g.id} conversation={g} onClick={onOpenGroup} selected={g.id === selectedId} />
        ))}
      </CollapsibleBody>
    </div>
  )
}

function TaskRow({ conversation, onClick }) {
  const unread = conversation.unread || 0
  const preview = conversation.last_message_preview
  const title = truncate(conversation.task_title || conversation.title || 'Task', 32)
  return (
    <button
      type="button"
      onClick={() => onClick(conversation.id)}
      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
    >
      <div className="relative w-9 h-9 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center">
          <ClipboardList className="w-4 h-4" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <UrgencyDot urgency={conversation.task_urgency} />
            <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
              {title}
            </span>
          </div>
          {unread > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {preview || 'No messages yet'}
        </div>
      </div>
    </button>
  )
}

function TasksSection({ tasks, onOpenTask, collapsed, onToggle }) {
  if (!tasks || tasks.length === 0) return null
  const unread = totalUnread(tasks)
  return (
    <div className="mb-2">
      <SectionHeader title="Tasks" count={tasks.length} unreadCount={unread} collapsed={collapsed} onToggle={() => onToggle('tasks')} />
      <CollapsibleBody collapsed={collapsed}>
        {tasks.map(t => (
          <TaskRow key={t.id} conversation={t} onClick={onOpenTask} />
        ))}
      </CollapsibleBody>
    </div>
  )
}

export default function ContactList({
  sections, groups = [], campfires = [], tasks = [], presence, onOpen, onOpenGroup, onOpenCampfire, onOpenTask, onCreateGroup,
  // Conversation id of the currently-open conversation (chat page). When set,
  // the matching row gets an active highlight. Undefined in the widget → no
  // highlight, behavior unchanged.
  selectedId,
}) {
  const { isExternal } = useAuth()
  const [collapsed, toggle, setAll] = useCollapsedSections()
  // Backward compat: callers that haven't been updated yet still pass a single
  // onOpenGroup. Hubs and groups go through the same conversation-id open
  // path, so falling back is safe.
  const handleOpenCampfire = onOpenCampfire || onOpenGroup

  const empty =
    sections.recent.length === 0 &&
    sections.teammates.length === 0 &&
    sections.company.length === 0 &&
    groups.length === 0 &&
    campfires.length === 0 &&
    tasks.length === 0

  // The set of section keys that actually render (non-empty). Used by
  // the "Collapse / Expand all" toggle so it only acts on what the user
  // can see.
  const visibleKeys = []
  if (campfires.length)          visibleKeys.push('campfires')
  if (groups.length)             visibleKeys.push('groups')
  if (tasks.length)              visibleKeys.push('tasks')
  if (!isExternal && sections.recent.length)    visibleKeys.push('recent')
  if (!isExternal && sections.teammates.length) visibleKeys.push('teammates')
  if (!isExternal && sections.company.length)   visibleKeys.push('company')

  // If at least one visible section is expanded, the next click should
  // collapse everything. Once all are collapsed, the same button expands.
  const anyExpanded = visibleKeys.some(k => !collapsed[k])
  const handleToggleAll = () => setAll(visibleKeys, anyExpanded)

  return (
    <div className="py-1">
      {onCreateGroup && !isExternal && (
        <div className="px-3 pt-2 pb-1">
          <button
            type="button"
            onClick={onCreateGroup}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-200 bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 dark:hover:bg-brand-900/50"
          >
            <Plus className="w-4 h-4" />
            New group
          </button>
        </div>
      )}
      {empty ? (
        <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No people to show.
        </div>
      ) : (
        <>
          {visibleKeys.length > 1 && (
            <div className="px-3 pt-2 pb-1 flex justify-end">
              <button
                type="button"
                onClick={handleToggleAll}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {anyExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          )}
          <CampfiresSection
            campfires={campfires}
            onOpenCampfire={handleOpenCampfire}
            collapsed={!!collapsed.campfires}
            onToggle={toggle}
            selectedId={selectedId}
          />
          <GroupsSection
            groups={groups}
            onOpenGroup={onOpenGroup}
            collapsed={!!collapsed.groups}
            onToggle={toggle}
            selectedId={selectedId}
          />
          <TasksSection
            tasks={tasks}
            onOpenTask={onOpenTask}
            collapsed={!!collapsed.tasks}
            onToggle={toggle}
          />
          {!isExternal && (
            <>
              <PeopleSection
                sectionKey="recent"
                title="Recent"
                rows={sections.recent}
                presence={presence}
                onOpen={onOpen}
                collapsed={!!collapsed.recent}
                onToggle={toggle}
                selectedId={selectedId}
              />
              <PeopleSection
                sectionKey="teammates"
                title="Teammates"
                rows={sections.teammates}
                presence={presence}
                onOpen={onOpen}
                collapsed={!!collapsed.teammates}
                onToggle={toggle}
                selectedId={selectedId}
              />
              <PeopleSection
                sectionKey="company"
                title="Company"
                rows={sections.company}
                presence={presence}
                onOpen={onOpen}
                collapsed={!!collapsed.company}
                onToggle={toggle}
                selectedId={selectedId}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
