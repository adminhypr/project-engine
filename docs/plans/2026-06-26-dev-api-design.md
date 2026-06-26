# Dev API + `hypr` CLI — design

**Goal:** let developers connect to the Dev Projects they're members of and work the project's tasks (features), feature-requests, and bugs directly from the terminal.

## Decisions (2026-06-26)
- **Write surface:** read + write — list/view + update task status, add comments, mark done, claim (self-assign).
- **CLI:** standalone installable `hypr` (its own package, stores the key in `~/.config/hypr/config.json` or `HYPR_API_KEY`).
- **Key issuance:** self-serve "API Keys" section in Settings.

## Permission model
**API permission = project membership.** A dev can read & work any task/request/bug in a project they belong to (`project_members`). This is intentionally simpler than the full app RLS (assignee/manager/etc.) and exactly matches "connect to the projects you're working on." The edge function enforces it explicitly with the service role — every project-scoped call first checks `is_project_member(devProfile, projectId)`.

Rationale for service-role + explicit gating over per-user JWT minting: avoids the JWT-secret dependency, and avoids the fact that the app's `tasks`/`comments` write RLS does **not** grant project-members write access (it's assignee/assigner/manager-based) — minting a user JWT would block the very writes we want to allow.

## Components

### 1. `api_keys` table (migration 112)
```
id uuid pk, profile_id uuid fk profiles, name text,
key_prefix text,            -- "hypr_a1b2c3" shown in the UI list
key_hash text,              -- sha256(hex) of the full key; plaintext never stored
last_used_at timestamptz, created_at timestamptz, revoked_at timestamptz
```
- Plaintext key generated **client-side** (`hypr_` + 32 hex), sha256'd client-side (Web Crypto); only the hash + prefix are stored. Shown once.
- RLS: a user manages only their own keys (`profile_id = auth.uid()`). The edge function reads by `key_hash` via the service role (bypasses RLS).

### 2. `dev-api` edge function (Deno, deploy `--no-verify-jwt`)
Gateway. `Authorization: Bearer hypr_…` → sha256 → look up `api_keys` (not revoked) → resolve profile → bump `last_used_at`. Then route (path after `/functions/v1/dev-api`):

| Method + path | Action | Gate |
|---|---|---|
| `GET /projects` | projects the dev is a member of | membership list |
| `GET /projects/:id/tasks\|requests\|bugs` | the project's items | member of :id |
| `GET /tasks/:id` | one task (+ assignees, recent comments) | member of task's project |
| `PATCH /tasks/:id` | `{status,urgency,due_date}` | member of task's project |
| `POST /tasks/:id/comments` | `{content}` | member of task's project |
| `POST /tasks/:id/claim` | self-assign (insert task_assignees) | member of task's project |
| `GET /tasks/:id/comments` | list comments | member of task's project |

- Writes use the service role; task status changes fire the same triggers as the app (audit, completion). Comments insert `mentioned_ids: []`.
- `claim` inserts into `task_assignees` (service role bypasses the 100-C3 INSERT policy) — allowed because we've gated on project membership.
- Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. No webhook secret (auth is the API key).

### 3. Settings → API Keys UI
`useApiKeys` hook + a card in Settings. Generate (name → show full key once in a copy box) / list (prefix, last used, created) / revoke. Generation: Web Crypto random + sha256, insert `{name, key_prefix, key_hash}` (RLS insert check `profile_id = auth.uid()`).

### 4. `hypr` CLI (standalone, `cli/` package)
`bin: hypr`. Config in `~/.config/hypr/config.json` (or `HYPR_API_KEY` / `HYPR_API_URL`). Default API URL = the deployed `dev-api`. Commands:
```
hypr login                       # paste key, store it
hypr projects                    # list my projects
hypr tasks <project>             # features grouped by status
hypr bugs <project> | requests   # other lanes
hypr task <id>                   # task detail + comments
hypr task <id> done|start|block  # set status
hypr task <id> claim             # self-assign
hypr comment <id> "message"      # add a comment
hypr --json …                    # raw output
```

## Phases
1. **DB** — migration 112 (`api_keys`) + paste-ready md. *(David applies.)*
2. **Settings UI** — `useApiKeys` + API Keys card (generate/copy-once/revoke).
3. **Edge function** — `dev-api` read + write, membership-gated. *(David deploys `--no-verify-jwt`; set service-role env.)*
4. **CLI** — `cli/` package, end-to-end against the deployed function.

Each phase ships independently; the CLI only works once 1 + 3 are live. Frontend (2) ships without 3.
