// Pending invite intents — bridges the gap between "send invite email" and
// "first sign-in creates profile". The inviter chooses role + team at invite
// time; those values are applied the first time the user is granted a team
// in the Users table.
//
// Storage format (localStorage key `pe-pending-invites`):
//   { "email@lower.case": { role, teamId, inviterName, createdAt } }

const KEY = 'pe-pending-invites'

function readAll() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map || {}))
  } catch {
    /* noop */
  }
}

export function setPendingInvite(email, { role, teamId, inviterName }) {
  if (!email) return
  const key = email.trim().toLowerCase()
  if (!key) return
  const all = readAll()
  all[key] = {
    role: role || 'Staff',
    teamId: teamId || null,
    inviterName: inviterName || null,
    createdAt: new Date().toISOString()
  }
  writeAll(all)
}

export function getPendingInvite(email) {
  if (!email) return null
  const key = email.trim().toLowerCase()
  const all = readAll()
  return all[key] || null
}

export function clearPendingInvite(email) {
  if (!email) return
  const key = email.trim().toLowerCase()
  const all = readAll()
  if (key in all) {
    delete all[key]
    writeAll(all)
  }
}
