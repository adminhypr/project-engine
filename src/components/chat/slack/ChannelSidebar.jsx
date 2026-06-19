import { useCallback, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useContactList } from '../../../hooks/useContactList'
import { buildSidebarSections } from '../../../lib/slackSidebar'
import { groupDisplayName } from '../../../lib/groupConversations'
import { Spinner } from '../../ui/index'
import WorkspaceHeader from './WorkspaceHeader'
import SidebarSection from './SidebarSection'
import SidebarRow from './SidebarRow'

// 260px dark channel sidebar for the Slack /chat takeover (design Task 1.5).
// Consumes useContactList + buildSidebarSections and renders search +
// Channels / Direct messages / Task chats sections. Selecting a row calls
// onSelectConversation(conversationId). For DM rows that have no existing
// conversation yet, it resolves one via createOrOpen(profileId) first — exactly
// mirroring ChatPage.jsx's openContact → openConversation flow.
//
// Props:
//   selectedId               — conversation id of the open conversation (active highlight)
//   onSelectConversation(id) — called with a conversation id to open
//   onCompose                — compose pencil (WorkspaceHeader)
//   onBackToApp              — "← App" / "Back to Project Engine"
//   onInvite, onPreferences  — optional WorkspaceHeader menu actions

export default function ChannelSidebar({
  selectedId,
  onSelectConversation,
  onCompose,
  onBackToApp,
  onInvite,
  onPreferences,
}) {
  const [query, setQuery] = useState('')
  const {
    sections, groups, campfires, tasks, presence, createOrOpen, loading, conversations,
  } = useContactList(query)

  const { channels, directMessages, taskChats } = useMemo(
    () => buildSidebarSections({ sections, groups, campfires, tasks }),
    [sections, groups, campfires, tasks],
  )

  // Open a channel/group/campfire/task row — always by conversation id.
  const selectById = useCallback((convId) => {
    if (convId) onSelectConversation?.(convId)
  }, [onSelectConversation])

  // Open a DM row. If a conversation already exists, select it directly.
  // Otherwise resolve (or create) the DM via createOrOpen(profileId) then
  // select the returned id — mirrors ChatPage.openContact / ContactRow.onClick.
  const selectDm = useCallback(async (dm) => {
    if (dm.conversationId) {
      onSelectConversation?.(dm.conversationId)
      return
    }
    const convId = await createOrOpen?.(dm.profileId)
    if (convId) onSelectConversation?.(convId)
  }, [createOrOpen, onSelectConversation])

  return (
    <aside className="w-[260px] shrink-0 h-full flex flex-col bg-slack-sidebar slack-chat">
      <WorkspaceHeader
        onCompose={onCompose}
        onBackToApp={onBackToApp}
        onInvite={onInvite}
        onPreferences={onPreferences}
      />

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations & people"
            className="w-full h-8 pl-8 pr-3 rounded-md bg-white/10 text-white text-[14px] placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {loading && (conversations?.length ?? 0) === 0 ? (
          <div className="h-full flex items-center justify-center"><Spinner /></div>
        ) : (
          <>
            <SidebarSection title="Channels">
              {channels.length === 0 ? (
                <p className="px-3 py-1 text-[13px] text-white/30">No channels</p>
              ) : (
                channels.map((c) => (
                  <SidebarRow
                    key={c.id}
                    kind="channel"
                    label={groupDisplayName(c)}
                    unread={(c.unread || 0) > 0}
                    active={c.id === selectedId}
                    onClick={() => selectById(c.id)}
                  />
                ))
              )}
            </SidebarSection>

            <SidebarSection title="Direct messages">
              {directMessages.length === 0 ? (
                <p className="px-3 py-1 text-[13px] text-white/30">No direct messages</p>
              ) : (
                directMessages.map((dm) => (
                  <SidebarRow
                    key={dm.conversationId || dm.profileId}
                    kind="dm"
                    label={dm.name || 'Unknown'}
                    online={!!presence.get(dm.profileId)?.online}
                    unread={(dm.conversation?.unread || 0) > 0}
                    active={!!dm.conversationId && dm.conversationId === selectedId}
                    onClick={() => selectDm(dm)}
                  />
                ))
              )}
            </SidebarSection>

            {taskChats.length > 0 && (
              <SidebarSection title="Task chats">
                {taskChats.map((t) => (
                  <SidebarRow
                    key={t.id}
                    kind="task"
                    label={t.title || 'Task'}
                    unread={(t.unread || 0) > 0}
                    active={t.id === selectedId}
                    onClick={() => selectById(t.id)}
                  />
                ))}
              </SidebarSection>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
