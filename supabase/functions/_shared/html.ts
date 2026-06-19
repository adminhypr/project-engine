// supabase/functions/_shared/html.ts
//
// Shared HTML-escaping + URL-sanitizing helpers for email templates.
//
// SECURITY: every piece of user-derived content (message bodies, previews,
// sender / mentioner display names, conversation / hub / team / task titles,
// decline reasons, notes, etc.) MUST be passed through `escapeHtml` EXACTLY
// ONCE before it is interpolated into an HTML template literal. Stored content
// (e.g. `dm_messages.content`) is the RAW text the user typed — it is NOT
// pre-escaped — so escaping once here is correct and produces the literal
// characters the user typed (e.g. `<img src=x>` shows as text, not as an image
// or a double-escaped `&lt;img&gt;`).
//
// Do NOT escape your own trusted constants or URLs you build yourself. DO
// escape any user content embedded in a URL's *visible text*. For an `href`
// attribute, run the URL through `safeUrl` to neutralize `javascript:` /
// `data:` / `vbscript:` schemes.

/**
 * Escape the five HTML-significant characters. Handles null/undefined -> ''.
 * Escapes `&` first so the other replacements don't double-encode it.
 * Escapes both `"` and `'` so the result is safe in attribute contexts too.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Sanitize a URL destined for an `href`/`src` attribute. Returns the URL
 * (HTML-escaped) when it uses a safe scheme (http, https, mailto) or is a
 * relative/anchor URL; otherwise returns '#' to neutralize dangerous schemes
 * (javascript:, data:, vbscript:, etc.).
 *
 * Intended for URLs that MIGHT be influenced by user input. URLs you build
 * entirely from trusted constants (e.g. `${APP_URL}/my-tasks?task=${id}`) are
 * already safe; passing them through here is harmless but optional.
 */
export function safeUrl(url: unknown): string {
  if (url === null || url === undefined) return '#'
  const raw = String(url).trim()
  if (raw === '') return '#'
  // Strip control chars + whitespace (0x00-0x20) that browsers ignore when
  // parsing the scheme (e.g. "java\tscript:") before testing the scheme.
  // deno-lint-ignore no-control-regex
  const stripped = raw.replace(/[\x00-\x20]/g, '').toLowerCase()
  const DANGEROUS = /^(javascript|data|vbscript|file):/
  if (DANGEROUS.test(stripped)) return '#'
  // Allow http(s), mailto, protocol-relative (//), relative paths, and anchors.
  return escapeHtml(raw)
}
