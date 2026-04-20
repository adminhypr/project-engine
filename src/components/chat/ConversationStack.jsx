import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import ConversationPane from './ConversationPane'
import PresenceDot from './PresenceDot'

const VISIBLE_CAP = 3

function SortablePane({ id, children }) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      {typeof children === 'function' ? children({ attributes, listeners }) : children}
    </div>
  )
}

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
  onReorder,
}) {
  const activeIds = openConversationIds.filter(id => !minimizedIds.includes(id))
  const visibleIds = activeIds.slice(-VISIBLE_CAP)
  const overflowIds = [
    ...activeIds.slice(0, Math.max(0, activeIds.length - VISIBLE_CAP)),
    ...minimizedIds,
  ]

  const byId = new Map(conversations.map(c => [c.id, c]))

  const sensors = useSensors(
    // 5px threshold so clicking header buttons (minimize/close) doesn't start a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder?.(active.id, over.id)
  }

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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleIds} strategy={horizontalListSortingStrategy}>
          {visibleIds.map(id => {
            const conv = byId.get(id)
            if (!conv) return null
            return (
              <SortablePane key={id} id={id}>
                {({ attributes, listeners }) => (
                  <ConversationPane
                    conversation={conv}
                    online={presence.get(conv.other_user_id)?.online || false}
                    onClose={onClose}
                    onMinimize={onMinimize}
                    onMarkRead={onMarkRead}
                    onAssignTask={onAssignTask}
                    dragHandleProps={{ ...attributes, ...listeners }}
                  />
                )}
              </SortablePane>
            )
          })}
        </SortableContext>
      </DndContext>
    </>
  )
}
