import { Minus, X, ClipboardList } from 'lucide-react'
import PresenceDot from './PresenceDot'

export default function ConversationHeader({
  otherProfile, online, onMinimize, onClose, onAssignTask, canAssignTask,
}) {
  const name = otherProfile?.full_name || otherProfile?.email || 'Unknown'
  return (
    <header className="px-3 py-2 border-b border-slate-200 dark:border-dark-border flex items-center gap-2">
      <PresenceDot online={online} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {online ? 'Online' : 'Offline'}
        </div>
      </div>
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
      <button type="button" onClick={onMinimize} className="text-slate-400 hover:text-slate-600" aria-label="Minimize">
        <Minus className="w-4 h-4" />
      </button>
      <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
        <X className="w-4 h-4" />
      </button>
    </header>
  )
}
