#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Dev Projects CLI — read a project's Features / Feature Requests / Bugs from
// the terminal. Dependency-free (Node 18+ global fetch).
//
// Auth: reads SUPABASE_SERVICE_ROLE_KEY from .env.local (gitignored) and queries
// the REST API with it, bypassing row-level security. Falls back to the anon key
// with a warning (member-scoped tables return nothing under anon).
//
// Usage:
//   node scripts/projects.mjs list                       # all projects + counts
//   node scripts/projects.mjs show <name|id>             # all three lanes
//   node scripts/projects.mjs show PMAPMS --lane bugs    # one lane
//   node scripts/projects.mjs show PMAPMS --status Reported
//   node scripts/projects.mjs show PMAPMS --limit 20     # cap rows per group
//   node scripts/projects.mjs show PMAPMS --json         # raw JSON
//
// Or via npm:  npm run projects -- show PMAPMS
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── env ──────────────────────────────────────────────────────────────────
function loadEnv() {
  const out = {}
  try {
    const raw = readFileSync(join(ROOT, '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!m) continue
      out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env.local */ }
  return { ...out, ...process.env }
}

const env = loadEnv()
const URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY
const ANON = env.VITE_SUPABASE_ANON_KEY
const KEY = SERVICE || ANON

if (!URL || !KEY) {
  console.error('Missing VITE_SUPABASE_URL or a key in .env.local')
  process.exit(1)
}
if (!SERVICE) {
  console.warn('⚠️  No SUPABASE_SERVICE_ROLE_KEY found — using anon key. Member-scoped')
  console.warn('   tables (projects/requests/bugs) will return nothing under RLS.')
  console.warn('   Add SUPABASE_SERVICE_ROLE_KEY=... to .env.local.\n')
}

// ── colors ───────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s))
const bold = c('1'), dim = c('2'), cyan = c('36'), green = c('32'),
      yellow = c('33'), red = c('31'), blue = c('34')

// ── rest ─────────────────────────────────────────────────────────────────
async function rest(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) {
    console.error(`REST ${res.status}: ${await res.text()}`)
    process.exit(1)
  }
  return res.json()
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const REQUEST_STATUSES = ['Requested', 'Under Review', 'Planned', 'Rejected', 'Promoted']
const BUG_STATUSES = ['Reported', 'Confirmed', "Won't Fix", 'Promoted']

const SEV_COLOR = { Critical: red, High: yellow, Medium: yellow, Low: dim }
const STATUS_COLOR = {
  Requested: dim, 'Under Review': yellow, Planned: blue, Rejected: red, Promoted: green,
  Reported: dim, Confirmed: yellow, "Won't Fix": red,
}

// ── data ─────────────────────────────────────────────────────────────────
async function getProjects() {
  return rest('projects?select=id,name,status,target_date&order=created_at.desc')
}
async function resolveProject(needle) {
  const filter = UUID_RE.test(needle)
    ? `id=eq.${needle}`
    : `name=ilike.*${encodeURIComponent(needle)}*`
  const rows = await rest(`projects?select=id,name,status&${filter}&limit=2`)
  if (rows.length === 0) { console.error(`No project matching "${needle}".`); process.exit(1) }
  if (rows.length > 1) { console.error(`"${needle}" matches multiple projects — be more specific.`); process.exit(1) }
  return rows[0]
}
const getFeatures = (id) =>
  rest(`tasks?select=id,title,status,urgency,project_column_id,project_pos&project_id=eq.${id}&order=project_pos`)
const getColumns = (id) =>
  rest(`project_columns?select=id,name,pos&project_id=eq.${id}&order=pos`)
const getRequests = (id) =>
  rest(`feature_requests?select=id,title,status,description&project_id=eq.${id}&order=pos`)
const getBugs = (id) =>
  rest(`bugs?select=id,title,status,severity,description&project_id=eq.${id}&order=pos`)

// ── render ───────────────────────────────────────────────────────────────
function groupBy(rows, key, order) {
  const m = new Map(order.map((s) => [s, []]))
  for (const r of rows) {
    const k = r[key]
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return [...m.entries()].filter(([, v]) => v.length > 0)
}

function printGroup(label, total, groups, renderRow, limit) {
  console.log(`\n${bold(label)} ${dim(`(${total})`)}`)
  if (total === 0) { console.log(dim('  (none)')); return }
  for (const [status, rows] of groups) {
    const color = STATUS_COLOR[status] || ((s) => s)
    console.log(`  ${color(status)} ${dim(`(${rows.length})`)}`)
    const shown = limit ? rows.slice(0, limit) : rows
    for (const r of shown) console.log(`    ${renderRow(r)}`)
    if (limit && rows.length > limit) console.log(dim(`    … ${rows.length - limit} more`))
  }
}

async function cmdList() {
  const projects = await getProjects()
  if (projects.length === 0) { console.log('No projects.'); return }
  console.log(bold('\nDev Projects\n'))
  for (const p of projects) {
    const [feats, reqs, bugs] = await Promise.all([
      getFeatures(p.id), getRequests(p.id), getBugs(p.id),
    ])
    const openBugs = bugs.filter((b) => b.status === 'Reported' || b.status === 'Confirmed').length
    console.log(`${bold(p.name)}  ${dim(p.status)}`)
    console.log(`  ${dim(p.id)}`)
    console.log(`  ${feats.length} features · ${reqs.length} requests · ${bugs.length} bugs ${openBugs ? red(`(${openBugs} open)`) : ''}`)
    console.log('')
  }
}

async function cmdShow(needle, opts) {
  const project = await resolveProject(needle)
  const wantLane = (l) => opts.lane === 'all' || opts.lane === l
  const [columns, features, requests, bugs] = await Promise.all([
    getColumns(project.id), getFeatures(project.id), getRequests(project.id), getBugs(project.id),
  ])

  if (opts.json) {
    console.log(JSON.stringify({ project, features, requests, bugs }, null, 2))
    return
  }

  const sFilter = (rows) => (opts.status ? rows.filter((r) => r.status?.toLowerCase() === opts.status.toLowerCase()) : rows)

  console.log(`\n${bold(cyan(project.name))}  ${dim(project.status)}  ${dim('·')}  ${dim(project.id)}`)
  console.log(dim('─'.repeat(60)))

  if (wantLane('features')) {
    const f = sFilter(features)
    const colName = new Map(columns.map((c2) => [c2.id, c2.name]))
    const order = [...columns.map((c2) => c2.name), 'No column']
    const withCol = f.map((r) => ({ ...r, _col: colName.get(r.project_column_id) || 'No column' }))
    printGroup('FEATURES', f.length, groupBy(withCol, '_col', order),
      (r) => `${urgChip(r.urgency)} ${r.title} ${dim(`[${r.status}]`)}`, opts.limit)
  }
  if (wantLane('requests')) {
    const r = sFilter(requests)
    printGroup('FEATURE REQUESTS', r.length, groupBy(r, 'status', REQUEST_STATUSES),
      (row) => `${dim('•')} ${row.title}${row.description ? dim(' ✎') : ''}`, opts.limit)
  }
  if (wantLane('bugs')) {
    const b = sFilter(bugs)
    printGroup('BUGS', b.length, groupBy(b, 'status', BUG_STATUSES),
      (row) => `${sevChip(row.severity)} ${row.title}${row.description ? dim(' ✎') : ''}`, opts.limit)
  }
  console.log('')
}

function urgChip(u) {
  const col = u === 'Urgent' || u === 'High' ? red : u === 'Med' ? yellow : dim
  return col(`[${u || '—'}]`)
}
function sevChip(s) {
  return (SEV_COLOR[s] || dim)(`[${s}]`)
}

// ── argv ─────────────────────────────────────────────────────────────────
const [cmd, ...rest_] = process.argv.slice(2)
const opts = { lane: 'all', status: null, json: false, limit: null }
const positional = []
for (let i = 0; i < rest_.length; i++) {
  const a = rest_[i]
  if (a === '--lane') opts.lane = rest_[++i]
  else if (a === '--status') opts.status = rest_[++i]
  else if (a === '--limit') opts.limit = Number(rest_[++i])
  else if (a === '--json') opts.json = true
  else positional.push(a)
}

const run = async () => {
  if (cmd === 'list') return cmdList()
  if (cmd === 'show') {
    if (!positional[0]) { console.error('Usage: projects.mjs show <name|id> [--lane bugs|requests|features] [--status S] [--limit N] [--json]'); process.exit(1) }
    return cmdShow(positional[0], opts)
  }
  console.error('Commands:\n  list                       list all projects + counts\n  show <name|id> [options]   print a project\'s lanes')
  process.exit(1)
}
run()
