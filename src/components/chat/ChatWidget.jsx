import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useContactList } from '../../hooks/useContactList'
import { totalUnread as sumUnread } from '../../lib/dmUnread'
import { readWidgetState, writeWidgetState } from '../../lib/dmWidgetStorage'
import ChatLauncher from './ChatLauncher'
import ChatPanel from './ChatPanel'
import ContactSearch from './ContactSearch'
import ContactList from './ContactList'

export default function ChatWidget() {
  const { profile } = useAuth()
  const [state, setState] = useState(() => readWidgetState(profile?.id))
  const [query, setQuery] = useState('')

  useEffect(() => { setState(readWidgetState(profile?.id)) }, [profile?.id])
  useEffect(() => { writeWidgetState(profile?.id, state) }, [profile?.id, state])

  const { sections, conversations, presence, createOrOpen } = useContactList(query)
  const total = sumUnread(conversations)

  const handleOpen = useCallback(async (otherUserId) => {
    const convId = await createOrOpen(otherUserId)
    if (!convId) return
    setState(s => {
      if (s.openConversationIds.includes(convId)) return s
      return { ...s, openConversationIds: [...s.openConversationIds, convId] }
    })
  }, [createOrOpen])

  if (!profile?.id) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-end gap-3">
      {state.expanded && (
        <ChatPanel onClose={() => setState(s => ({ ...s, expanded: false }))}>
          <div className="p-3">
            <ContactSearch value={query} onChange={setQuery} />
          </div>
          <ContactList
            sections={sections}
            presence={presence}
            onOpen={handleOpen}
          />
        </ChatPanel>
      )}
      <ChatLauncher
        totalUnread={total}
        onClick={() => setState(s => ({ ...s, expanded: !s.expanded }))}
      />
    </div>
  )
}
