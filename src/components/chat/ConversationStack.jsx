import ConversationPane from './ConversationPane'
import PresenceDot from './PresenceDot'

const VISIBLE_CAP = 3

export default function ConversationStack({
  openConversationIds,
  minimizedIds,
  conversations,
  presence,
  onClose,
  onMinimize,
  onRestore,
  onMarkRead,
  onAssignTask,
}) {
  const activeIds = openConversationIds.filter(id => !minimizedIds.includes(id))
  const visibleIds = activeIds.slice(-VISIBLE_CAP)
  const overflowIds = [
    ...activeIds.slice(0, Math.max(0, activeIds.length - VISIBLE_CAP)),
    ...minimizedIds,
  ]

  const byId = new Map(conversations.map(c => [c.id, c]))

  function Tab({ id }) {
    const conv = byId.get(id)
    if (!conv) return null
    const other = conv.other_profile
    const online = presence.get(conv.other_user_id)?.online || false
    const initial = (other?.full_name || '?').charAt(0).toUpperCase()
    return (
      <button
        type="button"
        onClick={() => onRestore(id)}
        className="relative w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold flex items-center justify-center shadow-soft"
        aria-label={`Restore conversation with ${other?.full_name || 'contact'}`}
      >
        {other?.avatar_url
          ? <img src={other.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
          : <span>{initial}</span>}
        <span className="absolute bottom-0 right-0"><PresenceDot online={online} /></span>
        {conv.unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {conv.unread > 9 ? '9+' : conv.unread}
          </span>
        )}
      </button>
    )
  }

  return (
    <>
      {overflowIds.length > 0 && (
        <div className="flex flex-col gap-2 mr-1">
          {overflowIds.map(id => <Tab key={id} id={id} />)}
        </div>
      )}
      {visibleIds.map(id => {
        const conv = byId.get(id)
        if (!conv) return null
        return (
          <ConversationPane
            key={id}
            conversation={conv}
            online={presence.get(conv.other_user_id)?.online || false}
            onClose={onClose}
            onMinimize={onMinimize}
            onMarkRead={onMarkRead}
            onAssignTask={onAssignTask}
          />
        )
      })}
    </>
  )
}
