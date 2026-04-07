import { usePresence } from '../../hooks/usePresence'
import { useAuth } from '../../hooks/useAuth'
import AttendanceAvatar from './AttendanceAvatar'

export default function Attendance({ hubId }) {
  const { profile } = useAuth()
  const { onlineUsers } = usePresence(hubId, profile)

  if (onlineUsers.length === 0) {
    return (
      <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
        No one else online right now.
      </p>
    )
  }

  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5 animate-pulse" />
        {onlineUsers.length} online now
      </p>
      <div className="flex flex-wrap gap-2">
        {onlineUsers.map(u => (
          <AttendanceAvatar key={u.user_id} user={u} />
        ))}
      </div>
    </div>
  )
}
