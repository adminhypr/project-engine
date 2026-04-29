// Pure URL builders for notification deep links. Used by edge functions
// (rendered into email HTML) AND by the frontend (when we need to build
// a "share this thread" link). Centralised so the URL contract has one
// source of truth — keep it in sync with the table at the top of
// docs/plans/2026-04-29-deep-link-notifications.md.

function withParams(base, path, params) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null) sp.set(k, v)
  }
  const qs = sp.toString()
  return qs ? `${base}${path}?${qs}` : `${base}${path}`
}

export function taskUrl(base, taskId) {
  if (!taskId) return null
  return withParams(base, '/my-tasks', { task: taskId })
}

export function taskCommentUrl(base, taskId, commentId) {
  if (!taskId) return null
  return withParams(base, '/my-tasks', { task: taskId, comment: commentId || null })
}

export function cardUrl(base, hubId, cardId) {
  if (!hubId || !cardId) return null
  return withParams(base, `/hub/${encodeURIComponent(hubId)}`, { card: cardId })
}

export function cardCommentUrl(base, hubId, cardId, commentId) {
  if (!hubId || !cardId) return null
  return withParams(base, `/hub/${encodeURIComponent(hubId)}`, { card: cardId, comment: commentId || null })
}

export function dmUrl(base, convId) {
  if (!convId) return null
  return withParams(base, '/', { dm: convId })
}

export function dmMessageUrl(base, convId, messageId) {
  if (!convId) return null
  return withParams(base, '/', { dm: convId, message: messageId || null })
}

export function hubMessageUrl(base, hubId, messageId) {
  if (!hubId) return null
  return withParams(base, `/hub/${encodeURIComponent(hubId)}`, { message: messageId || null })
}
