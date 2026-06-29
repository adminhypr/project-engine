#!/usr/bin/env node
// hypr — work your Dev Projects tasks from the terminal.
// Talks to the `dev-api` Supabase edge function, authenticated by your personal
// access token (generate one in the app: Settings → API Keys).
//
// Config: ~/.config/hypr/config.json  ({ apiUrl, key })
// Env overrides: HYPR_API_KEY, HYPR_API_URL
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { createInterface } from 'node:readline'

const DEFAULT_API = 'https://urdzocyfxgyhqmoqbuvk.supabase.co/functions/v1/dev-api'
const CFG_PATH = join(homedir(), '.config', 'hypr', 'config.json')

// ── config ────────────────────────────────────────────────────────────────
function loadCfg() {
  try { return JSON.parse(readFileSync(CFG_PATH, 'utf8')) } catch { return {} }
}
function saveCfg(cfg) {
  mkdirSync(dirname(CFG_PATH), { recursive: true })
  writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2))
}
const cfg = loadCfg()
const API = process.env.HYPR_API_URL || cfg.apiUrl || DEFAULT_API
const KEY = process.env.HYPR_API_KEY || cfg.key || null

// ── colors ────────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s))
const bold = c('1'), dim = c('2'), cyan = c('36'), green = c('32'), yellow = c('33'), red = c('31'), blue = c('34')

const STATUS_COLOR = {
  'Not Started': dim, 'In Progress': blue, Blocked: red, Done: green,
  Requested: dim, 'Under Review': yellow, Planned: blue, Rejected: red, Promoted: green,
  Reported: dim, Confirmed: yellow, "Won't Fix": red,
}
const SEV_COLOR = { Critical: red, High: yellow, Medium: yellow, Low: dim }

// ── api ───────────────────────────────────────────────────────────────────
async function api(path, { method = 'GET', body } = {}) {
  if (!KEY) { console.error(red('Not logged in. Run: hypr login')); process.exit(1) }
  const res = await fetch(API + path, {
    method,
    headers: { 'x-hypr-key': KEY, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data; try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
  if (!res.ok) { console.error(red(`Error ${res.status}: ${data.error || text}`)); process.exit(1) }
  return data
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()) }))
}

// Text for desc/title edits. `parts` are the trailing argv words; pass a single
// `-` to read the whole body from stdin (handy for multi-line descriptions:
// `hypr task T-X desc - < notes.md`). An empty result clears the field.
function readText(parts) {
  if (parts.length === 1 && parts[0] === '-') {
    return new Promise((resolve) => {
      let s = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (d) => { s += d }).on('end', () => resolve(s.replace(/\n+$/, '')))
    })
  }
  return Promise.resolve(parts.join(' '))
}

// ── helpers ───────────────────────────────────────────────────────────────
async function resolveProject(needle) {
  const { projects } = await api('/projects')
  if (!projects.length) { console.error(red('You are not a member of any projects.')); process.exit(1) }
  const byId = projects.find((p) => p.id === needle)
  if (byId) return byId
  const matches = projects.filter((p) => (p.name || '').toLowerCase().includes(needle.toLowerCase()))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) { console.error(red(`No project matching "${needle}". Your projects: ${projects.map((p) => p.name).join(', ')}`)); process.exit(1) }
  console.error(red(`"${needle}" is ambiguous: ${matches.map((p) => p.name).join(', ')}`)); process.exit(1)
}

function printGrouped(label, items, statusKey, extra = () => '') {
  console.log(`\n${bold(label)} ${dim(`(${items.length})`)}`)
  if (!items.length) { console.log(dim('  (none)')); return }
  const order = [...new Set(items.map((i) => i[statusKey]))]
  for (const st of order) {
    const rows = items.filter((i) => i[statusKey] === st)
    const col = STATUS_COLOR[st] || ((s) => s)
    console.log(`  ${col(st)} ${dim(`(${rows.length})`)}`)
    // Show the id so rows are addressable: tasks have a short T-… id; requests/
    // bugs are keyed by uuid, so print that (it's what `hypr request/bug` needs).
    for (const r of rows) {
      const idLabel = r.task_id || r.id
      console.log(`    ${extra(r)}${idLabel ? dim(`${idLabel}  `) : ''}${r.title}`)
    }
  }
}

// Edit a backlog request/bug via PATCH /{requests|bugs}/:id. `:id` is the uuid
// from the list. Supports desc (alias notes), title, and — for bugs — severity.
async function editLaneRow(lane, noun) {
  const id = args[0], sub = args[1]
  const usage = `Usage: hypr ${noun} <id> desc "text" | title "text"${noun === 'bug' ? ' | sev <Critical|High|Medium|Low>' : ''}\n  (id is the uuid from \`hypr ${lane}\`; use \`desc -\` to read from stdin)`
  if (!id || !sub) { console.error(red(usage)); process.exit(1) }
  const body = {}
  if (sub === 'desc' || sub === 'describe' || sub === 'notes') {
    body.description = await readText(args.slice(2))
  } else if (sub === 'title' || sub === 'rename') {
    const t = (await readText(args.slice(2))).trim()
    if (!t) { console.error(red(usage)); process.exit(1) }
    body.title = t
  } else if (noun === 'bug' && (sub === 'sev' || sub === 'severity')) {
    if (!args[2]) { console.error(red(usage)); process.exit(1) }
    body.severity = args[2]
  } else { console.error(red(usage)); process.exit(1) }
  const res = await api(`/${lane}/${id}`, { method: 'PATCH', body })
  const row = res.request || res.bug
  if (jsonFlag) return out(row)
  const field = body.severity ? `severity → ${body.severity}`
    : body.title ? 'renamed'
    : `description ${body.description ? 'updated' : 'cleared'}`
  console.log(green(`✓ ${noun} ${field}`))
}

// ── commands ──────────────────────────────────────────────────────────────
const STATUS_ALIAS = { done: 'Done', start: 'In Progress', progress: 'In Progress', block: 'Blocked', blocked: 'Blocked', todo: 'Not Started', reset: 'Not Started' }

const [cmd, ...rest] = process.argv.slice(2)
const jsonFlag = rest.includes('--json')
const args = rest.filter((a) => a !== '--json')

const out = (obj) => console.log(JSON.stringify(obj, null, 2))

const cmds = {
  async login() {
    const key = args[0] || await ask('Paste your hypr key: ')
    if (!key.startsWith('hypr_')) { console.error(red('That does not look like a hypr_ key.')); process.exit(1) }
    saveCfg({ ...cfg, apiUrl: API, key })
    // verify
    const me = await (async () => {
      const res = await fetch(API + '/', { headers: { 'x-hypr-key': key } })
      return res.ok ? res.json() : null
    })()
    if (!me?.me) { console.error(red('Key rejected by the API.')); process.exit(1) }
    console.log(green(`✓ Logged in as ${me.me.full_name || me.me.email}`))
  },
  async logout() { saveCfg({ ...cfg, key: undefined }); console.log('Logged out.') },
  async whoami() { const d = await api('/'); jsonFlag ? out(d.me) : console.log(`${bold(d.me.full_name)}  ${dim(d.me.email)}  ${dim(d.me.role)}`) },

  async projects() {
    const { projects } = await api('/projects')
    if (jsonFlag) return out(projects)
    console.log(bold('\nYour Dev Projects\n'))
    for (const p of projects) console.log(`${bold(p.name)}  ${dim(p.status)}  ${dim(`[${p.role}]`)}\n  ${dim(p.id)}\n`)
  },

  async tasks() {
    const project = await resolveProject(args[0] || '')
    const { tasks } = await api(`/projects/${project.id}/tasks`)
    if (jsonFlag) return out(tasks)
    console.log(`\n${bold(cyan(project.name))} ${dim('· features')}`)
    printGrouped('TASKS', tasks, 'status')
    console.log('')
  },
  async requests() {
    const project = await resolveProject(args[0] || '')
    const { requests } = await api(`/projects/${project.id}/requests`)
    if (jsonFlag) return out(requests)
    console.log(`\n${bold(cyan(project.name))} ${dim('· feature requests')}`)
    printGrouped('REQUESTS', requests, 'status')
    console.log('')
  },
  async bugs() {
    const project = await resolveProject(args[0] || '')
    const { bugs } = await api(`/projects/${project.id}/bugs`)
    if (jsonFlag) return out(bugs)
    console.log(`\n${bold(cyan(project.name))} ${dim('· bugs')}`)
    printGrouped('BUGS', bugs, 'status', (b) => (SEV_COLOR[b.severity] || dim)(`[${b.severity}] `))
    console.log('')
  },

  async task() {
    const id = args[0]
    const sub = args[1]
    if (!id) { console.error(red('Usage: hypr task <id> [done|start|block|claim]')); process.exit(1) }

    if (sub === 'claim') { await api(`/tasks/${id}/claim`, { method: 'POST' }); console.log(green('✓ Claimed')); return }
    if (sub === 'desc' || sub === 'describe' || sub === 'notes') {
      const text = await readText(args.slice(2))
      const { task } = await api(`/tasks/${id}`, { method: 'PATCH', body: { description: text } })
      console.log(green(`✓ ${task.task_id} description ${text ? 'updated' : 'cleared'}`)); return
    }
    if (sub === 'title' || sub === 'rename') {
      const text = (await readText(args.slice(2))).trim()
      if (!text) { console.error(red('Usage: hypr task <id> title "new title"')); process.exit(1) }
      const { task } = await api(`/tasks/${id}`, { method: 'PATCH', body: { title: text } })
      console.log(green(`✓ ${task.task_id} renamed`)); return
    }
    if (sub && STATUS_ALIAS[sub]) {
      const { task } = await api(`/tasks/${id}`, { method: 'PATCH', body: { status: STATUS_ALIAS[sub] } })
      console.log(green(`✓ ${task.task_id} → ${STATUS_ALIAS[sub]}`)); return
    }
    if (sub) { console.error(red(`Unknown action "${sub}". Try: done | start | block | todo | claim | desc | title`)); process.exit(1) }

    const d = await api(`/tasks/${id}`)
    if (jsonFlag) return out(d)
    const t = d.task
    const col = STATUS_COLOR[t.status] || ((s) => s)
    console.log(`\n${bold(t.title)}  ${dim(t.task_id)}`)
    console.log(`  status: ${col(t.status)}   urgency: ${t.urgency}   due: ${t.due_date || '—'}`)
    console.log(`  assignees: ${(d.assignees || []).map((a) => a.profile?.full_name + (a.completed_at ? ' ✓' : '')).join(', ') || '—'}`)
    if (t.notes) console.log(`\n  ${dim('notes:')} ${t.notes.replace(/\n/g, '\n  ')}`)
    console.log(`\n  ${bold('comments')} ${dim(`(${(d.comments || []).length})`)}`)
    for (const cm of d.comments || []) console.log(`    ${dim(cm.author?.full_name + ':')} ${cm.content}`)
    console.log('')
  },

  async comment() {
    const id = args[0]
    const msg = args.slice(1).join(' ')
    if (!id || !msg) { console.error(red('Usage: hypr comment <id> "message"')); process.exit(1) }
    await api(`/tasks/${id}/comments`, { method: 'POST', body: { content: msg } })
    console.log(green('✓ Comment added'))
  },

  // Edit a backlog request/bug. id is the uuid shown in `hypr requests`/`hypr bugs`.
  async request() { await editLaneRow('requests', 'request') },
  async bug() { await editLaneRow('bugs', 'bug') },

  help() {
    console.log(`${bold('hypr')} — work your Dev Projects from the terminal

  ${bold('hypr login')} [key]            store your API key (Settings → API Keys)
  ${bold('hypr whoami')}                 show who you are
  ${bold('hypr projects')}               list your projects
  ${bold('hypr tasks')} <project>        a project's feature tasks, by status
  ${bold('hypr requests')} <project>     feature requests
  ${bold('hypr bugs')} <project>         bugs
  ${bold('hypr task')} <id>              task detail + comments  (id = T-ABC123 or uuid)
  ${bold('hypr task')} <id> done|start|block|todo
  ${bold('hypr task')} <id> claim        self-assign
  ${bold('hypr task')} <id> desc "text"  edit the card description  (desc - reads stdin)
  ${bold('hypr task')} <id> title "text" rename the card
  ${bold('hypr request')} <id> desc|title "text"      edit a feature request  (id = uuid)
  ${bold('hypr bug')} <id> desc|title|sev "text"      edit a bug  (id = uuid)
  ${bold('hypr comment')} <id> "msg"     add a comment
  ${dim('--json')}                       raw JSON output

  <project> matches by name (fuzzy) or id.`)
  },
}

const fn = cmds[cmd] || (cmd ? null : cmds.help)
if (!fn) { console.error(red(`Unknown command "${cmd}". Run: hypr help`)); process.exit(1) }
Promise.resolve(fn()).catch((e) => { console.error(red(String(e?.message || e))); process.exit(1) })
