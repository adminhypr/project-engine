import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MessageCircle, ArrowLeft } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useContactList } from '../hooks/useContactList'
import SlackMessagePane from '../components/chat/slack/SlackMessagePane'
import CreateGroupModal from '../components/chat/CreateGroupModal'
import PreferencesModal from '../components/chat/slack/PreferencesModal'
import WorkspaceRail from '../components/chat/slack/WorkspaceRail'
import ChannelSidebar from '../components/chat/slack/ChannelSidebar'
import QuickSwitcher from '../components/chat/slack/QuickSwitcher'
import { usePageTitle } from '../hooks/usePageTitle'
import { readLastOpened, writeLastOpened, resolveActiveConversation } from '../lib/chatPage'
import { matchShortcut } from '../lib/chatShortcuts'
import { useChatPrefs } from '../hooks/useChatPrefs'
import { sidebarThemeVars } from '../lib/chatPrefs'

// Dedicated full-viewport Slack-style chat takeover (/chat and
// /chat/:conversationId). Composes the dark WorkspaceRail (68px) + dark
// ChannelSidebar (260px) + the existing ConversationPane for the message area
// (restyled in Phase 2). Renders OUTSIDE the normal app Layout chrome (see
// App.jsx) so it owns the full viewport. Two-pane on desktop, single-pane on
// mobile (URL decides which shows). Reuses the same hooks/components as the
// floating widget so they stay in sync. Zero DB changes — see
// docs/plans/2026-06-19-slack-chat-redesign.md (Task 1.6).
export default function ChatPage() {
  usePageTitle('Chat')
  const { profile, isExternal } = useAuth()
  const navigate = useNavigate()
  const { conversationId } = useParams()

  // Chat preferences (per profile, localStorage). The sidebar-theme preset is
  // applied as CSS vars on the .slack-chat root so the sidebar/rail/accent
  // chrome (which reads var(--chat-*) with the static slack/brand tokens as
  // fallbacks) recolors live. The default preset's hexes equal the current
  // tokens, so the default look is unchanged.
  const [chatPrefs] = useChatPrefs(profile?.id)

  // SINGLE useContactList instance for the whole /chat takeover. The search
  // query lives here (lifted from ChannelSidebar) and is fed to the hook so its
  // existing internal filtering semantics are preserved exactly. ChannelSidebar
  // is now presentation-only and receives this data + callbacks as props — so
  // useContactList (and its useConversations subscription / Supabase channel)
  // runs exactly once on /chat, instead of being double-subscribed.
  const [query, setQuery] = useState('')
  const {
    sections, groups, campfires, tasks, conversations, presence,
    createOrOpen, createGroup, markRead, refetch, loading,
  } = useContactList(query)

  const activeConv = useMemo(
    () => resolveActiveConversation(conversations, conversationId),
    [conversations, conversationId],
  )

  // Pre-read cursor snapshot for the "New messages" amber line.
  //
  // Selecting a conversation calls markRead(convId), which optimistically bumps
  // its last_read_at to ~now. If SlackMessageList snapshotted that live value it
  // would always be "now" and firstUnreadId() would return null — the line would
  // never show. So we capture each conversation's last_read_at AS IT WAS when it
  // first became active, BEFORE markRead bumps it, and feed that stable value to
  // the pane instead of the live activeConv.last_read_at.
  //
  // Captured synchronously during render (the first time we see a conv id) so it
  // beats both openConversation's markRead AND the pane's mount markRead effect.
  // The entry persists for the lifetime the conversation stays open, then is
  // cleared on conversation change so re-opening re-captures a fresh cursor.
  const preReadCursorRef = useRef(new Map())
  const prevConvIdRef = useRef(conversationId)
  if (prevConvIdRef.current !== conversationId) {
    // Navigated away from the previous conversation — drop its snapshot so a
    // later return re-captures the (now-advanced) cursor.
    if (prevConvIdRef.current) preReadCursorRef.current.delete(prevConvIdRef.current)
    prevConvIdRef.current = conversationId
  }
  if (activeConv && !preReadCursorRef.current.has(activeConv.id)) {
    preReadCursorRef.current.set(activeConv.id, activeConv.last_read_at ?? null)
  }
  const preReadLastReadAt = activeConv
    ? preReadCursorRef.current.get(activeConv.id) ?? null
    : null

  // Open a conversation by id → reflect in the URL + clear its unread. The
  // pre-read cursor for convId is captured during render (above) before this
  // markRead bumps last_read_at, so the amber line stays anchored.
  const openConversation = useCallback((convId) => {
    if (!convId) return
    navigate(`/chat/${convId}`)
    markRead?.(convId)
  }, [navigate, markRead])

  // ChannelSidebar already resolves DM rows (createOrOpen) to a conversation id
  // before calling this — so onSelectConversation always receives a real id.
  const onSelectConversation = useCallback((convId) => {
    openConversation(convId)
  }, [openConversation])

  const onBackToApp = useCallback(() => navigate('/my-tasks'), [navigate])

  // Workspace rail view: 'home' (full sidebar) or 'dms' (Direct messages only).
  const [railActive, setRailActive] = useState('home')

  // Bumped to ask ChannelSidebar to focus its search input (the "+" → New
  // message flow). A counter (not a boolean) so repeated New-message clicks each
  // re-trigger the focus effect.
  const [composeFocusSignal, setComposeFocusSignal] = useState(0)
  const onNewMessage = useCallback(() => {
    setRailActive('dms')
    setComposeFocusSignal(s => s + 1)
  }, [])

  // Create-group modal (restored from the pre-redesign ChatPage). Externals
  // can't create groups, so the affordance is gated for them.
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const openCreateGroup = useCallback(() => {
    if (isExternal) return
    setCreateGroupOpen(true)
  }, [isExternal])

  // Chat preferences modal (opened from the WorkspaceHeader "Preferences" item
  // via ChannelSidebar → onPreferences).
  const [prefsOpen, setPrefsOpen] = useState(false)

  // Rail nav selection is only 'home' | 'dms' now (the "+" create button owns
  // its own popover and calls onNewMessage / onNewChannel directly).
  const onRailSelect = useCallback((id) => {
    setRailActive(id)
  }, [])

  // Persist the last-open conversation so a bare /chat reopens it next time.
  useEffect(() => {
    if (activeConv && profile?.id) writeLastOpened(profile.id, activeConv.id)
  }, [activeConv, profile?.id])

  // Auto-restore last conversation on a bare /chat (desktop only — on mobile
  // the list is the natural landing). Runs once per mount; if the user later
  // lands on /chat deliberately it won't yank them away.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    if (conversationId) { restoredRef.current = true; return }
    if (loading || !profile?.id || conversations.length === 0) return
    restoredRef.current = true
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
    if (!isDesktop) return
    const last = readLastOpened(profile.id)
    if (last && conversations.some(c => c.id === last)) {
      navigate(`/chat/${last}`, { replace: true })
    }
  }, [conversationId, loading, conversations, profile?.id, navigate])

  // Fresh conversation (just created server-side) not in the list yet →
  // refetch ONCE. The Set guard prevents an infinite loop if RLS legitimately
  // hides the id. Mirrors TeamChatPage.
  const triedRef = useRef(new Set())
  useEffect(() => {
    if (!conversationId || activeConv || loading) return
    if (triedRef.current.has(conversationId)) return
    triedRef.current.add(conversationId)
    refetch?.()
  }, [conversationId, activeConv, loading, refetch])

  // Cmd/Ctrl+K quick switcher (key binding wired in Task 4.3).
  const [switcherOpen, setSwitcherOpen] = useState(false)

  // Thread panel — scoped to this page, reset when the conversation changes.
  const [threadRoot, setThreadRoot] = useState(null)
  useEffect(() => { setThreadRoot(null) }, [conversationId])
  const openThread = useCallback((msg) => { if (msg) setThreadRoot(msg) }, [])
  const closeThread = useCallback(() => setThreadRoot(null), [])

  // Global keyboard shortcuts for the chat takeover (design Task 4.3).
  // matchShortcut() maps Cmd/Ctrl+K → 'quickSwitcher' and Escape → 'closePanel'.
  //
  // Cmd+K must work everywhere (including from inside the composer) and must
  // preempt the browser default, so we always preventDefault + open the switcher.
  //
  // Escape is intentionally NOT hijacked while the user is typing in an
  // input/textarea/contenteditable — Escape there should keep its native
  // behaviour (blur/clear). The QuickSwitcher owns its own Escape via
  // ModalWrapper's useEscapeToClose, so when it's open we let that handle the
  // close and don't double-act here. Otherwise Escape closes an open thread.
  useEffect(() => {
    const onKeyDown = (e) => {
      const action = matchShortcut(e)
      if (action === 'quickSwitcher') {
        e.preventDefault()
        setSwitcherOpen(true)
        return
      }
      if (action === 'closePanel') {
        // Let the switcher's own Escape handler deal with closing it.
        if (switcherOpen) return
        const el = e.target
        const typing = el && (
          el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable
        )
        if (typing) return
        if (threadRoot) {
          e.preventDefault()
          closeThread()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [switcherOpen, threadRoot, closeThread])

  const isGroup = activeConv && (activeConv.kind === 'group' || activeConv.kind === 'hub')
  const online = activeConv && !isGroup ? !!presence?.get(activeConv.other_user_id)?.online : false

  // Presence dot on the rail avatar reflects the current user's own presence.
  const selfOnline = profile?.id ? !!presence?.get(profile.id)?.online : false

  // Mobile single-pane: when a conversation is open, show the message area and
  // hide the rail + sidebar; otherwise show rail + sidebar. Desktop shows all
  // three. The rail mirrors the sidebar so they appear/disappear together.
  const railVisibility = conversationId ? 'hidden md:flex' : 'flex'
  const sidebarVisibility = conversationId ? 'hidden md:flex' : 'flex'
  const mainVisibility = conversationId ? 'flex' : 'hidden md:flex'

  return (
    <div
      className="slack-chat h-screen w-screen flex overflow-hidden bg-[var(--chat-sidebar,#1a1d24)]"
      style={sidebarThemeVars(chatPrefs.sidebarTheme)}
    >
      <div className={`${railVisibility} shrink-0`}>
        <WorkspaceRail
          active={railActive}
          onSelect={onRailSelect}
          profile={profile}
          presenceOnline={selfOnline}
          onBackToApp={onBackToApp}
          onNewMessage={onNewMessage}
          onNewChannel={isExternal ? undefined : openCreateGroup}
        />
      </div>

      <div className={`${sidebarVisibility} w-full md:w-auto shrink-0`}>
        <ChannelSidebar
          query={query}
          onQueryChange={setQuery}
          sections={sections}
          groups={groups}
          campfires={campfires}
          tasks={tasks}
          presence={presence}
          conversations={conversations}
          loading={loading}
          createOrOpen={createOrOpen}
          selectedId={conversationId}
          onSelectConversation={onSelectConversation}
          onCompose={isExternal ? undefined : openCreateGroup}
          onCreateChannel={isExternal ? undefined : openCreateGroup}
          onBackToApp={onBackToApp}
          onPreferences={() => setPrefsOpen(true)}
          view={railActive}
          composeFocusSignal={composeFocusSignal}
        />
      </div>

      {/* Message area: open conversation, or empty/not-found state */}
      <div className={`${mainVisibility} flex-1 min-w-0 flex-col bg-white dark:bg-dark-bg h-full`}>
        {activeConv ? (
          <>
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="md:hidden flex items-center gap-1.5 px-3 py-2 text-sm text-brand-600 dark:text-brand-400 border-b border-slate-200 dark:border-dark-border"
            >
              <ArrowLeft className="w-4 h-4" /> All conversations
            </button>
            <div className="flex-1 min-h-0 flex">
              <SlackMessagePane
                conversation={activeConv}
                online={online}
                onMarkRead={markRead}
                onGroupChanged={refetch}
                lastReadAt={preReadLastReadAt}
                threadRoot={threadRoot}
                onOpenThread={openThread}
                onCloseThread={closeThread}
              />
            </div>
          </>
        ) : conversationId && !loading ? (
          <EmptyMain
            title="This conversation isn't available"
            subtitle="It may have been deleted, or you no longer have access."
            cta={{ label: 'Back to conversations', onClick: () => navigate('/chat') }}
          />
        ) : (
          <EmptyMain
            title="Select a conversation"
            subtitle="Pick a person, group, or campfire on the left to start chatting."
          />
        )}
      </div>

      <QuickSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        sections={sections}
        groups={groups}
        campfires={campfires}
        tasks={tasks}
        presence={presence}
        createOrOpen={createOrOpen}
        onSelectConversation={onSelectConversation}
      />

      <CreateGroupModal
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        createGroup={createGroup}
        onCreated={(convId) => {
          setCreateGroupOpen(false)
          openConversation(convId)
        }}
      />

      <PreferencesModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        profileId={profile?.id}
      />
    </div>
  )
}

function EmptyMain({ title, subtitle, cta }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center text-slate-400 dark:text-slate-500 max-w-xs">
        <MessageCircle size={40} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
        {subtitle && <p className="text-xs mt-1">{subtitle}</p>}
        {cta && (
          <button
            type="button"
            onClick={cta.onClick}
            className="mt-4 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
          >
            {cta.label}
          </button>
        )}
      </div>
    </div>
  )
}
