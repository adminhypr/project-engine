import { Routes, Route, useParams } from 'react-router-dom'
import { useHubTodos } from '../hooks/useHubTodos'
import { useHubs } from '../hooks/useHubs'
import { Spinner } from '../components/ui/index'
import { PageTransition } from '../components/ui/animations'
import TodosIndex from '../components/hub/todos/TodosIndex'
import TodoListPage from '../components/hub/todos/TodoListPage'
import TodoItemPage from '../components/hub/todos/TodoItemPage'

export default function HubTodosPage() {
  const { hubId } = useParams()
  const todos = useHubTodos(hubId)
  const { hubs } = useHubs()
  const hub = hubs.find(h => h.id === hubId)

  if (todos.loading) return <div className="py-20 flex justify-center"><Spinner /></div>

  const ctx = { ...todos, hubId, hub }

  return (
    <PageTransition>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Routes>
          <Route index                    element={<TodosIndex   {...ctx} />} />
          <Route path=":listId"           element={<TodoListPage {...ctx} />} />
          <Route path=":listId/items/:itemId" element={<TodoItemPage {...ctx} />} />
        </Routes>
      </div>
    </PageTransition>
  )
}
