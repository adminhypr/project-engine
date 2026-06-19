import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useChatPrefs } from '../../../hooks/useChatPrefs'
import { buildSidebarSections } from '../../../lib/slackSidebar'
import { readHiddenDms, hideDm, unhideDm } from '../../../lib/hiddenDms'
import { groupDisplayName } from '../../../lib/groupConversations'
import { Spinner } from '../../ui/index'
import WorkspaceHeader from './WorkspaceHeader'
import SidebarSection from './SidebarSection'
import SidebarRow from './SidebarRow'

// 260px dark channel sidebar for the Slack /chat takeover (design Task 1.5).
// PRESENTATION-ONLY: the single useContactList lives in ChatPage (so the hook —
// and its underlying useConversations subscription / Supabase channel — runs
// exactly once on /chat). This component receives the contact-list result as
// props and renders search + Channels / Direct messages / Task chats sections.
// Selecting a row calls onSelectConversation(conversationId). For DM rows that
// have no existing conversation yet, it resolves one via createOrOpen(profileId)
// first — exactly mirroring ChatPage's openContact → openConversation flow.
//
// Props (data lifted from ChatPage's single useContactList):
//   query                    — controlled search value (lives in ChatPage, fed to useContactList)
//   onQueryChange(value)     — search input change handler
//   sections, groups, campfires, tasks, presence, conversations, loading
//                            — the useContactList result (already query-filtered)
//   createOrOpen(profileId)  — resolve/create a DM conversation, returns its id
//   selectedId               — conversation id of the open conversation (active highlight)
//   onSelectConversation(id) — called with a conversation id to open
//   onCompose                — compose pencil (WorkspaceHeader)
//   onBackToApp              — "← App" / "Back to Project Engine"
//   onInvite, onPreferences  — optional WorkspaceHeader menu actions

export default function ChannelSidebar({
  query,
  onQueryChange,
  sections = { recent: [], teammates: [], company: [] },
  groups = [],
  campfires = [],
  tasks = [],
  presence = new Map(),
  conversations = [],
  loading = false,
  createOrOpen,
  selectedId,
  onSelectConversation,
  onCompose,
  onCreateChannel,
  onBackToApp,
  onInvite,
  onPreferences,
  view = 'home',
  composeFocusSignal = 0,
}) {
  const searchRef = useRef(null)

  // "DMs" rail view shows only the Direct messages section; "home" shows all.
  const dmsOnly = view === 'dms'

  // Focus the search input when the "+" → New message flow bumps the signal.
  // Skip the initial value so it never steals focus on first render / page load.
  const prevFocusSignalRef = useRef(composeFocusSignal)
  useEffect(() => {
    if (composeFocusSignal === prevFocusSignalRef.current) return
    prevFocusSignalRef.current = composeFocusSignal
    searchRef.current?.focus()
    searchRef.current?.select?.()
  }, [composeFocusSignal])

  // Focus the search input — the "search + compose" entry point for starting a
  // new DM (typing a name surfaces everyone via includeAllPeople) and for
  // filtering channels by name.
  const focusSearch = useCallback(() => {
    searchRef.current?.focus()
    searchRef.current?.select?.()
  }, [])
  const { profile } = useAuth()
  const profileId = profile?.id || null
  const [chatPrefs] = useChatPrefs(profileId)

  // When the user is searching, surface ALL people (teammates + company) so they
  // can start a brand-new DM. With an empty query only real conversations show —
  // Slack's "search + compose" model — UNLESS the user set the DM list to
  // "Everyone" (dmListShowAll), in which case all people show even when empty.
  const includeAllPeople = (query || '').trim().length > 0 || chatPrefs.dmListShowAll === true
  const { channels, directMessages, taskChats } = useMemo(
    () => buildSidebarSections({ sections, groups, campfires, tasks }, { includeAllPeople }),
    [sections, groups, campfires, tasks, includeAllPeople],
  )

  // Hidden / closed DMs (localStorage, per profile, no DB). A hidden DM is
  // filtered out of the list UNLESS it has unread (a new message arrived) or
  // it's the currently-open conversation (it was reopened) — in which case it
  // reappears AND is un-hidden so it stays visible going forward.
  const [hiddenVersion, setHiddenVersion] = useState(0)
  const hiddenSet = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => new Set(readHiddenDms(profileId)),
    [profileId, hiddenVersion],
  )

  const onHideDm = useCallback((convId) => {
    if (!convId || !profileId) return
    hideDm(profileId, convId)
    setHiddenVersion(v => v + 1)
  }, [profileId])

  const visibleDms = useMemo(() => {
    return directMessages.filter((dm) => {
      const convId = dm.conversationId
      if (!convId) return true // conversation-less search candidates are never hidden
      if (!hiddenSet.has(convId)) return true
      const reappear = (dm.conversation?.unread || 0) > 0 || convId === selectedId
      return reappear
    })
  }, [directMessages, hiddenSet, selectedId])

  // Un-hide any DM that has reappeared (unread/reopened) so it stays visible
  // going forward — keeps the localStorage set in sync with what's shown.
  const reappearedKey = useMemo(
    () => visibleDms
      .filter(dm => dm.conversationId && hiddenSet.has(dm.conversationId))
      .map(dm => dm.conversationId)
      .join(','),
    [visibleDms, hiddenSet],
  )
  useEffect(() => {
    if (!reappearedKey || !profileId) return
    reappearedKey.split(',').forEach(convId => unhideDm(profileId, convId))
    setHiddenVersion(v => v + 1)
  }, [reappearedKey, profileId])

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
    <aside className="w-[260px] shrink-0 h-full flex flex-col bg-[var(--chat-sidebar,#1a1d24)] slack-chat">
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
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange?.(e.target.value)}
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
            {!dmsOnly && (
              <SidebarSection
                title="Channels"
                onAdd={onCreateChannel}
                onFilter={focusSearch}
              >
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
            )}

            <SidebarSection title="Direct messages" onAdd={focusSearch}>
              {visibleDms.length === 0 ? (
                <p className="px-3 py-1 text-[13px] text-white/30">No direct messages</p>
              ) : (
                visibleDms.map((dm) => (
                  <SidebarRow
                    key={dm.conversationId || dm.profileId}
                    kind="dm"
                    label={dm.name || 'Unknown'}
                    online={!!presence.get(dm.profileId)?.online}
                    unread={(dm.conversation?.unread || 0) > 0}
                    active={!!dm.conversationId && dm.conversationId === selectedId}
                    onClick={() => selectDm(dm)}
                    onHide={dm.conversationId ? () => onHideDm(dm.conversationId) : undefined}
                  />
                ))
              )}
            </SidebarSection>

            {!dmsOnly && taskChats.length > 0 && (
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
