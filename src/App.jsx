import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
import MyTasksPage from './pages/MyTasksPage'
import AssignTaskPage from './pages/AssignTaskPage'
import TeamViewPage from './pages/TeamViewPage'
import AdminOverviewPage from './pages/AdminOverviewPage'
import ReportsPage from './pages/reports/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import ErrorBoundary from './components/ErrorBoundary'

function AppRoutes() {
  const { session, loading, profile, refreshProfile } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-500 text-sm">Loading...</p>
      </div>
    </div>
  )

  if (!session) return <LoginPage />

  if (!profile || (!profile.team_id && profile.role !== 'Admin')) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-elevated max-w-md w-full text-center p-6 sm:p-8">
        <div className="text-4xl mb-4">👋</div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Welcome to Project Engine</h2>
        <p className="text-slate-500">
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

  return (
    <Layout>
      <ErrorBoundary>
        <AnimatePresence mode="wait">
          <Routes>
            <Route path="/"        element={<Navigate to="/my-tasks" replace />} />
            <Route path="/my-tasks" element={<MyTasksPage />} />
            <Route path="/assign"   element={<AssignTaskPage />} />
            <Route path="/team"     element={<TeamViewPage />} />
            <Route path="/admin"    element={<AdminOverviewPage />} />
            <Route path="/reports"  element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*"         element={<Navigate to="/my-tasks" replace />} />
          </Routes>
        </AnimatePresence>
      </ErrorBoundary>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
