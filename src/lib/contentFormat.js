const HTML_ROOT_RE = /^\s*<(p|ul|ol|h[1-6]|blockquote)\b/i

export function isHtmlContent(s) {
  return typeof s === 'string' && HTML_ROOT_RE.test(s)
}
