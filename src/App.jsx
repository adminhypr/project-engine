import { Profiler, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { logRender } from './lib/refreshDiagnostic'
import { PresenceProvider } from './hooks/PresenceContext'
import { TasksProvider, ProfilesProvider } from './hooks/useTasks'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
// MyTasksPage stays eager — it's the default landing route. Everything
// else is reachable only via navigation, so lazy-loading those pages
// strips ~600-800 KB off the initial bundle without any first-paint
// cost for /my-tasks visitors.
import MyTasksPage from './pages/MyTasksPage'
const AssignTaskPage     = lazy(() => import('./pages/AssignTaskPage'))
const TeamViewPage       = lazy(() => import('./pages/TeamViewPage'))
const AdminOverviewPage  = lazy(() => import('./pages/AdminOverviewPage'))
const ReportsPage        = lazy(() => import('./pages/reports/ReportsPage'))
const SettingsPage       = lazy(() => import('./pages/SettingsPage'))
const HubPage            = lazy(() => import('./pages/HubPage'))
const HubTodosPage       = lazy(() => import('./pages/HubTodosPage'))
const ToDoPage           = lazy(() => import('./pages/ToDoPage'))
const ChatPage           = lazy(() => import('./pages/ChatPage'))
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './hooks/useTheme'
import ChatWidget from './components/chat/ChatWidget'

function RouteFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function AppRoutes() {
  const { session, loading, profile, refreshProfile, isExternal } = useAuth()
  const location = useLocation()
  // The floating chat widget is redundant on the dedicated chat page — hide it
  // there so the launcher bubble doesn't overlap the conversation composer.
  const onChatPage = location.pathname === '/chat' || location.pathname.startsWith('/chat/')

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-500 dark:text-slate-400 text-sm">Loading...</p>
      </div>
    </div>
  )

  if (!session) return <LoginPage />

  const hasTeam = profile?.team_id || profile?.team_ids?.length > 0
  if (!profile || (!hasTeam && profile.role !== 'Admin')) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg px-4">
      <div className="bg-white dark:bg-dark-card rounded-3xl border border-slate-200 dark:border-dark-border shadow-elevated max-w-md w-full text-center p-6 sm:p-8">
        <div className="text-4xl mb-4">👋</div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Welcome to Hypr Task</h2>
        <p className="text-slate-500 dark:text-slate-400">
          {!profile
            ? 'Loading your profile... If this persists, try refreshing.'
            : 'Your account has been created. An admin needs to assign your team and role before you can access the app.'}
        </p>
        <p className="text-sm text-slate-400 mt-4">Logged in as: {profile?.email || session?.user?.email}</p>
        {!profile && (
          <button
            onClick={refreshProfile}
            className="mt-4 px-4 py-2 bg-brand-500 text-white rounded-xl text-sm font-semibold hover:bg-brand-600 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )

  const rootTarget = isExternal ? '/to-do' : '/my-tasks'

  function InternalOnly({ children }) {
    if (isExternal) return <Navigate to="/to-do" replace />
    return children
  }

  // The dedicated chat page is a full-viewport Slack-style takeover — it must
  // render WITHOUT the normal app Layout chrome (top/side nav). Branch it out
  // here so it owns the whole screen. The floating ChatWidget is still hidden
  // via the same onChatPage check below.
  if (onChatPage) {
    return (
      <Profiler id="AppRoutes" onRender={logRender}>
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/chat"                  element={<ChatPage />} />
              <Route path="/chat/:conversationId"  element={<ChatPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Profiler>
    )
  }

  return (
    <Profiler id="AppRoutes" onRender={logRender}>
      <Profiler id="Layout" onRender={logRender}>
        <Layout>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <AnimatePresence mode="wait">
                <Routes>
                  <Route path="/"         element={<Navigate to={rootTarget} replace />} />
                  <Route path="/my-tasks" element={<InternalOnly><Profiler id="MyTasksPage" onRender={logRender}><MyTasksPage /></Profiler></InternalOnly>} />
                  <Route path="/assign"   element={<InternalOnly><AssignTaskPage /></InternalOnly>} />
                  <Route path="/to-do"    element={<ToDoPage />} />
                  {/* /team-chat retired → dedicated chat page (the team group shows in the sidebar). */}
                  <Route path="/team-chat" element={<Navigate to="/chat" replace />} />
                  <Route path="/hub"        element={<HubPage />} />
                  <Route path="/hub/:hubId" element={<HubPage />} />
                  <Route path="/hub/:hubId/todos/*" element={<HubTodosPage />} />
                  <Route path="/team"     element={<InternalOnly><TeamViewPage /></InternalOnly>} />
                  <Route path="/admin"    element={<InternalOnly><Profiler id="AdminOverviewPage" onRender={logRender}><AdminOverviewPage /></Profiler></InternalOnly>} />
                  <Route path="/reports"  element={<InternalOnly><ReportsPage /></InternalOnly>} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*"         element={<Navigate to={rootTarget} replace />} />
                </Routes>
              </AnimatePresence>
            </Suspense>
          </ErrorBoundary>
        </Layout>
      </Profiler>
      {!isExternal && !onChatPage && (
        <Profiler id="ChatWidget" onRender={logRender}>
          <ChatWidget />
        </Profiler>
      )}
    </Profiler>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <PresenceProvider>
            <ProfilesProvider>
              <TasksProvider>
                <AppRoutes />
              </TasksProvider>
            </ProfilesProvider>
          </PresenceProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
