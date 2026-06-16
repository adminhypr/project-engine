import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MessageCircle, ArrowLeft } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useContactList } from '../hooks/useContactList'
import ChatSidebar from '../components/chat/ChatSidebar'
import ConversationPane from '../components/chat/ConversationPane'
import CreateGroupModal from '../components/chat/CreateGroupModal'
import { Spinner } from '../components/ui/index'
import { usePageTitle } from '../hooks/usePageTitle'
import { readLastOpened, writeLastOpened, resolveActiveConversation } from '../lib/chatPage'

// Dedicated full-page chat (/chat and /chat/:conversationId). Two-pane on
// desktop (sidebar + conversation), single-pane on mobile (URL decides which
// shows). Reuses the same hooks/components as the floating widget, so they
// stay in sync. Zero DB changes — see
// docs/plans/2026-06-16-dedicated-chat-page-design.md.
export default function ChatPage() {
  usePageTitle('Chat')
  const { profile, isExternal } = useAuth()
  const navigate = useNavigate()
  const { conversationId } = useParams()
  const [query, setQuery] = useState('')
  const [createGroupOpen, setCreateGroupOpen] = useState(false)

  const {
    sections, groups, campfires, conversations, presence,
    createOrOpen, createGroup, markRead, refetch, loading,
  } = useContactList(query)

  const activeConv = useMemo(
    () => resolveActiveConversation(conversations, conversationId),
    [conversations, conversationId],
  )

  // Open a conversation by id → reflect in the URL + clear its unread.
  const openConversation = useCallback((convId) => {
    if (!convId) return
    navigate(`/chat/${convId}`)
    markRead?.(convId)
  }, [navigate, markRead])

  // Clicking a person resolves (or creates) the DM, then opens it.
  const openContact = useCallback(async (otherUserId) => {
    const convId = await createOrOpen?.(otherUserId)
    if (convId) openConversation(convId)
  }, [createOrOpen, openConversation])

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

  // Thread panel — scoped to this page, reset when the conversation changes.
  const [threadRoot, setThreadRoot] = useState(null)
  useEffect(() => { setThreadRoot(null) }, [conversationId])
  const openThread = useCallback((msg) => { if (msg) setThreadRoot(msg) }, [])
  const closeThread = useCallback(() => setThreadRoot(null), [])

  const isGroup = activeConv && (activeConv.kind === 'group' || activeConv.kind === 'hub')
  const online = activeConv && !isGroup ? !!presence.get(activeConv.other_user_id)?.online : false

  const sidebarVisibility = conversationId ? 'hidden md:block' : 'block'
  const mainVisibility = conversationId ? 'flex' : 'hidden md:flex'

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: conversation list */}
      <div className={`${sidebarVisibility} w-full md:w-[320px] shrink-0 md:border-r border-slate-200 dark:border-dark-border h-full`}>
        {loading && conversations.length === 0 ? (
          <div className="h-full flex items-center justify-center"><Spinner /></div>
        ) : (
          <ChatSidebar
            query={query}
            onQueryChange={setQuery}
            sections={sections}
            groups={groups}
            campfires={campfires}
            presence={presence}
            selectedId={conversationId}
            onOpenContact={openContact}
            onOpenConversation={openConversation}
            onCreateGroup={isExternal ? undefined : () => setCreateGroupOpen(true)}
          />
        )}
      </div>

      {/* Right: open conversation, or empty/not-found state */}
      <div className={`${mainVisibility} flex-1 min-w-0 flex-col bg-slate-50/40 dark:bg-dark-bg/30 h-full`}>
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
              <ConversationPane
                conversation={activeConv}
                online={online}
                onMarkRead={markRead}
                onGroupChanged={refetch}
                threadRoot={threadRoot}
                onOpenThread={openThread}
                onCloseThread={closeThread}
                fullPage
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

      <CreateGroupModal
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        createGroup={createGroup}
        onCreated={(convId) => {
          setCreateGroupOpen(false)
          openConversation(convId)
        }}
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
