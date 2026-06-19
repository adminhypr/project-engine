import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X as XIcon, Minimize2, MessageCircle } from 'lucide-react'
import ContactSearch from './ContactSearch'
import ContactList from './ContactList'
import ConversationPane from './ConversationPane'

// "Focus mode" view of the chat widget. Mirrors the hub-box ExpandedModuleModal
// pattern: a centered floating window above the page with much more vertical
// real estate than the bottom-right widget affords.
//
// Layout: 280px left sidebar (search + ContactList sections) + ConversationPane
// rendered with fullPage on the right. Picking a contact, group, or task swaps
// the right pane in place. Esc or backdrop click closes back to the bottom-
// right widget; closing preserves whatever conversations were already in the
// bottom-right stack so the user's session is continuous.
export default function ExpandedChatModal({
  // Contact list inputs (same shape useContactList returns)
  sections,
  groups,
  campfires,
  tasks,
  conversations,
  presence,
  query,
  onQueryChange,
  // Conversation actions. Modal selections are SCOPED to the modal — they
  // don't touch the bottom-right widget's open stack. createOrOpenDm only
  // resolves a DM conversation id without registering it as "open"; group
  // and task selections likewise just set the modal's active pane.
  createOrOpenDm,
  onMarkRead,
  onAssignTask,
  onCreateGroup,
  // Modal lifecycle
  initialActiveConvId = null,
  onClose,
  // Thread state lifted at ChatWidget level — passed through so the
  // expanded modal participates in the single-thread invariant.
  threadState,
  onOpenThread,
  onCloseThread,
  // Sidebar-theme CSS vars (--chat-accent etc.) so the composer send button and
  // your-reaction pill in this modal match the active preset.
  themeVars,
}) {
  // Close on Esc.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Body scroll lock — same as ExpandedModuleModal.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Which conversation is showing in the right pane. Local to the modal so
  // closing it doesn't perturb the bottom-right stack's state.
  const [activeConvId, setActiveConvId] = useState(initialActiveConvId)
  const activeConv = useMemo(
    () => conversations.find(c => c.id === activeConvId) || null,
    [conversations, activeConvId],
  )

  function selectConversation(convId) {
    if (!convId) return
    setActiveConvId(convId)
  }

  async function handleOpenContact(otherUserId) {
    // Resolve (or create) the DM conversation id, but do NOT register it
    // in the bottom-right widget's open stack. The modal is its own
    // session; whether the chat appears bottom-right is the user's call,
    // not a side effect of clicking a contact in here.
    const convId = await createOrOpenDm?.(otherUserId)
    if (convId) setActiveConvId(convId)
  }

  // Translate active conversation's other-user id (DMs only) into a presence
  // dot value for ConversationPane's header.
  const isGroup = activeConv && (activeConv.kind === 'group' || activeConv.kind === 'hub')
  const online = activeConv && !isGroup ? !!presence.get(activeConv.other_user_id)?.online : false
  const peerStatus = activeConv && !isGroup ? presence.get(activeConv.other_user_id)?.status : undefined

  // ConversationPane expects an onClose that removes from open list; in the
  // modal we just clear the local active state — the user is still IN the
  // modal, they just want to see the contact list again.
  function clearActive() { setActiveConvId(null) }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 sm:p-8"
        onClick={onClose}
      >
        <motion.div
          key="panel"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0,  scale: 1 }}
          exit={{ opacity: 0, y: 8,    scale: 0.98 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="bg-white dark:bg-dark-card rounded-2xl shadow-elevated w-full max-w-6xl flex flex-col overflow-hidden"
          style={{ height: 'min(86vh, 860px)', ...(themeVars || {}) }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-dark-border shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-brand-100 dark:bg-brand-500/15">
              <MessageCircle size={15} className="text-brand-600 dark:text-brand-400" />
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex-1 truncate">
              Chat
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover"
              title="Collapse to widget"
              aria-label="Collapse chat"
            >
              <Minimize2 size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover"
              title="Close (Esc)"
              aria-label="Close expanded chat"
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* Body — sidebar + conversation pane */}
          <div className="flex-1 min-h-0 flex">
            {/* Left sidebar: search + contact list */}
            <aside className="w-[300px] shrink-0 border-r border-slate-200 dark:border-dark-border flex flex-col">
              <div className="p-3 border-b border-slate-200 dark:border-dark-border">
                <ContactSearch value={query} onChange={onQueryChange} />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ContactList
                  sections={sections}
                  groups={groups}
                  campfires={campfires}
                  tasks={tasks}
                  presence={presence}
                  onOpen={handleOpenContact}
                  onOpenGroup={selectConversation}
                  onOpenCampfire={selectConversation}
                  onOpenTask={selectConversation}
                  onCreateGroup={onCreateGroup}
                />
              </div>
            </aside>

            {/* Right pane: conversation OR empty state */}
            <main className="flex-1 min-w-0 flex flex-col bg-slate-50/40 dark:bg-dark-bg/30">
              {activeConv ? (
                <ConversationPane
                  conversation={activeConv}
                  online={online}
                  status={peerStatus}
                  onClose={clearActive}
                  onMinimize={clearActive}
                  onMarkRead={onMarkRead}
                  onAssignTask={onAssignTask}
                  threadRoot={threadState?.convId === activeConv.id ? threadState.rootMessage : null}
                  onOpenThread={(msg) => onOpenThread?.(activeConv.id, msg)}
                  onCloseThread={onCloseThread}
                  fullPage
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-slate-400 dark:text-slate-500 px-6">
                    <MessageCircle size={36} className="mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Pick a chat from the left to start reading.</p>
                  </div>
                </div>
              )}
            </main>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
