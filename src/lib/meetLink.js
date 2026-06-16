// Helpers for video-call (Google Meet) messages in chat. A call is a normal
// dm_messages row with kind='call' whose content carries the Meet link; the
// renderer shows a "Join call" card. Kept pure for unit testing. See
// docs/plans/2026-06-16-chat-video-calls-design.md.

const CALL_PREFIX = '📞 Started a call: '

// What the edge function stores as the message body. Plain text + the URL so
// that even an old client that doesn't know kind='call' renders a usable
// clickable link (graceful degradation).
export function buildCallMessageContent(url) {
  return `${CALL_PREFIX}${url}`
}

// Google Meet links look like https://meet.google.com/abc-defg-hij
const MEET_URL_RE = /https:\/\/meet\.google\.com\/[a-z0-9-]+/i

// Pull the Meet URL out of a call message's content. Returns null if absent.
export function extractMeetUrl(content) {
  if (!content || typeof content !== 'string') return null
  const m = content.match(MEET_URL_RE)
  return m ? m[0] : null
}

// True when a message should render as a call card.
export function isCallMessage(message) {
  return message?.kind === 'call'
}
