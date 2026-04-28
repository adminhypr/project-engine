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
      <HubModuleCard
        {...cardProps}
        dragHandleProps={{ ...attributes, ...listeners }}
      >
        {children}
      </HubModuleCard>
    </div>
  )
}
