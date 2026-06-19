// Shared URL linkify utilities used by RichContentRenderer (chat/hub content)
// and TaskDetailPanel (task comments).
//
// Three URL forms are recognised:
//   1. Full URL with protocol:   https://example.com/path
//   2. www-prefixed:             www.example.com/path   (href gets https:// prepended)
//   3. Bare domain (allowlist):  example.com, docs.example.com/path
//
// The bare-domain branch is gated on a TLD allowlist so that strings like
// "v1.2.3" or "report.txt" or "hi.there" don't accidentally linkify.

// Kept in sync with the brief. Add new TLDs here if users request them.
export const TLD_ALLOWLIST = [
  'com', 'org', 'net', 'io', 'co', 'app', 'dev', 'ai', 'ly', 'me',
  'us', 'uk', 'ph', 'info', 'tv', 'xyz', 'biz', 'edu', 'gov', 'mil',
  'tech', 'site', 'store', 'cloud', 'design', 'so', 'docs',
]

const TLD_GROUP = TLD_ALLOWLIST.join('|')

// URL patterns, tried in order:
//  - Protocol URL (greedy, non-whitespace)
//  - www. prefix
//  - Bare domain ending in allowlisted TLD
const URL_ALT = [
  'https?:\\/\\/[^\\s<>]+',
  'www\\.[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*)*\\.[a-z]{2,}(?:\\/[^\\s<>]*)?',
  `(?:[a-z0-9][a-z0-9-]*\\.)+(?:${TLD_GROUP})\\b(?:\\/[^\\s<>]*)?`,
].join('|')

// Inline markdown + URL auto-link. Capture groups (1-indexed):
//   1: **bold**         2: _italic_
//   3/4: [text](url)    5: bare/auto URL (any of the three forms)
//   6: ~~strikethrough~~
//   7: `inline code`    (content is LITERAL — no nested formatting)
//
// Matching is leftmost-wins (regex scans by position), so alternative order
// does not change precedence between non-overlapping markers. The code-span
// branch wins for any text it encloses simply because its opening backtick is
// the leftmost marker — once matched, the whole `...` span is consumed and the
// engine never re-examines markers inside it, keeping code content literal.
export const INLINE_MD_RE_SOURCE =
  '\\*\\*([^*\\n]+?)\\*\\*' +
  '|_([^_\\n]+?)_' +
  '|\\[([^\\]\\n]+?)\\]\\(([^)\\n]+?)\\)' +
  `|(${URL_ALT})` +
  '|~~([^~\\n]+?)~~' +
  '|`([^`\\n]+?)`'

export const INLINE_MD_FLAGS = 'gi'

// URL-only regex for TaskDetailPanel comment linkification (no markdown passes).
export const URL_RE_SOURCE = `(${URL_ALT})`
export const URL_RE_FLAGS = 'gi'

/**
 * Given a raw matched URL string, strip common trailing punctuation and
 * build { displayUrl, href, trailing } where href gets https:// prepended
 * if no protocol is present.
 */
export function normalizeUrlMatch(raw) {
  const trailingMatch = raw.match(/[.,!?;:)\]}'">]+$/)
  const trailing = trailingMatch ? trailingMatch[0] : ''
  const displayUrl = trailing ? raw.slice(0, raw.length - trailing.length) : raw
  const href = /^https?:\/\//i.test(displayUrl) ? displayUrl : `https://${displayUrl}`
  return { displayUrl, href, trailing }
}

// Line-level block markers. Conservative on purpose: only a "> ", "- ", "* "
// or "N. " at the START of a line counts; mid-line ">"/"-" stay literal text.
const QUOTE_RE = /^>\s(.*)$/
const BULLET_RE = /^[-*]\s+(.+)$/
const ORDERED_RE = /^\d+\.\s+(.+)$/
const FENCE_RE = /^```/

/**
 * Parse a plaintext message into an ordered list of block descriptors so the
 * renderer can emit <pre>/<blockquote>/<ul>/<ol>/<p> instead of one flat <p>.
 *
 * Block types:
 *   { type: 'p',     lines:  string[] }   // consecutive non-special lines
 *   { type: 'code',  code:   string   }   // ```-fenced; content is LITERAL
 *   { type: 'quote', lines:  string[] }   // consecutive "> " lines
 *   { type: 'ul',    items:  string[] }   // consecutive "- "/"* " lines
 *   { type: 'ol',    items:  string[] }   // consecutive "N. " lines
 *
 * Consecutive lines of the same kind group into one block. Inline markdown
 * (bold/italic/strike/code/links/mentions) is rendered later, per-line, by the
 * consumer — EXCEPT inside `code` blocks, which stay verbatim.
 */
export function parseBlocks(content) {
  const text = typeof content === 'string' ? content : ''
  const lines = text.split('\n')
  const blocks = []
  let i = 0

  const flushPushable = (type, key, value) => {
    const last = blocks[blocks.length - 1]
    if (last && last.type === type) {
      last[key].push(value)
    } else {
      blocks.push({ type, [key]: [value] })
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block: collect everything until the closing ``` (or EOF).
    if (FENCE_RE.test(line)) {
      const codeLines = []
      i++
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // consume the closing fence
      blocks.push({ type: 'code', code: codeLines.join('\n') })
      continue
    }

    let m
    if ((m = line.match(QUOTE_RE))) {
      flushPushable('quote', 'lines', m[1])
    } else if ((m = line.match(BULLET_RE))) {
      flushPushable('ul', 'items', m[1])
    } else if ((m = line.match(ORDERED_RE))) {
      flushPushable('ol', 'items', m[1])
    } else {
      flushPushable('p', 'lines', line)
    }
    i++
  }

  return blocks
}
