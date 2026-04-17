import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useContactList } from '../../hooks/useContactList'
import { totalUnread as sumUnread } from '../../lib/dmUnread'
import { readWidgetState, writeWidgetState } from '../../lib/dmWidgetStorage'
import ChatLauncher from './ChatLauncher'
import ChatPanel from './ChatPanel'

export default function ChatWidget() {
  const { profile } = useAuth()
  const [state, setState] = useState(() => readWidgetState(profile?.id))

  useEffect(() => { setState(readWidgetState(profile?.id)) }, [profile?.id])
  useEffect(() => { writeWidgetState(profile?.id, state) }, [profile?.id, state])

  const { conversations } = useContactList('')
  const total = sumUnread(conversations)

  if (!profile?.id) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-end gap-3">
      {state.expanded && (
        <ChatPanel onClose={() => setState(s => ({ ...s, expanded: false }))}>
          <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
            Contact list will go here (Task 13).
          </div>
        </ChatPanel>
      )}
      <ChatLauncher
        totalUnread={total}
        onClick={() => setState(s => ({ ...s, expanded: !s.expanded }))}
      />
    </div>
  )
}
