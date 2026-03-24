import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, CheckCircle, AlertTriangle, Clock, UserPlus, UserCog, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTasks } from '../../hooks/useTasks'
import { useAuth } from '../../hooks/useAuth'
import { formatDate } from '../../lib/helpers'

function getNotifications(myTasks, profile, unsetupUsers) {
  const notifications = []
  const now = new Date()

  // Admin: users needing setup (no teams assigned)
  if (profile?.role === 'Admin' && unsetupUsers.length > 0) {
    notifications.push({
      id: 'users-need-setup',
      type: 'admin',
      icon: <UserCog size={14} />,
      color: 'text-amber-600 bg-amber-500/15',
      title: `${unsetupUsers.length} user${unsetupUsers.length > 1 ? 's' : ''} need${unsetupUsers.length === 1 ? 's' : ''} setup`,
      body: unsetupUsers.map(u => u.full_name || u.email).join(', '),
      link: '/settings',
      time: unsetupUsers[0]?.created_at,
      priority: 0,
    })
  }

  // Pending acceptance tasks
  const pending = myTasks.filter(t => t.acceptance_status === 'Pending')
  pending.forEach(t => {
    notifications.push({
      id: `pending-${t.id}`,
      type: 'pending',
      icon: <UserPlus size={14} />,
      color: 'text-yellow-600 bg-yellow-500/15',
      title: 'Task awaiting acceptance',
      body: t.title,
      taskId: t.id,
      time: t.date_assigned,
      priority: 1,
    })
  })

  // Overdue / RED tasks
  const overdue = myTasks.filter(t => t.priority === 'red' && t.status !== 'Done' && t.acceptance_status !== 'Declined')
  overdue.forEach(t => {
    notifications.push({
      id: `overdue-${t.id}`,
      type: 'overdue',
      icon: <AlertTriangle size={14} />,
      color: 'text-red-600 bg-red-500/15',
      title: 'Overdue task',
      body: t.title,
      taskId: t.id,
      time: t.due_date || t.last_updated,
      priority: 2,
    })
  })

  // Due soon (orange) tasks — within 12 hours
  const urgent = myTasks.filter(t => t.priority === 'orange' && t.status !== 'Done' && t.acceptance_status !== 'Declined')
  urgent.forEach(t => {
    notifications.push({
      id: `urgent-${t.id}`,
      type: 'urgent',
      icon: <Clock size={14} />,
      color: 'text-orange-600 bg-orange-500/15',
      title: 'Due soon',
      body: t.title,
      taskId: t.id,
      time: t.due_date || t.last_updated,
      priority: 3,
    })
  })

  // Recently assigned (last 24h)
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
  const recent = myTasks.filter(t =>
    new Date(t.date_assigned) > dayAgo &&
    t.acceptance_status === 'Accepted' &&
    t.status === 'Not Started'
  )
  recent.forEach(t => {
    notifications.push({
      id: `new-${t.id}`,
      type: 'new',
      icon: <CheckCircle size={14} />,
      color: 'text-sky-600 bg-sky-500/15',
      title: 'New task assigned',
      body: t.title,
      taskId: t.id,
      time: t.date_assigned,
      priority: 4,
    })
  })

  // Sort by priority then by time
  return notifications.sort((a, b) => a.priority - b.priority || new Date(b.time) - new Date(a.time))
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function NotificationBell({ onTaskClick }) {
  const { myTasks } = useTasks()
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [unsetupUsers, setUnsetupUsers] = useState([])
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pe-dismissed-notifs') || '[]')
    } catch { return [] }
  })
  const panelRef = useRef(null)

  // Admin: fetch users with no team assignments
  useEffect(() => {
    if (!isAdmin) return
    async function fetchUnsetup() {
      // Get all profiles, then filter to those with no profile_teams rows
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, created_at, profile_teams!profile_teams_profile_id_fkey(team_id)')
        .order('created_at', { ascending: false })
      if (profiles) {
        const unsetup = profiles.filter(p => !p.profile_teams || p.profile_teams.length === 0)
        setUnsetupUsers(unsetup)
      }
    }
    fetchUnsetup()

    // Re-check when profiles table changes (new signup)
    const channel = supabase
      .channel('profiles-admin-notif')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchUnsetup())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_teams' }, () => fetchUnsetup())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [isAdmin])

  const allNotifications = getNotifications(myTasks, profile, unsetupUsers)
  const notifications = allNotifications.filter(n => !dismissed.includes(n.id))
  const count = notifications.length

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Persist dismissed
  useEffect(() => {
    localStorage.setItem('pe-dismissed-notifs', JSON.stringify(dismissed))
  }, [dismissed])

  function dismiss(id) {
    setDismissed(prev => [...prev, id])
  }

  function clearAll() {
    setDismissed(allNotifications.map(n => n.id))
    setIsOpen(false)
  }

  function handleNotifClick(n) {
    dismiss(n.id)
    if (n.link) {
      navigate(n.link)
    } else if (n.taskId) {
      onTaskClick?.(n.taskId)
    }
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2.5 rounded-xl bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border shadow-soft text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-dark-hover transition-all duration-200"
      >
        <Bell size={18} />
        {count > 0 && (
          <motion.span
            className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
          >
            {count > 9 ? '9+' : count}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-80 bg-white dark:bg-dark-card rounded-2xl shadow-elevated border border-slate-200 dark:border-dark-border z-50 overflow-hidden"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-100 dark:border-dark-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</h3>
              {count > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <Bell size={24} className="text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-400 dark:text-slate-500">All caught up!</p>
                </div>
              ) : (
                notifications.map((n, i) => (
                  <motion.div
                    key={n.id}
                    className="px-4 py-3 border-b border-slate-100 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors cursor-pointer flex gap-3"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => handleNotifClick(n)}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${n.color}`}>
                      {n.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{n.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{n.body}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{timeAgo(n.time)}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismiss(n.id) }}
                      className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors flex-shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
