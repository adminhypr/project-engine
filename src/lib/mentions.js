/**
 * Check if the cursor is in an active @mention query.
 * Returns { active, query, startIndex } where startIndex is the position of '@'.
 */
export function parseMentionQuery(text, cursorPosition) {
  const before = text.slice(0, cursorPosition)
  const match = before.match(/(?:^|[\s])@([^\s]*)$/)
  if (!match) return { active: false, query: '', startIndex: -1 }

  const query = match[1]
  const startIndex = before.length - match[0].length + (match[0].startsWith('@') ? 0 : 1)
  return { active: true, query, startIndex }
}

/**
 * Replace the @query at startIndex with @DisplayName + trailing space.
 * Returns { newText, newCursorPosition }.
 */
export function insertMention(text, cursorPosition, displayName) {
  const { startIndex } = parseMentionQuery(text, cursorPosition)
  if (startIndex === -1) return { newText: text, newCursorPosition: cursorPosition }

  const before = text.slice(0, startIndex)
  // Strip one leading space from the remainder so the mention's trailing space
  // doesn't double up when the user was mid-word (cursor not at end of text).
  const rawAfter = text.slice(cursorPosition)
  const after = rawAfter.startsWith(' ') ? rawAfter.slice(1) : rawAfter
  const mention = `@${displayName} `
  return {
    newText: before + mention + after,
    newCursorPosition: before.length + mention.length,
  }
}

/**
 * Split content into segments for rendering: text and mention chunks.
 * Only matches @DisplayName that exists in the mentions array.
 */
export function buildMentionSegments(content, mentions) {
  if (!mentions || mentions.length === 0) {
    return [{ type: 'text', value: content }]
  }

  const sorted = [...mentions].sort((a, b) => b.display_name.length - a.display_name.length)
  const escaped = sorted.map(m => m.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g')

  const segments = []
  let lastIndex = 0
  let match

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    const matchedName = match[1]
    const mentionData = sorted.find(m => m.display_name === matchedName)
    segments.push({
      type: 'mention',
      value: match[0],
      user_id: mentionData.user_id,
      display_name: mentionData.display_name,
    })
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return segments
}
