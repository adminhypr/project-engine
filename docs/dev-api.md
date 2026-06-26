# Hypr Dev API — reference

Programmatic access to **Dev Projects** so a developer (or an agent acting for one) can list and work project tasks, feature-requests, and bugs from outside the app. Backed by the `dev-api` Supabase edge function.

> Feed this doc to a session as context. With a valid key, an agent can drive the whole API via plain `curl` or the `hypr` CLI.

## Base URL
```
https://urdzocyfxgyhqmoqbuvk.supabase.co/functions/v1/dev-api
```

## Authentication
Every request sends a **personal access token** in the `x-hypr-key` header:
```
x-hypr-key: hypr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
- Generate a key in the app: **Settings → API Keys** (shown once; stored hashed).
- The token **acts as the developer who owns it**, and is **scoped to the Dev Projects they are a member of** (`project_members`). It cannot see or touch any other project.
- No Supabase anon key / JWT is required (the function is deployed `--no-verify-jwt`).
- `Authorization: Bearer hypr_…` is also accepted as an alternative to `x-hypr-key`.

## Quick start on a fresh session (no repo, no local setup)
You do **NOT** need this repository, the `.env.local` file, the `cli/` folder, or any Supabase login to use the API. The only things required are:

1. **The base URL** (above) — it's public and fixed.
2. **A `hypr_` key** — generate one in the app at **Settings → API Keys** (any project member can; it's shown once).

That's it. From a clean machine/session, hit the API directly with `curl` — no install, no auth dance:
```bash
KEY=hypr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx          # your key
BASE=https://urdzocyfxgyhqmoqbuvk.supabase.co/functions/v1/dev-api

curl -s -H "x-hypr-key: $KEY" $BASE/                # confirms who the key belongs to
curl -s -H "x-hypr-key: $KEY" $BASE/projects        # your projects
```
If `GET /` returns your name, you're in — jump to **curl examples** below for the rest.

**Feeding this to an agent session:** paste (a) this doc and (b) one `hypr_` key. The agent then has everything it needs to operate the board with `curl` — no repo checkout, no service-role key, no environment files. The key alone is the credential, and it's scoped to your project memberships. (Prefer a throwaway key you revoke afterward, since it ends up in the session transcript.)

The `hypr` CLI is just a convenience wrapper over these same calls — optional, and only needed if you want the nicer command UX (see the bottom of this doc).

## Permission model
**Project membership.** If you're a member of a task's project, you can read it and work it (status, comments, claim). This is intentionally broader than the in-app per-task RLS (assignee/manager) and narrower than admin — it is exactly "the projects you're working on."

## Identifiers
- **Project**: a UUID. (The CLI also resolves by fuzzy name; the raw API takes the UUID.)
- **Task**: accepts **either** a UUID **or** the human task id like `T-AB12C3` (globally unique).

## Endpoints

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/` | — | `{ ok, me:{id,full_name,email,role}, endpoints[] }` — who the key belongs to |
| GET | `/projects` | — | `{ projects:[{id,name,status,target_date,role}] }` — your projects |
| GET | `/projects/:id/tasks` | — | `{ tasks:[{id,task_id,title,status,urgency,due_date,assigned_to,project_column_id,project_pos}] }` |
| **POST** | `/projects/:id/tasks` | `{title*, notes?, urgency?, due_date?, status?, column_id?, assignee_id?}` | `{ task:{id,task_id,title,status} }` (201) — creates a **Feature card** |
| GET | `/projects/:id/requests` | — | `{ requests:[{id,title,status,description}] }` |
| **POST** | `/projects/:id/requests` | `{title*, description?}` | `{ request:{id,title,status,description} }` (201) |
| GET | `/projects/:id/bugs` | — | `{ bugs:[{id,title,status,severity,description}] }` |
| **POST** | `/projects/:id/bugs` | `{title*, description?, severity?}` | `{ bug:{id,title,status,severity,description} }` (201) |
| GET | `/tasks/:id` | — | `{ task, assignees:[{profile_id,is_primary,completed_at,profile:{full_name}}], comments:[{id,content,created_at,author:{full_name}}] }` |
| PATCH | `/tasks/:id` | `{status?,urgency?,due_date?}` | `{ task:{id,task_id,title,status} }` |
| **POST** | `/tasks/:id/subtasks` | `{title*, notes?, urgency?, due_date?, assignee_id?}` | `{ subtask:{id,task_id,title,status} }` (201) — single-level child |
| GET | `/tasks/:id/comments` | — | `{ comments:[…] }` |
| POST | `/tasks/:id/comments` | `{content}` | `{ comment:{id,content,created_at} }` (201) |
| POST | `/tasks/:id/claim` | — | `{ ok, claimed }` or `{ ok, already }` — self-assign |
| POST | `/tasks/:id/archive` | — | `{ ok, archived }` — **personal** archive (hides from your lists; non-destructive) |
| POST | `/tasks/:id/unarchive` | — | `{ ok, unarchived }` — undo a personal archive |
| POST | `/conversations/:id/messages` | `{content*}` | `{ message:{id,created_at} }` (201) — post a chat / Campfire message |
| ~~DELETE~~ | *(any path)* | — | **`405` — not supported.** This API can archive, never hard-delete. |

`*` = required. Unknown body keys are ignored.

> **No delete by design.** There is no endpoint that destroys a task, request, or bug — any `DELETE` request is rejected with `405`. To get something off your board, **archive** it (`POST /tasks/:id/archive`). Archive is a *personal view* hide: it removes the task from **your** lists only; collaborators still see it, and the row is never deleted (unarchive restores it). Requests/bugs aren't archivable — close them in-app with a terminal status (`Rejected` / `Won't Fix`).

**Create-endpoint behaviour**
- **`POST /projects/:id/tasks`** — creates a real Feature task (a board card).
  - **Column:** explicit `column_id` wins; otherwise the column whose status mapping matches `status`; otherwise the project's *Not Started* (Backlog) column; otherwise the first column.
  - **`status`** defaults to `Not Started` (or, if you pass a `column_id`, the column's mapped status). Passing `status:"Done"` creates a completed card already marked done.
  - **`assignee_id`** defaults to **you** (the key owner). If provided, it must be a member of the project.
- **`POST /tasks/:id/subtasks`** — adds a child task under an existing feature. Single-level only (you can't subtask a subtask → `400`). Subtasks don't appear as their own board card; they live under the parent.
- All created rows are owned by you (`requester_id` / `reporter_id` / `assigned_by`).

## Posting to chat / Campfire
`POST /conversations/:id/messages` posts a message **as you** (the key owner) into a conversation you belong to — a hub **Campfire**, a group, or a DM.

- **Conversation id** = the UUID in the app URL: `…/chat/<conversation-id>`.
- **Membership-gated.** Campfires (`kind=hub`) require you to be a member of that hub; groups/DMs require you to be a participant. Otherwise `403`.
- **Formatting.** `content` supports the app's markdown subset, so updates render nicely:
  - `**bold**`, `*italic*`, `~~strike~~`, `` `inline code` ``
  - `[label](https://url)` links + bare URLs (auto-linked)
  - `- ` / `* ` bullet lists, `1. ` numbered lists
  - `> ` blockquotes, fenced ``` code blocks
  - `@mentions` (chips) and emoji 🎉
  - Newlines are preserved. **Note:** `#` headings are *not* supported — use `**bold**` for headers.

```bash
CID=63c82e17-d07f-4234-a920-f37fc365c590     # from the /chat/<id> URL
curl -s $H -X POST $BASE/conversations/$CID/messages \
  -H content-type:application/json \
  -d '{"content":"**Deploy done** ✅\n- API live\n- `dev-api` updated"}'
```

**Enums**
- Task `status`: `Not Started` · `In Progress` · `Blocked` · `Done`
- Task `urgency`: `Low` · `Med` · `High` · `Urgent` (default `Med`)
- Request `status`: `Requested` · `Under Review` · `Planned` · `Rejected` · `Promoted` (created as `Requested`)
- Bug `status`: `Reported` · `Confirmed` · `Won't Fix` · `Promoted` (created as `Reported`); `severity`: `Critical` · `High` · `Medium` · `Low` (default `Medium`)

## Errors
JSON `{ "error": "…" }` with status: `401` invalid/missing/revoked key · `403` not a member of the project · `404` unknown task/route · `400` bad input.

## curl examples
```bash
KEY=hypr_xxxx
BASE=https://urdzocyfxgyhqmoqbuvk.supabase.co/functions/v1/dev-api
H="-H x-hypr-key:$KEY"

curl -s $H $BASE/                                   # whoami
curl -s $H $BASE/projects                           # my projects
PID=7202d183-b94d-46bd-a745-769264235883
curl -s $H $BASE/projects/$PID/tasks                # feature tasks
curl -s $H $BASE/projects/$PID/bugs                 # bugs
curl -s $H $BASE/tasks/T-AB12C3                      # task detail + comments

# create a feature (defaults to Backlog / Not Started, assigned to you)
curl -s $H -X POST $BASE/projects/$PID/tasks \
  -H content-type:application/json \
  -d '{"title":"Wire up CSV export","notes":"papaparse","urgency":"High"}'

# create an already-done feature (lands in the Done column)
curl -s $H -X POST $BASE/projects/$PID/tasks \
  -H content-type:application/json -d '{"title":"Tenant profile edit","status":"Done"}'

# create a feature request / a bug
curl -s $H -X POST $BASE/projects/$PID/requests \
  -H content-type:application/json -d '{"title":"Bulk archive","description":"select-all → archive"}'
curl -s $H -X POST $BASE/projects/$PID/bugs \
  -H content-type:application/json -d '{"title":"Login 500","description":"empty password","severity":"High"}'

# add a subtask under a feature
curl -s $H -X POST $BASE/tasks/T-AB12C3/subtasks \
  -H content-type:application/json -d '{"title":"Write the migration"}'

# move a task to In Progress
curl -s $H -X PATCH $BASE/tasks/T-AB12C3 \
  -H content-type:application/json -d '{"status":"In Progress"}'

# comment
curl -s $H -X POST $BASE/tasks/T-AB12C3/comments \
  -H content-type:application/json -d '{"content":"on it"}'

# self-assign
curl -s $H -X POST $BASE/tasks/T-AB12C3/claim
```

## `hypr` CLI (wraps this API)
Install from `cli/` (`npm i -g .`), then `hypr login` with your key. Commands:
```
hypr projects
hypr tasks <project>            # by name (fuzzy) or id
hypr requests <project>
hypr bugs <project>
hypr task <id>                  # detail + comments
hypr task <id> done|start|block|todo
hypr task <id> claim
hypr comment <id> "message"
hypr <cmd> --json               # raw JSON
```
Config in `~/.config/hypr/config.json`; override with `HYPR_API_KEY` / `HYPR_API_URL`.

## What the API does NOT do
Scoped to project work only. You can create and work **tasks / requests / bugs / subtasks** inside your projects, and **post messages** to chats/Campfires you belong to, but it **cannot**: **delete anything** (archive only — see above), read message history / DMs, create/delete projects, manage members, manage users/teams/roles, or touch projects/conversations you're not a member of. There is no admin surface here by design.

> The `hypr` CLI wrapper doesn't expose the create endpoints yet — use `curl` (above) for creates for now; read/update/comment/claim are wired in the CLI.
