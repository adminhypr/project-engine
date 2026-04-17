import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Trash2, EyeOff, Eye } from 'lucide-react'
import TodoBreadcrumb from './TodoBreadcrumb'
import NewItemForm from './NewItemForm'
import TodoItemRow from './TodoItemRow'
import TrashedToast from './TrashedToast'
import { todoColorClass } from './todoColors'

export default function TodoListPage({ hubId, hub, lists, items, createItem, toggleItem, deleteItem, undoDeleteItem, deleteList, undoDeleteList }) {
  const { listId } = useParams()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [trashedItemId, setTrashedItemId] = useState(null)

  const list = lists.find(l => l.id === listId)
  const listItems = useMemo(() => items.filter(i => i.list_id === listId), [items, listId])

  if (!list) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-500">List not found.</p>
      </div>
    )
  }

  const total = listItems.length
  const done  = listItems.filter(i => i.completed).length
  const visible = hideCompleted ? listItems.filter(i => !i.completed) : listItems

  async function handleDeleteList() {
    if (!window.confirm(`Delete "${list.title}" and all its to-dos?`)) return
    await deleteList(list.id)
    navigate(`/hub/${hubId}/todos`)
  }

  return (
    <div>
      <TodoBreadcrumb segments={[
        { label: hub?.name || 'Hub', to: `/hub/${hubId}` },
        { label: 'To-dos',            to: `/hub/${hubId}/todos` },
        { label: list.title },
      ]} />

      <div className="flex items-center gap-3 mb-4">
        <span className={`w-3.5 h-3.5 rounded-full shrink-0 ${todoColorClass(list.color)}`} />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white truncate">{list.title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{done}/{total} completed</p>
        </div>
        {done > 0 && (
          <button
            onClick={() => setHideCompleted(v => !v)}
            className="btn btn-ghost text-xs flex items-center gap-1"
            title={hideCompleted ? 'Show completed' : 'Hide completed'}
          >
            {hideCompleted ? <Eye size={12} /> : <EyeOff size={12} />}
            {hideCompleted ? 'Show completed' : 'Hide completed'}
          </button>
        )}
        <button onClick={handleDeleteList} className="btn btn-ghost text-xs text-red-500 flex items-center gap-1">
          <Trash2 size={12} /> Delete list
        </button>
      </div>

      {list.description && (
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 whitespace-pre-wrap">{list.description}</p>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card overflow-hidden mb-4">
        {showNew ? (
          <div className="p-3">
            <NewItemForm
              listId={list.id}
              hubId={hubId}
              onCreate={createItem}
              onCancel={() => setShowNew(false)}
            />
          </div>
        ) : (
          <button
            onClick={() => setShowNew(true)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-dark-hover"
          >
            <Plus size={14} />
            Add a to-do
          </button>
        )}

        {visible.map(item => (
          <TodoItemRow
            key={item.id}
            item={item}
            hubId={hubId}
            listId={list.id}
            onToggle={toggleItem}
          />
        ))}

        {visible.length === 0 && !showNew && (
          <p className="text-center text-xs text-slate-400 py-6">No to-dos yet.</p>
        )}
      </div>

      {trashedItemId && (
        <TrashedToast
          message="The to-do is in the trash."
          onUndo={() => undoDeleteItem(trashedItemId)}
          onDismiss={() => setTrashedItemId(null)}
        />
      )}
    </div>
  )
}
