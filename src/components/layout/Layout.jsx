import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../hooks/useAuth'
import { signOut } from '../../lib/auth'
import {
  CheckSquare, Plus, Users, LayoutDashboard,
  BarChart2, Settings, LogOut, Menu, X
} from 'lucide-react'
import NotificationBell from '../notifications/NotificationBell'

export default function Layout({ children }) {
  const { profile, isAdmin, isManager } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
      <div className="px-4 py-5 border-b border-white/8">
        <h1 className="text-white font-bold text-base tracking-tight">Project Engine</h1>
        <p className="text-navy-400 text-xs mt-0.5">Task Management</p>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-white/8">
        <div className="flex items-center gap-2.5">
          {profile?.avatar_url
            ? <img src={profile.avatar_url} className="w-8 h-8 rounded-full ring-2 ring-white/10" alt="" />
            : <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold">
                {profile?.full_name?.[0] || '?'}
              </div>
          }
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{profile?.full_name}</p>
            <p className="text-navy-400 text-xs truncate">{profile?.teams?.name || 'No team'}</p>
          </div>
        </div>
        <span className="mt-2 inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-300">
          {profile?.role}
        </span>
        {profile?.manager?.full_name && (
          <p className="text-navy-500 text-xs mt-1.5 truncate">
            Reports to: <span className="text-navy-300">{profile.manager.full_name}</span>
          </p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {navItems.filter(n => n.show).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-200 w-full
               ${isActive
                 ? 'text-white'
                 : 'text-navy-400 hover:bg-white/5 hover:text-white'
               }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-orange-500/15 border-l-2 border-orange-500"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon size={16} className="relative z-10" />
                <span className="relative z-10">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Sign out */}
      <div className="p-3 border-t border-white/8">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-3 py-2 text-sm text-navy-400 hover:text-white hover:bg-white/5 rounded-xl transition-all duration-200"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-navy-50">

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 min-w-[14rem] bg-navy-900 flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-navy-950/40 backdrop-blur-sm z-40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              className="fixed top-0 left-0 h-full w-64 bg-navy-900 flex flex-col z-50 md:hidden"
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
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-white/70 backdrop-blur-xl border-b border-white/30 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-xl text-navy-600 hover:bg-navy-100/50 transition-colors"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-sm font-bold text-navy-900">Project Engine</h1>
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
