// Module-level EventTarget that bridges the single global dm_messages
// subscription (in useDmRealtime) to per-conversation consumers
// (useConversation) and the conversation list (useConversations).
//
// Events:
//   "message"  detail: { conversationId, message }
//   "read"     detail: { conversationId, userId, readAt }

const bus = new EventTarget()

export function emitMessage(conversationId, message) {
  bus.dispatchEvent(new CustomEvent('message', { detail: { conversationId, message } }))
}

export function emitRead(conversationId, userId, readAt) {
  bus.dispatchEvent(new CustomEvent('read', { detail: { conversationId, userId, readAt } }))
}

export function onMessage(handler) {
  const wrapped = (e) => handler(e.detail)
  bus.addEventListener('message', wrapped)
  return () => bus.removeEventListener('message', wrapped)
}

export function onRead(handler) {
  const wrapped = (e) => handler(e.detail)
  bus.addEventListener('read', wrapped)
  return () => bus.removeEventListener('read', wrapped)
}
