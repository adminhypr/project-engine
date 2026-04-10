import {
  MessageSquare, CheckCircle, Calendar, Flame, ClipboardCheck, FileText, UserPlus
} from 'lucide-react'

const EVENT_ICONS = {
  message_posted:    { icon: MessageSquare,  color: 'text-brand-500' },
  message_reply:     { icon: MessageSquare,  color: 'text-brand-400' },
  check_in_response: { icon: ClipboardCheck, color: 'text-emerald-500' },
  event_created:     { icon: Calendar,       color: 'text-amber-500' },
  chat_message:      { icon: Flame,          color: 'text-orange-500' },
  task_created:      { icon: FileText,       color: 'text-sky-500' },
  task_completed:    { icon: CheckCircle,    color: 'text-green-500' },
  member_joined:     { icon: UserPlus,       color: 'text-violet-500' },
}

export default function ActivityItem({ item }) {
  const config = EVENT_ICONS[item.event_type] || EVENT_ICONS.task_created
  const Icon = config.icon
  const time = new Date(item.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex items-start gap-3 py-2 px-2 rounded-xl hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors group">
      <div className="mt-0.5 shrink-0">
        {item.actor?.avatar_url ? (
          <img src={item.actor.avatar_url} className="w-7 h-7 rounded-full" alt="" />
        ) : (
          <div className={`w-7 h-7 rounded-full bg-slate-100 dark:bg-dark-border flex items-center justify-center`}>
            <Icon size={14} className={config.color} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-snug">
          {item.summary}
        </p>
      </div>
      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {time}
      </span>
    </div>
  )
}
