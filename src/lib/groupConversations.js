// Pure helpers for group-conversation UI. Kept free of Supabase / React so
// they're easy to unit-test and reuse.

/**
 * Turn a raw conversation row + its participant user ids into the row shape
 * that the DM widget consumes. The widget already knows how to render DM rows
 * with `other_user_id` / `other_profile`; for groups we expose `participants`
 * and a display title instead.
 *
 *   row: {
 *     conversation_id, last_read_at, muted,
 *     conversation: { id, kind, title, team_id, last_message_at, last_message_preview }
 *   }
 *   participantsByConv: Map<convId, string[]>  (all user ids, including me)
 *   profileById:        Map<userId, profile>
 *   unreadByConv:       Map<convId, number>
 *   myId:               string
 */
export function shapeConversationRow({ row, participantsByConv, profileById, unreadByConv, myId }) {
  const conv = row.conversation
  const kind = conv.kind
  const allIds = participantsByConv.get(row.conversation_id) || []
  if (kind === 'group') {
    const participants = allIds
      .map(id => profileById.get(id))
      .filter(Boolean)
    return {
      id: row.conversation_id,
      kind: 'group',
      title: conv.title || 'Group',
      team_id: conv.team_id || null,
      last_message_at: conv.last_message_at,
      last_message_preview: conv.last_message_preview,
      last_read_at: row.last_read_at,
      muted: row.muted,
      other_user_id: null,
      other_profile: null,
      participants,
      unread: unreadByConv.get(row.conversation_id) || 0,
    }
  }
  // DM
  const otherId = allIds.find(id => id !== myId) || null
  return {
    id: row.conversation_id,
    kind: 'dm',
    title: null,
    team_id: null,
    last_message_at: conv.last_message_at,
    last_message_preview: conv.last_message_preview,
    last_read_at: row.last_read_at,
    muted: row.muted,
    other_user_id: otherId,
    other_profile: otherId ? (profileById.get(otherId) || null) : null,
    participants: null,
    unread: unreadByConv.get(row.conversation_id) || 0,
  }
}

/**
 * Render string for "N members" in a group header/list row. Handles pluralisation
 * and empty participant lists gracefully.
 */
export function memberCountLabel(participants) {
  const n = Array.isArray(participants) ? participants.length : 0
  if (n === 0) return 'No members'
  if (n === 1) return '1 member'
  return `${n} members`
}

/**
 * Derive a short display name for a group row: prefer the explicit title,
 * otherwise build one from the first few participant first-names. Never empty.
 */
export function groupDisplayName(conversation) {
  if (!conversation) return 'Group'
  const title = (conversation.title || '').trim()
  if (title) return title
  const parts = Array.isArray(conversation.participants) ? conversation.participants : []
  if (parts.length === 0) return 'Group'
  const names = parts
    .map(p => (p?.full_name || p?.email || '').split(' ')[0])
    .filter(Boolean)
    .slice(0, 3)
  if (names.length === 0) return 'Group'
  return names.join(', ') + (parts.length > 3 ? '…' : '')
}
