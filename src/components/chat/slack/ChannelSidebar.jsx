import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useChatPrefs } from '../../../hooks/useChatPrefs'
import { buildSidebarSections, normalizeDm } from '../../../lib/slackSidebar'
import { readHiddenDms, hideDm, unhideDm } from '../../../lib/hiddenDms'
import { readStarred, starConversation, unstarConversation } from '../../../lib/starredConversations'
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

// Resizable-width bounds (desktop only). Default matches the original 260px.
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_DEFAULT_WIDTH = 260
const SIDEBAR_WIDTH_KEY = 'pe-slack-sidebar-width'

function clampWidth(w) {
  if (!Number.isFinite(w)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)))
}

function readSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (raw === null) return SIDEBAR_DEFAULT_WIDTH
    const n = parseInt(raw, 10)
    return clampWidth(n)
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

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
  onCloseActive,
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
  // filtered out of the list UNLESS it has unread (a new message arrived) — in
  // which case it reappears AND is un-hidden so it stays visible going forward.
  //
  // Being merely "currently selected" no longer keeps a DM visible: that's what
  // let clicking × on the OPEN DM do nothing (it stayed selected → counted as
  // reappeared → got un-hidden immediately). Closing the open DM now also
  // deselects it (onCloseActive → navigate('/chat')) so the active highlight
  // moves away and the row filters out. An explicit user reopen (clicking a
  // still-visible hidden-but-unread row) un-hides it in selectDm.
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
    // If we just closed the conversation that's currently open, deselect it so
    // it's no longer the active row — otherwise the active highlight would point
    // at a row that's about to vanish, and (historically) it counted as
    // "reopened". Navigating to bare /chat clears selectedId.
    if (convId === selectedId) onCloseActive?.()
  }, [profileId, selectedId, onCloseActive])

  const visibleDms = useMemo(() => {
    return directMessages.filter((dm) => {
      const convId = dm.conversationId
      if (!convId) return true // conversation-less search candidates are never hidden
      if (!hiddenSet.has(convId)) return true
      // Hidden DMs reappear ONLY on genuine unread (a new message arrived).
      return (dm.conversation?.unread || 0) > 0
    })
  }, [directMessages, hiddenSet])

  // Un-hide any DM that has reappeared via unread so it stays visible going
  // forward — keeps the localStorage set in sync with what's shown.
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

  // Starred / favorite conversations (localStorage, per profile, no DB). Mirrors
  // the hiddenSet/hiddenVersion pattern. Any conversation (channel, DM, or task)
  // whose id is in starredSet is lifted into a dedicated "Starred" section at the
  // top of the sidebar and removed from its normal section (Slack behavior).
  const [starredVersion, setStarredVersion] = useState(0)
  const starredSet = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => new Set(readStarred(profileId)),
    [profileId, starredVersion],
  )

  const onToggleStar = useCallback((convId) => {
    if (!convId || !profileId) return
    if (readStarred(profileId).includes(convId)) {
      unstarConversation(profileId, convId)
    } else {
      starConversation(profileId, convId)
    }
    setStarredVersion(v => v + 1)
  }, [profileId])

  // Open a channel/group/campfire/task row — always by conversation id.
  const selectById = useCallback((convId) => {
    if (convId) onSelectConversation?.(convId)
  }, [onSelectConversation])

  // Open a DM row. If a conversation already exists, select it directly.
  // Otherwise resolve (or create) the DM via createOrOpen(profileId) then
  // select the returned id — mirrors ChatPage.openContact / ContactRow.onClick.
  const selectDm = useCallback(async (dm) => {
    if (dm.conversationId) {
      // Explicit reopen: un-hide so it stays visible going forward (this is the
      // only "reopen" signal now — being selected alone no longer un-hides).
      if (profileId && hiddenSet.has(dm.conversationId)) {
        unhideDm(profileId, dm.conversationId)
        setHiddenVersion(v => v + 1)
      }
      onSelectConversation?.(dm.conversationId)
      return
    }
    const convId = await createOrOpen?.(dm.profileId)
    if (convId) onSelectConversation?.(convId)
  }, [createOrOpen, onSelectConversation, profileId, hiddenSet])

  // Row renderers shared between the normal sections and the Starred section, so
  // a starred channel/DM/task renders identically wherever it appears. Each
  // wires the star toggle (DM rows also keep the hide ×).
  const searching = (query || '').trim().length > 0

  const renderChannelRow = useCallback((c) => (
    <SidebarRow
      key={c.id}
      kind="channel"
      label={groupDisplayName(c)}
      unread={(c.unread || 0) > 0}
      unreadCount={c.unread || 0}
      active={c.id === selectedId}
      onClick={() => selectById(c.id)}
      starred={starredSet.has(c.id)}
      onToggleStar={() => onToggleStar(c.id)}
    />
  ), [selectedId, selectById, starredSet, onToggleStar])

  const renderDmRow = useCallback((dm) => (
    <SidebarRow
      key={dm.conversationId || dm.profileId}
      kind="dm"
      label={dm.name || 'Unknown'}
      profile={dm.profile}
      online={!!presence.get(dm.profileId)?.online}
      status={presence.get(dm.profileId)?.status}
      unread={(dm.conversation?.unread || 0) > 0}
      unreadCount={dm.conversation?.unread || 0}
      active={!!dm.conversationId && dm.conversationId === selectedId}
      onClick={() => selectDm(dm)}
      onHide={dm.conversationId ? () => onHideDm(dm.conversationId) : undefined}
      starred={!!dm.conversationId && starredSet.has(dm.conversationId)}
      onToggleStar={dm.conversationId ? () => onToggleStar(dm.conversationId) : undefined}
    />
  ), [presence, selectedId, selectDm, onHideDm, starredSet, onToggleStar])

  const renderTaskRow = useCallback((t) => (
    <SidebarRow
      key={t.id}
      kind="task"
      label={t.title || 'Task'}
      unread={(t.unread || 0) > 0}
      unreadCount={t.unread || 0}
      active={t.id === selectedId}
      onClick={() => selectById(t.id)}
      starred={starredSet.has(t.id)}
      onToggleStar={() => onToggleStar(t.id)}
    />
  ), [selectedId, selectById, starredSet, onToggleStar])

  // Split each list into starred vs. unstarred. Starred items are lifted into the
  // Starred section and removed from their normal section (Slack). When searching
  // we skip the Starred section entirely and show the normal filtered results, so
  // search stays predictable. (DMs use the hidden-filtered `visibleDms`.)
  const starredChannels = useMemo(
    () => channels.filter(c => starredSet.has(c.id)),
    [channels, starredSet],
  )
  const unstarredChannels = useMemo(
    () => channels.filter(c => !starredSet.has(c.id)),
    [channels, starredSet],
  )
  // Starred DMs are sourced from the FULL `conversations` prop, not the capped
  // `visibleDms` (which only carries the recent top-N bucket). A starred DM that
  // lives outside the recent bucket would otherwise never appear in the Starred
  // section at all (bug 5). We re-normalize each conversation row into the
  // sidebar's DM shape and preserve the hidden-filter parity used elsewhere:
  // mirror visibleDms exactly — a hidden DM still REAPPEARS when it has unread,
  // so a hidden+starred DM with unread isn't silently dropped.
  const starredDms = useMemo(
    () => (conversations || [])
      .filter(c => c.kind === 'dm' && starredSet.has(c.id)
        && (!hiddenSet.has(c.id) || (c.unread || 0) > 0))
      .map(c => normalizeDm({ profile: c.other_profile, conversation: c })),
    [conversations, starredSet, hiddenSet],
  )
  const unstarredDms = useMemo(
    () => visibleDms.filter(dm => !(dm.conversationId && starredSet.has(dm.conversationId))),
    [visibleDms, starredSet],
  )
  const starredTasks = useMemo(
    () => taskChats.filter(t => starredSet.has(t.id)),
    [taskChats, starredSet],
  )
  const unstarredTasks = useMemo(
    () => taskChats.filter(t => !starredSet.has(t.id)),
    [taskChats, starredSet],
  )
  // View-aware so the DMs-only rail doesn't render an empty "Starred" header
  // when the only starred items are channels/tasks (bug 9): in the 'dms' view
  // only starred DMs count toward showing the section.
  const hasStarred = !searching && (dmsOnly
    ? starredDms.length > 0
    : (starredChannels.length > 0 || starredDms.length > 0 || starredTasks.length > 0))

  // Resizable width (desktop only). The inline width is applied via md:[width]
  // so mobile keeps its full-width single-pane layout (ChatPage wraps the aside
  // in `w-full md:w-auto`). Width persists per browser in localStorage and is
  // dragged via a thin grab handle on the sidebar's right edge.
  const asideRef = useRef(null)
  const [width, setWidth] = useState(() => readSidebarWidth())
  const [dragging, setDragging] = useState(false)

  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startW = asideRef.current?.getBoundingClientRect().width ?? width

    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const onMove = (ev) => {
      const next = clampWidth(startW + (ev.clientX - startX))
      setWidth(next)
    }
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
      setDragging(false)
      const final = clampWidth(startW + (ev.clientX - startX))
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(final)) } catch { /* noop */ }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width])

  return (
    <aside
      ref={asideRef}
      style={{ '--pe-sidebar-w': `${width}px` }}
      className="w-full md:w-[var(--pe-sidebar-w)] relative shrink-0 h-full flex flex-col bg-[var(--chat-sidebar,#1a1d24)] slack-chat">
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
            {/* Starred / favorites — only rendered when something is starred and
                not searching. Channels, DMs, and task chats are all eligible and
                render with their normal row (icon, presence, hide ×). */}
            {hasStarred && (
              <SidebarSection title="Starred">
                {dmsOnly
                  ? starredDms.map(renderDmRow)
                  : [
                      ...starredChannels.map(renderChannelRow),
                      ...starredDms.map(renderDmRow),
                      ...starredTasks.map(renderTaskRow),
                    ]}
              </SidebarSection>
            )}

            {!dmsOnly && (
              <SidebarSection
                title="Channels"
                onAdd={onCreateChannel}
                onFilter={focusSearch}
              >
                {(hasStarred ? unstarredChannels : channels).length === 0 ? (
                  <p className="px-4 py-1 text-[13px] text-white/30">No channels</p>
                ) : (
                  (hasStarred ? unstarredChannels : channels).map(renderChannelRow)
                )}
              </SidebarSection>
            )}

            <SidebarSection title="Direct messages" onAdd={focusSearch}>
              {(hasStarred ? unstarredDms : visibleDms).length === 0 ? (
                <p className="px-4 py-1 text-[13px] text-white/30">No direct messages</p>
              ) : (
                (hasStarred ? unstarredDms : visibleDms).map(renderDmRow)
              )}
            </SidebarSection>

            {!dmsOnly && (hasStarred ? unstarredTasks : taskChats).length > 0 && (
              <SidebarSection title="Task chats">
                {(hasStarred ? unstarredTasks : taskChats).map(renderTaskRow)}
              </SidebarSection>
            )}
          </>
        )}
      </div>

      {/* Resize handle (desktop only). Thin grab strip on the right edge; drag
          to widen/narrow between 180–480px. Mobile (single-pane, full-width)
          hides it via `hidden md:block`. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={onResizeStart}
        className="hidden md:block absolute top-0 right-0 h-full w-1.5 translate-x-1/2 cursor-col-resize group/resize z-10"
      >
        <div
          className={`mx-auto h-full w-px transition-colors ${
            dragging ? 'bg-[var(--chat-accent,#4f46e5)]' : 'bg-transparent group-hover/resize:bg-white/20'
          }`}
        />
      </div>
    </aside>
  )
}
