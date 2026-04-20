import { createContext, useContext, useState, useCallback } from 'react'

// Scoped to a single ConversationPane. Lets hover-reveal reply buttons on
// message bubbles push a target into the composer without prop-drilling.
// Also carries an imperative scrollToMessage callback so quote previews
// elsewhere can jump to the referenced message.
const ReplyContext = createContext(null)

export function ReplyProvider({ scrollToMessage, children }) {
  const [target, setTarget] = useState(null)

  const requestReply = useCallback((message, authorName) => {
    if (!message) return
    const preview = (message.content || '').slice(0, 140)
      || (message.inline_images?.length ? '📷 Image' : '')
      || 'message'
    setTarget({
      id: message.id,
      author_id: message.author_id,
      authorName,
      preview,
    })
  }, [])

  const clearReply = useCallback(() => setTarget(null), [])

  return (
    <ReplyContext.Provider value={{ target, requestReply, clearReply, scrollToMessage }}>
      {children}
    </ReplyContext.Provider>
  )
}

export function useReplyContext() {
  return useContext(ReplyContext) || {
    target: null,
    requestReply: () => {},
    clearReply: () => {},
    scrollToMessage: () => {},
  }
}
