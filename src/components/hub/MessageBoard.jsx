import { useState, memo } from 'react'
import { useHubMessages } from '../../hooks/useHubMessages'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../ui/index'
import MessageThread from './MessageThread'
import MessageComposer from './MessageComposer'
import { Plus, Pin } from 'lucide-react'

function MessageBoard({ hubId }) {
  const { profile, isManager } = useAuth()
  const { messages, loading, postMessage, replyToMessage, deleteMessage, togglePin, getReplies } = useHubMessages(hubId)
  const [showComposer, setShowComposer] = useState(false)

  if (loading) return <div className="py-8 flex justify-center"><Spinner /></div>

  async function handlePost(title, content) {
    const ok = await postMessage(title, content)
    if (ok) setShowComposer(false)
    return ok
  }

  return (
    <div className="space-y-3">
      {!showComposer ? (
        <button
          onClick={() => setShowComposer(true)}
          className="btn btn-secondary text-xs w-full flex items-center justify-center gap-1.5"
        >
          <Plus size={14} />
          New announcement
        </button>
      ) : (
        <MessageComposer
          onSubmit={handlePost}
          onCancel={() => setShowComposer(false)}
        />
      )}

      {messages.length === 0 && !showComposer && (
        <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
          No announcements yet.
        </p>
      )}

      <div className="space-y-2">
        {messages.map(msg => (
          <MessageThread
            key={msg.id}
            message={msg}
            isOwn={msg.author_id === profile?.id}
            isManager={isManager}
            onReply={replyToMessage}
            onDelete={deleteMessage}
            onTogglePin={togglePin}
            getReplies={getReplies}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(MessageBoard)
