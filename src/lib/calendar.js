// Pure date math for the Notion-style calendar view. Kept out of the
// components so month-grid construction and due-date bucketing are
// unit-tested. See docs/plans/2026-07-05-calendar-view-design.md.
//
// `month` is 0-based everywhere (JS Date convention). Weeks start Monday.

// Local YYYY-MM-DD for a Date. NEVER use toISOString() here — it converts to
// UTC and shifts the day for negative-UTC users (the same pitfall
// projectBoard.parseDueLocal exists for).
export function toIsoDay(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Parse a due_date as LOCAL time. Date-only strings ('YYYY-MM-DD') parse as
// UTC midnight via `new Date(s)`, which lands on the previous local day in
// negative-UTC timezones — build from local Y/M/D instead. Full timestamps
// are left to the Date constructor (they carry their own time).
function parseDueLocal(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// Weeks-of-7-day-cells covering `year`/`month`, Monday-start, including
// prev/next-month spillover so the grid is always full rows.
export function monthMatrix(year, month, { now = new Date() } = {}) {
  const todayIso = toIsoDay(now)
  const first = new Date(year, month, 1)
  // Monday-start offset: JS getDay() is 0=Sun..6=Sat -> Mon=0..Sun=6
  const lead = (first.getDay() + 6) % 7
  const cursor = new Date(year, month, 1 - lead)

  const weeks = []
  do {
    const week = []
    for (let i = 0; i < 7; i++) {
      const iso = toIsoDay(cursor)
      week.push({
        iso,
        dayOfMonth: cursor.getDate(),
        inMonth: cursor.getMonth() === month && cursor.getFullYear() === year,
        isToday: iso === todayIso,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  } while (cursor.getMonth() === month && cursor.getFullYear() === year)
  return weeks
}

// Split tasks into per-day buckets (Map<iso, task[]>) + an undated list.
// Order within a day preserves the input order.
export function bucketTasksByDay(tasks) {
  const byDay = new Map()
  const undated = []
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const d = parseDueLocal(t?.due_date)
    if (!d) { undated.push(t); continue }
    const iso = toIsoDay(d)
    if (!byDay.has(iso)) byDay.set(iso, [])
    byDay.get(iso).push(t)
  }
  return { byDay, undated }
}

// Local calendar day ('YYYY-MM-DD') a due_date falls on, or null.
export function dueDayIso(due) {
  const d = parseDueLocal(due)
  return d ? toIsoDay(d) : null
}

// New due_date value for dropping a task on `iso`. tasks.due_date is
// timestamptz: a bare 'YYYY-MM-DD' would store UTC midnight and render on
// the PREVIOUS local day for negative-UTC users, and due TIMES feed the
// 4h/24h reminder emails — so keep the task's local time-of-day and change
// only the day. Tray drops (no prior date) default to 17:00 local.
export function dueDateForDay(prevDue, iso, { defaultHour = 17 } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return null
  let hours = defaultHour, minutes = 0
  if (prevDue) {
    const prev = new Date(prevDue)
    if (!isNaN(prev.getTime()) && /T|\s\d{2}:/.test(String(prevDue))) {
      hours = prev.getHours()
      minutes = prev.getMinutes()
    }
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hours, minutes).toISOString()
}

export function addMonths(year, month, delta) {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export function formatMonthTitle(year, month) {
  return `${MONTHS[month]} ${year}`
}
