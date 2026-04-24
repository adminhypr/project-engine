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

// Inline markdown (bold, italic, [text](url)) + URL auto-link.
// The 5th capture group is the URL (any of the three forms).
export const INLINE_MD_RE_SOURCE =
  '\\*\\*([^*\\n]+?)\\*\\*' +
  '|_([^_\\n]+?)_' +
  '|\\[([^\\]\\n]+?)\\]\\(([^)\\n]+?)\\)' +
  `|(${URL_ALT})`

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
