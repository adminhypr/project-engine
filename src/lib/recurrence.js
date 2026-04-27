// Pure helpers for recurring task templates. No supabase deps — testable.

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Mirror of the SQL compute_next_recurrence_run helper in JS so the form
// can preview "Next spawn: ___" without a server round trip. The SQL
// helper remains the source of truth at spawn time.
//
// Returns a Date that is strictly > `from`. Anchor in the future is
// returned as-is. Anchor in the past is advanced by `interval × every`
// until it crosses `from`.
//
// Caps at 100k iterations as a safety net for malformed inputs.
export function computeNextRun({ anchor, intervalUnit, intervalEvery, from = new Date() }) {
  if (!(anchor instanceof Date) || isNaN(anchor)) return null
  if (!Number.isInteger(intervalEvery) || intervalEvery < 1) return null
  if (!['day', 'week', 'month'].includes(intervalUnit)) return null

  if (anchor > from) return anchor

  let candidate = new Date(anchor.getTime())
  let i = 0
  while (candidate <= from && i < 100000) {
    candidate = advanceByOneStep(candidate, intervalUnit, intervalEvery)
    i++
  }
  return candidate
}

function advanceByOneStep(date, unit, every) {
  const d = new Date(date.getTime())
  if (unit === 'day') {
    d.setUTCDate(d.getUTCDate() + every)
    return d
  }
  if (unit === 'week') {
    d.setUTCDate(d.getUTCDate() + every * 7)
    return d
  }
  if (unit === 'month') {
    // JS's setUTCMonth overflows when the day-of-month doesn't exist in the
    // target month (Jan 31 + 1mo → Mar 3 because Feb 28 + 3 days). Match
    // Postgres behavior: clamp to the last day of the target month instead.
    const targetMonth = d.getUTCMonth() + every
    const targetYear  = d.getUTCFullYear() + Math.floor(targetMonth / 12)
    const wrappedMonth = ((targetMonth % 12) + 12) % 12
    const originalDay  = d.getUTCDate()
    // Last day of the target month — Date(year, monthIndex+1, 0) trick.
    const lastDay = new Date(Date.UTC(targetYear, wrappedMonth + 1, 0)).getUTCDate()
    const clampedDay = Math.min(originalDay, lastDay)
    d.setUTCFullYear(targetYear)
    d.setUTCDate(1) // avoid intermediate overflow before setting month
    d.setUTCMonth(wrappedMonth)
    d.setUTCDate(clampedDay)
    return d
  }
  return d
}

// Human-readable interval label: "every day", "every 3 days", "every 2 weeks", etc.
export function formatIntervalLabel(unit, every) {
  if (!['day', 'week', 'month'].includes(unit)) return ''
  if (!Number.isInteger(every) || every < 1) return ''
  if (every === 1) {
    return `every ${unit}`
  }
  return `every ${every} ${unit}s`
}

// Human-readable countdown: "in 3 days", "in 4 hours", "in 12 minutes", "now".
export function formatCountdown(target, from = new Date()) {
  if (!(target instanceof Date) || isNaN(target)) return ''
  const ms = target.getTime() - from.getTime()
  if (ms <= 0) return 'due now'
  const days = Math.floor(ms / MS_PER_DAY)
  if (days >= 1) return `in ${days} day${days === 1 ? '' : 's'}`
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)))
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
}

// Validation for a template draft before submit. Returns { ok, errors }.
export function validateTemplateDraft(draft) {
  const errors = []
  if (!draft.template_title?.trim()) errors.push('Title is required')
  if (!['day', 'week', 'month'].includes(draft.interval_unit)) {
    errors.push('Pick an interval')
  }
  if (!Number.isInteger(draft.interval_every) || draft.interval_every < 1) {
    errors.push('Repeat must be at least 1')
  }
  if (!draft.anchor_at || isNaN(new Date(draft.anchor_at))) {
    errors.push('Pick a start date')
  }
  if (!Array.isArray(draft.assignee_ids) || draft.assignee_ids.length === 0) {
    errors.push('Pick at least one assignee')
  }
  if (Number.isInteger(draft.template_due_offset_hours)
      && draft.template_due_offset_hours < 0) {
    errors.push('Due offset cannot be negative')
  }
  return { ok: errors.length === 0, errors }
}
