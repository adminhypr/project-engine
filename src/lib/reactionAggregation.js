// Pure helpers for aggregating raw dm_message_reactions rows into
// per-message, per-emoji summaries. Kept dependency-free so the logic
// is easy to unit test.

/**
 * @typedef {Object} RawReaction
 * @property {string} message_id
 * @property {string} user_id
 * @property {string} emoji
 */

/**
 * @typedef {Object} AggregatedReaction
 * @property {string} emoji
 * @property {number} count
 * @property {string[]} users     user ids that reacted with this emoji
 * @property {boolean} mine       true if `myUserId` is in `users`
 */

/**
 * Aggregate raw reaction rows into a map keyed by message id.
 * Each message's value is an array of { emoji, count, users, mine }.
 * Emojis are ordered by first-seen (stable order).
 *
 * @param {RawReaction[]} rows
 * @param {string|null|undefined} myUserId
 * @returns {Record<string, AggregatedReaction[]>}
 */
export function aggregateReactions(rows, myUserId) {
  const out = {}
  if (!Array.isArray(rows) || rows.length === 0) return out
  for (const r of rows) {
    if (!r || !r.message_id || !r.emoji || !r.user_id) continue
    const msgId = r.message_id
    let bucket = out[msgId]
    if (!bucket) { bucket = []; out[msgId] = bucket }
    let entry = bucket.find(e => e.emoji === r.emoji)
    if (!entry) {
      entry = { emoji: r.emoji, count: 0, users: [], mine: false }
      bucket.push(entry)
    }
    if (!entry.users.includes(r.user_id)) {
      entry.users.push(r.user_id)
      entry.count = entry.users.length
      if (r.user_id === myUserId) entry.mine = true
    }
  }
  return out
}

/**
 * Return a new rows array with a given (message, user, emoji) toggled —
 * removed if present, added if not. Used for optimistic updates.
 *
 * @param {RawReaction[]} rows
 * @param {string} messageId
 * @param {string} userId
 * @param {string} emoji
 * @returns {RawReaction[]}
 */
export function toggleReactionRow(rows, messageId, userId, emoji) {
  const existing = rows.find(
    r => r.message_id === messageId && r.user_id === userId && r.emoji === emoji
  )
  if (existing) {
    return rows.filter(
      r => !(r.message_id === messageId && r.user_id === userId && r.emoji === emoji)
    )
  }
  return [...rows, { message_id: messageId, user_id: userId, emoji }]
}
