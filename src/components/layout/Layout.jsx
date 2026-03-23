import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../hooks/useAuth'
import { signOut } from '../../lib/auth'
import {
  CheckSquare, Plus, Users, LayoutDashboard,
  BarChart2, Settings, LogOut, Menu, X, ChevronRight, Moon, Sun
} from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import NotificationBell from '../notifications/NotificationBell'

export default function Layout({ children }) {
  const { profile, isAdmin, isManager } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { dark, toggle } = useTheme()

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  const navItems = [
    { to: '/my-tasks', icon: CheckSquare, label: 'My Tasks',       show: true },
    { to: '/assign',   icon: Plus,         label: 'Assign a Task',  show: true },
    { to: '/team',     icon: Users,        label: 'Team View',      show: isManager },
    { to: '/admin',    icon: LayoutDashboard, label: 'Admin Overview', show: isAdmin },
    { to: '/reports',  icon: BarChart2,    label: 'Reports',        show: isManager },
    { to: '/settings', icon: Settings,     label: 'Settings',       show: isAdmin },
  ]

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-100 dark:border-dark-border">
        <h1 className="text-slate-900 dark:text-white font-bold text-base tracking-tight">Hypr Task</h1>
        <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">Task Management</p>
      </div>

      {/* User info */}
      <div className="px-4 py-4 border-b border-slate-100 dark:border-dark-border">
        <div className="flex items-center gap-3">
          {profile?.avatar_url
            ? <img src={profile.avatar_url} className="w-9 h-9 rounded-full ring-2 ring-slate-100 dark:ring-dark-border" alt="" />
            : <div className="w-9 h-9 rounded-full bg-brand-500 flex items-center justify-center text-white text-sm font-bold">
                {profile?.full_name?.[0] || '?'}
              </div>
          }
          <div className="min-w-0 flex-1">
            <p className="text-slate-900 dark:text-white text-sm font-semibold truncate">{profile?.full_name}</p>
            <p className="text-slate-400 dark:text-slate-500 text-xs truncate">{profile?.teams?.name || 'No team'}</p>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            {profile?.role}
          </span>
          {profile?.manager?.full_name && (
            <span className="text-slate-400 dark:text-slate-500 text-xs truncate">
              → {profile.manager.full_name}
            </span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-3 overflow-y-auto space-y-0.5">
        {navItems.filter(n => n.show).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl transition-all duration-150
               ${isActive
                 ? 'bg-brand-50 text-brand-700 font-semibold dark:bg-brand-500/15 dark:text-brand-300'
                 : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-dark-hover dark:hover:text-white'
               }`
            }
          >
            <Icon size={18} strokeWidth={isManager ? 1.8 : 2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Dark mode toggle */}
      <div className="px-3 pt-2">
        <button
          onClick={toggle}
          className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-dark-hover rounded-xl transition-all duration-150"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
      </div>

      {/* Sign out */}
      <div className="p-3 border-t border-slate-100 dark:border-dark-border">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-dark-hover rounded-xl transition-all duration-150"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50 dark:bg-dark-bg">

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 min-w-[15rem] bg-white dark:bg-dark-surface border-r border-slate-200/60 dark:border-dark-border flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 z-40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              className="fixed top-0 left-0 h-full w-72 bg-white dark:bg-dark-surface border-r border-slate-200 dark:border-dark-border flex flex-col z-50 md:hidden"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto relative">
        {/* Mobile header bar */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-white dark:bg-dark-surface border-b border-slate-200/60 dark:border-dark-border md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-dark-hover transition-colors"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-sm font-bold text-slate-900 dark:text-white">Hypr Task</h1>
          <NotificationBell onTaskClick={() => { navigate('/my-tasks'); setSidebarOpen(false) }} />
        </div>

        {/* Desktop notification bell */}
        <div className="fixed top-4 right-5 z-30 hidden md:block">
          <NotificationBell onTaskClick={() => navigate('/my-tasks')} />
        </div>
        {children}
      </main>

    </div>
  )
}
