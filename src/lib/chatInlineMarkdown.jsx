import { Link } from 'react-router-dom'

// Minimal inline markdown used inside DM / Campfire system messages.
// Handles two tokens in any order, no nesting:
//   **bold**      → <strong>
//   [text](url)   → <Link> for in-app URLs, <a> for external
// Anything else is rendered as plain text. Not a general-purpose parser.

const TOKEN = /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)/g

function isInternal(url) {
  return typeof url === 'string' && url.startsWith('/')
}

// Pulls the first referenced task UUID out of a system message, if any,
// so the message can render a task-card preview beneath the inline text.
// Matches /my-tasks?task={uuid} inside a markdown link's url portion.
const TASK_URL = /\/my-tasks\?task=([0-9a-fA-F-]{16,})/

export function extractTaskIdFromMessage(text) {
  if (!text) return null
  const m = text.match(TASK_URL)
  return m ? m[1] : null
}

export function renderChatInlineMarkdown(text) {
  if (!text) return null
  const out = []
  let last = 0
  let match
  let key = 0

  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > last) {
      out.push(<span key={`t${key++}`}>{text.slice(last, match.index)}</span>)
    }
    const [, link, bold] = match
    if (link) {
      const labelEnd = link.indexOf(']')
      const label = link.slice(1, labelEnd)
      const url = link.slice(labelEnd + 2, link.length - 1)
      out.push(
        isInternal(url)
          ? <Link key={`l${key++}`} to={url} className="font-semibold text-brand-600 dark:text-brand-300 hover:underline">{label}</Link>
          : <a key={`l${key++}`} href={url} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 dark:text-brand-300 hover:underline">{label}</a>
      )
    } else if (bold) {
      out.push(<strong key={`b${key++}`}>{bold.slice(2, -2)}</strong>)
    }
    last = TOKEN.lastIndex
  }
  if (last < text.length) out.push(<span key={`t${key++}`}>{text.slice(last)}</span>)
  return out
}
