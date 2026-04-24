import { Minus, X, ClipboardList, CheckSquare, Maximize2, Minimize2, Users, ArrowUpRight } from 'lucide-react'
import PresenceDot from './PresenceDot'
import { groupDisplayName, memberCountLabel } from '../../lib/groupConversations'

// Small colored dot matching task urgency; same palette as the Tasks list row.
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

export default function ConversationHeader({
  conversation, otherProfile, online, onMinimize, onClose,
  onAssignTask, canAssignTask,
  onAddTodo, canAddTodo,
  dragHandleProps, isMaximized, onToggleMaximize, onOpenMembers,
}) {
  const isGroup = conversation?.kind === 'group'
  const isTask = conversation?.kind === 'task'
  const name = isTask
    ? truncate(conversation.task_title || conversation.title || 'Task', 32)
    : isGroup
      ? groupDisplayName(conversation)
      : (otherProfile?.full_name || otherProfile?.email || 'Unknown')
  const subtitle = isTask
    ? (conversation.task_status || 'Task chat')
    : isGroup
      ? memberCountLabel(conversation?.participants)
      : (online ? 'Online' : 'Offline')

  const handleOpenTask = () => {
    if (!isTask || !conversation?.task_id) return
    window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: conversation.task_id } }))
    // Close the widget pane so the task detail panel becomes the focus.
    onClose?.(conversation.id)
  }

  return (
    <header className="px-3 py-2 border-b border-slate-200 dark:border-dark-border flex items-center gap-2">
      {/* Drag handle: presence dot / group icon + name/status. Buttons stay clickable. */}
      <div
        {...(dragHandleProps || {})}
        className="flex-1 min-w-0 flex items-center gap-2 cursor-grab active:cursor-grabbing select-none"
        title="Drag to reorder"
      >
        {isTask ? (
          <UrgencyDot urgency={conversation.task_urgency} />
        ) : isGroup ? (
          <div className="w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center">
            <Users className="w-3 h-3" />
          </div>
        ) : (
          <PresenceDot online={online} />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{name}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {subtitle}
          </div>
        </div>
      </div>
      {isTask && conversation.task_id && (
        <button
          type="button"
          onClick={handleOpenTask}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-900/50"
          title="Open task"
        >
          Open task
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      )}
      {canAssignTask && (
        <button
          type="button"
          onClick={onAssignTask}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-900/50"
          title="Assign task"
        >
          <ClipboardList className="w-3.5 h-3.5" />
          Assign task
        </button>
      )}
      {canAddTodo && (
        <button
          type="button"
          onClick={onAddTodo}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-900/50"
          title="Add to-do"
        >
          <CheckSquare className="w-3.5 h-3.5" />
          Add to-do
        </button>
      )}
      {isGroup && onOpenMembers && (
        <button
          type="button"
          onClick={onOpenMembers}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Group members"
          title="Group members"
        >
          <Users className="w-4 h-4" />
        </button>
      )}
      {onToggleMaximize && (
        <button
          type="button"
          onClick={onToggleMaximize}
          className="text-slate-400 hover:text-slate-600"
          aria-label={isMaximized ? 'Restore size' : 'Expand'}
          title={isMaximized ? 'Restore size' : 'Expand'}
        >
          {isMaximized
            ? <Minimize2 className="w-4 h-4" />
            : <Maximize2 className="w-4 h-4" />}
        </button>
      )}
      <button type="button" onClick={onMinimize} className="text-slate-400 hover:text-slate-600" aria-label="Minimize">
        <Minus className="w-4 h-4" />
      </button>
      <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
        <X className="w-4 h-4" />
      </button>
    </header>
  )
}
