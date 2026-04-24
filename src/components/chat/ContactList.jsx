import { Plus, Users, ClipboardList } from 'lucide-react'
import ContactRow from './ContactRow'
import { groupDisplayName, memberCountLabel } from '../../lib/groupConversations'
import { useAuth } from '../../hooks/useAuth'

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

function Section({ title, rows, presence, onOpen }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="mb-2">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {rows.map(row => (
        <ContactRow
          key={row.profile.id}
          row={row}
          online={presence.get(row.profile.id)?.online || false}
          onClick={onOpen}
        />
      ))}
    </div>
  )
}

function GroupRow({ conversation, onClick }) {
  const unread = conversation.unread || 0
  const preview = conversation.last_message_preview
  return (
    <button
      type="button"
      onClick={() => onClick(conversation.id)}
      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
    >
      <div className="relative w-9 h-9 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center">
          <Users className="w-4 h-4" />
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

function GroupsSection({ groups, onOpenGroup }) {
  if (!groups || groups.length === 0) return null
  return (
    <div className="mb-2">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Groups
      </div>
      {groups.map(g => (
        <GroupRow key={g.id} conversation={g} onClick={onOpenGroup} />
      ))}
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

function TasksSection({ tasks, onOpenTask }) {
  if (!tasks || tasks.length === 0) return null
  return (
    <div className="mb-2">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Tasks
      </div>
      {tasks.map(t => (
        <TaskRow key={t.id} conversation={t} onClick={onOpenTask} />
      ))}
    </div>
  )
}

export default function ContactList({
  sections, groups = [], tasks = [], presence, onOpen, onOpenGroup, onOpenTask, onCreateGroup,
}) {
  const { isExternal } = useAuth()

  const empty =
    sections.recent.length === 0 &&
    sections.teammates.length === 0 &&
    sections.company.length === 0 &&
    groups.length === 0 &&
    tasks.length === 0

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
          <GroupsSection groups={groups} onOpenGroup={onOpenGroup} />
          <TasksSection tasks={tasks} onOpenTask={onOpenTask} />
          {!isExternal && (
            <>
              <Section title="Recent"    rows={sections.recent}    presence={presence} onOpen={onOpen} />
              <Section title="Teammates" rows={sections.teammates} presence={presence} onOpen={onOpen} />
              <Section title="Company"   rows={sections.company}   presence={presence} onOpen={onOpen} />
            </>
          )}
        </>
      )}
    </div>
  )
}
