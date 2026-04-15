import { useState, memo, useMemo } from 'react'
import { useHubTodos } from '../../hooks/useHubTodos'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../ui/index'
import TodoItem from './TodoItem'
import TodoItemDetail from './TodoItemDetail'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, EyeOff, Eye } from 'lucide-react'

function Todos({ hubId }) {
  const { profile } = useAuth()
  const {
    lists, items, loading,
    createList, updateList, deleteList,
    createItem, toggleItem, updateItem, deleteItem, reorderItems, setAssignees
  } = useHubTodos(hubId)

  const [showNewList, setShowNewList] = useState(false)
  const [newListTitle, setNewListTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingListId, setEditingListId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [collapsedLists, setCollapsedLists] = useState({})
  const [hiddenCompleted, setHiddenCompleted] = useState({})
  const [detailItem, setDetailItem] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  // Group items by list and compute progress
  const enrichedLists = useMemo(() => {
    return lists.map(list => {
      const listItems = items.filter(i => i.list_id === list.id)
      const totalItems = listItems.length
      const completedItems = listItems.filter(i => i.completed).length
      return { ...list, items: listItems, totalItems, completedItems }
    })
  }, [lists, items])

  if (loading) return <div className="py-8 flex justify-center"><Spinner /></div>

  async function handleCreateList(e) {
    e.preventDefault()
    if (!newListTitle.trim() || creating) return
    setCreating(true)
    const ok = await createList(newListTitle.trim())
    if (ok) { setShowNewList(false); setNewListTitle('') }
    setCreating(false)
  }

  async function handleEditList(id) {
    if (!editTitle.trim()) return
    await updateList(id, { title: editTitle.trim() })
    setEditingListId(null)
  }

  function handleDragEnd(listId, { active, over }) {
    if (!over || active.id === over.id) return
    const listItems = items.filter(i => i.list_id === listId)
    const ids = listItems.map(i => i.id)
    const oldIdx = ids.indexOf(active.id)
    const newIdx = ids.indexOf(over.id)
    if (oldIdx === -1 || newIdx === -1) return
    reorderItems(arrayMove(ids, oldIdx, newIdx))
  }

  function toggleCollapse(listId) {
    setCollapsedLists(prev => ({ ...prev, [listId]: !prev[listId] }))
  }

  function toggleHideCompleted(listId) {
    setHiddenCompleted(prev => ({ ...prev, [listId]: !prev[listId] }))
  }

  return (
    <div className="space-y-4">
      {/* New list button / form */}
      {!showNewList ? (
        <button onClick={() => setShowNewList(true)} className="btn btn-secondary text-xs w-full flex items-center justify-center gap-1.5">
          <Plus size={14} />
          New list
        </button>
      ) : (
        <form onSubmit={handleCreateList} className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3">
          <input
            value={newListTitle}
            onChange={e => setNewListTitle(e.target.value)}
            placeholder="List name, e.g. Launch Prep"
            className="form-input w-full text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowNewList(false); setNewListTitle('') }} className="btn btn-ghost text-xs">Cancel</button>
            <button type="submit" disabled={!newListTitle.trim() || creating} className="btn btn-primary text-xs disabled:opacity-40">
              {creating ? 'Creating...' : 'Create list'}
            </button>
          </div>
        </form>
      )}

      {enrichedLists.length === 0 && !showNewList && (
        <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">No to-do lists yet.</p>
      )}

      {/* Lists */}
      {enrichedLists.map(list => {
        const isCollapsed = collapsedLists[list.id]
        const hideCompleted = hiddenCompleted[list.id]
        const isComplete = list.totalItems > 0 && list.completedItems === list.totalItems
        const visibleItems = hideCompleted ? list.items.filter(i => !i.completed) : list.items

        return (
          <div key={list.id} className={`rounded-xl border ${isComplete ? 'border-green-200 dark:border-green-500/20' : 'border-slate-200/60 dark:border-dark-border'} bg-white dark:bg-dark-card overflow-hidden`}>
            {/* List header */}
            <div className="px-4 py-3 flex items-center gap-2">
              <button onClick={() => toggleCollapse(list.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>

              {editingListId === list.id ? (
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onBlur={() => handleEditList(list.id)}
                  onKeyDown={e => { if (e.key === 'Enter') handleEditList(list.id); if (e.key === 'Escape') setEditingListId(null) }}
                  className="form-input text-sm font-semibold flex-1 py-0.5"
                  autoFocus
                />
              ) : (
                <h3 className={`text-sm font-semibold flex-1 ${isComplete ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-slate-200'}`}>
                  {isComplete && <span className="mr-1.5">&#10003;</span>}
                  {list.title}
                </h3>
              )}

              {/* Progress */}
              {list.totalItems > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-slate-100 dark:bg-dark-border rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isComplete ? 'bg-green-500' : 'bg-brand-500'}`}
                      style={{ width: `${(list.completedItems / list.totalItems) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
                    {list.completedItems}/{list.totalItems}
                  </span>
                </div>
              )}

              {/* Actions */}
              {list.completedItems > 0 && (
                <button
                  onClick={() => toggleHideCompleted(list.id)}
                  className="p-1 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
                  title={hideCompleted ? 'Show completed' : 'Hide completed'}
                >
                  {hideCompleted ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              )}
              {editingListId !== list.id && (
                <button
                  onClick={() => { setEditingListId(list.id); setEditTitle(list.title) }}
                  className="p-1 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
                  title="Edit list"
                >
                  <Pencil size={14} />
                </button>
              )}
              <button
                onClick={() => { if (window.confirm(`Delete "${list.title}" and all its to-dos?`)) deleteList(list.id) }}
                className="p-1 text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400"
                title="Delete list"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Items */}
            {!isCollapsed && (
              <div className="border-t border-slate-100 dark:border-dark-border">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(list.id, e)}>
                  <SortableContext items={visibleItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    {visibleItems.map(item => (
                      <TodoItem
                        key={item.id}
                        item={item}
                        onToggle={() => toggleItem(item.id, item.completed)}
                        onOpen={() => setDetailItem(item)}
                        isOwn={item.created_by === profile?.id}
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                {/* Inline add */}
                <InlineAddItem listId={list.id} createItem={createItem} />
              </div>
            )}
          </div>
        )
      })}

      {/* Detail panel */}
      {detailItem && (
        <TodoItemDetail
          item={detailItem}
          hubId={hubId}
          onClose={() => setDetailItem(null)}
          onUpdate={updateItem}
          onDelete={deleteItem}
          onToggle={toggleItem}
          onSetAssignees={setAssignees}
        />
      )}
    </div>
  )
}

function InlineAddItem({ listId, createItem }) {
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!value.trim() || adding) return
    setAdding(true)
    const ok = await createItem(listId, value.trim())
    if (ok) setValue('')
    setAdding(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-50 dark:border-dark-border/50">
      <Plus size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Add a to-do..."
        className="flex-1 bg-transparent text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-300 dark:placeholder:text-slate-600 outline-none"
        disabled={adding}
      />
    </form>
  )
}

export default memo(Todos)
