import { Profiler } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { logRender } from './lib/refreshDiagnostic'
import { PresenceProvider } from './hooks/PresenceContext'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
import MyTasksPage from './pages/MyTasksPage'
import AssignTaskPage from './pages/AssignTaskPage'
import TeamViewPage from './pages/TeamViewPage'
import AdminOverviewPage from './pages/AdminOverviewPage'
import ReportsPage from './pages/reports/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import HubPage from './pages/HubPage'
import HubTodosPage from './pages/HubTodosPage'
import ToDoPage from './pages/ToDoPage'
import TeamChatPage from './pages/TeamChatPage'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './hooks/useTheme'
import ChatWidget from './components/chat/ChatWidget'

function AppRoutes() {
  const { session, loading, profile, refreshProfile, isExternal } = useAuth()

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

  return (
    <Profiler id="AppRoutes" onRender={logRender}>
      <Profiler id="Layout" onRender={logRender}>
        <Layout>
          <ErrorBoundary>
            <AnimatePresence mode="wait">
              <Routes>
                <Route path="/"         element={<Navigate to={rootTarget} replace />} />
                <Route path="/my-tasks" element={<InternalOnly><Profiler id="MyTasksPage" onRender={logRender}><MyTasksPage /></Profiler></InternalOnly>} />
                <Route path="/assign"   element={<InternalOnly><AssignTaskPage /></InternalOnly>} />
                <Route path="/to-do"    element={<ToDoPage />} />
                <Route path="/team-chat" element={<TeamChatPage />} />
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
          </ErrorBoundary>
        </Layout>
      </Profiler>
      {!isExternal && (
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
      <BrowserRouter>
        <AuthProvider>
          <PresenceProvider>
            <AppRoutes />
          </PresenceProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
