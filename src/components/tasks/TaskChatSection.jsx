import { useEffect, useMemo, useRef } from 'react'
import { MessagesSquare } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTaskChat } from '../../hooks/useTaskChat'
import { useConversations } from '../../hooks/useConversations'
import MessageList from '../chat/MessageList'
import ChatComposer from '../chat/ChatComposer'
import { ReplyProvider } from '../chat/ReplyContext'

/**
 * Inline Chat section for TaskDetailPanel. Reuses the DM MessageList +
 * ChatComposer primitives so the look/behaviour matches the widget; data
 * flows through useTaskChat (kind='task' conversation keyed by taskId).
 *
 * ChatComposer's onSend callback signature is positional
 * (content, inlineImages, replyTarget, mentions) — same as
 * useConversation.sendMessage. useTaskChat.sendMessage takes an object, so
 * we adapt here.
 */
export default function TaskChatSection({ taskId }) {
  const { profile } = useAuth()
  const { conversationId, messages, loading, sendMessage, markRead } = useTaskChat(taskId)
  const { conversations } = useConversations()

  // Derive the task-chat conversation row (participants, etc.) from the
  // global conversations list. It may be absent momentarily before the
  // hook's first refetch completes — we degrade gracefully.
  const conversation = useMemo(
    () => conversations.find(c => c.kind === 'task' && c.task_id === taskId) || null,
    [conversations, taskId]
  )
  const participants = conversation?.participants || []

  // Fire markRead after the initial fetch completes (messages loaded). We
  // re-fire whenever message count bumps so that staying in a chat with
  // incoming messages keeps the participant row current.
  const markReadRef = useRef(markRead)
  markReadRef.current = markRead
  useEffect(() => {
    if (!conversationId || loading) return
    markReadRef.current?.()
  }, [conversationId, loading, messages.length])

  // Mentionable people = all other participants in this task chat.
  const mentionablePeople = useMemo(
    () => participants
      .filter(p => p?.id && p.id !== profile?.id)
      .map(p => ({ id: p.id, full_name: p.full_name, avatar_url: p.avatar_url })),
    [participants, profile?.id]
  )

  // Profile lookup for reactions / seen-by / thread avatars.
  const profileLookup = useMemo(() => {
    const map = new Map()
    for (const p of participants) if (p?.id) map.set(p.id, p)
    if (profile?.id) map.set(profile.id, profile)
    return map
  }, [participants, profile])

  // Adapter: ChatComposer calls onSend(content, images, replyTarget, mentions).
  // useTaskChat expects an object with { body, mentions, inline_images, reply_to_* }.
  async function handleSend(content, inlineImages = [], replyTarget = null, mentions = []) {
    const { error } = await sendMessage({
      body: content,
      mentions,
      inline_images: inlineImages,
      reply_to_id:        replyTarget?.id        || null,
      reply_to_author_id: replyTarget?.author_id || null,
      reply_to_preview:   replyTarget?.preview   || null,
    })
    return !error
  }

  const scrollRootRef = useRef(null)

  return (
    <div
      id="task-chat-section"
      className="border-t border-slate-100 dark:border-dark-border flex flex-col"
    >
      <div className="px-4 sm:px-5 py-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Chat
        </span>
        {participants.length > 0 && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {participants.length} {participants.length === 1 ? 'participant' : 'participants'}
          </span>
        )}
      </div>

      {/*
        Fixed-height chat region so the message list scrolls independently of
        the outer panel. 380px is close to the DM widget's compact pane.
      */}
      <ReplyProvider scrollToMessage={() => {}}>
        <div className="flex flex-col h-[380px] border-t border-slate-100 dark:border-dark-border bg-white dark:bg-dark-card">
          {messages.length === 0 && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <MessagesSquare size={32} className="text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No messages yet. Start the conversation.
              </p>
            </div>
          ) : (
            <MessageList
              messages={messages}
              myId={profile?.id}
              loading={loading}
              hasMore={false}
              onLoadMore={() => {}}
              onDelete={() => {}}
              otherLastReadAt={null}
              groupReaders={null}
              scrollRootRef={scrollRootRef}
              conversationId={conversationId}
              profileLookup={profileLookup}
              onOpenThread={() => {}}
            />
          )}
          {conversationId && (
            <ChatComposer
              conversationId={conversationId}
              onSend={handleSend}
              onTyping={() => {}}
              disabled={!conversationId}
              mentionablePeople={mentionablePeople}
              placeholder="Message about this task…"
            />
          )}
        </div>
      </ReplyProvider>
    </div>
  )
}
