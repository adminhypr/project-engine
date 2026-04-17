import { useState, useMemo } from 'react'
import { Plus } from 'lucide-react'
import TodoBreadcrumb from './TodoBreadcrumb'
import NewListForm from './NewListForm'
import TodoListRow from './TodoListRow'
import TrashedToast from './TrashedToast'

export default function TodosIndex({ hubId, hub, lists, items, createList, deleteList, undoDeleteList }) {
  const [showNewList, setShowNewList] = useState(false)
  const [trashedListId, setTrashedListId] = useState(null)

  const enriched = useMemo(() => lists.map(list => {
    const listItems = items.filter(i => i.list_id === list.id)
    return { ...list, totalItems: listItems.length, completedItems: listItems.filter(i => i.completed).length }
  }), [lists, items])

  return (
    <div>
      <TodoBreadcrumb segments={[
        { label: hub?.name || 'Hub', to: `/hub/${hubId}` },
        { label: 'To-dos' },
      ]} />

      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setShowNewList(v => !v)}
          className="btn btn-primary text-xs flex items-center gap-1.5"
        >
          <Plus size={13} />
          New list
        </button>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-200">To-dos</h1>
        <div className="w-[74px]" />
      </div>

      {showNewList && (
        <div className="mb-4">
          <NewListForm
            hubId={hubId}
            onCreate={createList}
            onCancel={() => setShowNewList(false)}
          />
        </div>
      )}

      {enriched.length === 0 && !showNewList && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-12">
          No lists yet. Click <span className="font-semibold">New list</span> to start one.
        </p>
      )}

      <div className="space-y-2.5">
        {enriched.map(list => (
          <TodoListRow key={list.id} list={list} hubId={hubId} />
        ))}
      </div>

      {trashedListId && (
        <TrashedToast
          message="The to-do list is in the trash."
          onUndo={() => undoDeleteList(trashedListId)}
          onDismiss={() => setTrashedListId(null)}
        />
      )}
    </div>
  )
}
