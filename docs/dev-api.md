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
| GET | `/projects/:id/requests` | — | `{ requests:[{id,title,status,description}] }` |
| GET | `/projects/:id/bugs` | — | `{ bugs:[{id,title,status,severity,description}] }` |
| GET | `/tasks/:id` | — | `{ task, assignees:[{profile_id,is_primary,completed_at,profile:{full_name}}], comments:[{id,content,created_at,author:{full_name}}] }` |
| PATCH | `/tasks/:id` | `{status?,urgency?,due_date?}` | `{ task:{id,task_id,title,status} }` |
| GET | `/tasks/:id/comments` | — | `{ comments:[…] }` |
| POST | `/tasks/:id/comments` | `{content}` | `{ comment:{id,content,created_at} }` (201) |
| POST | `/tasks/:id/claim` | — | `{ ok, claimed }` or `{ ok, already }` — self-assign |

**Enums**
- Task `status`: `Not Started` · `In Progress` · `Blocked` · `Done`
- Task `urgency`: `Low` · `Med` · `High` (`Urgent` allowed on some tasks)
- Request `status`: `Requested` · `Under Review` · `Planned` · `Rejected` · `Promoted`
- Bug `status`: `Reported` · `Confirmed` · `Won't Fix` · `Promoted`; `severity`: `Critical` · `High` · `Medium` · `Low`

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
Scoped to project work only. It cannot: create/delete projects, manage members, manage users/teams/roles, access Chat/Hubs/DMs, or touch projects you're not a member of. There is no admin surface here by design.
