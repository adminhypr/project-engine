import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import HubModuleCard from './HubModuleCard'

export default function SortableModuleCard({ id, children, ...cardProps }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : 'auto',
  }

  return (
    <div ref={setNodeRef} style={style} className="group/sortable">
      {/* Drag handle — appears on hover, positioned left of the chevron */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-3.5 right-12 z-10 p-1 rounded cursor-grab active:cursor-grabbing
                   text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400
                   opacity-0 group-hover/sortable:opacity-100 transition-opacity"
        title="Drag to reorder"
        onClick={e => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </div>
      <HubModuleCard {...cardProps}>
        {children}
      </HubModuleCard>
    </div>
  )
}
