# hypr CLI

Work your **Dev Projects** tasks from the terminal — list projects, view/move tasks, comment, claim — scoped to the projects you're a member of.

## Install

```bash
# from a checkout of this repo
cd cli
npm install -g .        # or: npm link

# now `hypr` is on your PATH
hypr help
```

## Authenticate

1. In the app, go to **Settings → API Keys** and **Generate** a key (name it after your machine, e.g. `my-laptop`). Copy it — it's shown only once.
2. Log in:

```bash
hypr login          # paste the key when prompted
#   …or non-interactively:
hypr login hypr_xxxxxxxx
#   …or via env (CI):
export HYPR_API_KEY=hypr_xxxxxxxx
```

Your key is stored at `~/.config/hypr/config.json`. It acts as you, scoped to the projects you belong to. Revoke it anytime from Settings → API Keys.

## Usage

```bash
hypr projects                       # your projects
hypr tasks PMAPMS                   # feature tasks, grouped by status
hypr requests PMAPMS                # feature requests
hypr bugs PMAPMS                    # bugs
hypr task T-AB12C3                  # task detail + comments
hypr task T-AB12C3 start            # set In Progress  (done|start|block|todo)
hypr task T-AB12C3 done             # mark Done
hypr task T-AB12C3 claim            # self-assign
hypr task T-AB12C3 desc "new body"  # edit the card description
hypr task T-AB12C3 desc - < notes.md  # …or read a multi-line body from stdin
hypr task T-AB12C3 title "Rename"   # rename the card
hypr request <uuid> desc "text"     # edit a feature request (desc|title)
hypr bug <uuid> desc "text"         # edit a bug (desc|title|sev)
hypr bug <uuid> sev High            # change bug severity
hypr comment T-AB12C3 "on it"       # add a comment
hypr <cmd> --json                   # raw JSON (pipe to jq)
```

`<project>` matches by name (fuzzy) or id. Task ids accept the human `T-…` form or a uuid. **Requests and bugs are keyed by uuid** — copy it from `hypr requests <project>` / `hypr bugs <project>` (the dim id next to each row). For descriptions, an empty string (`desc ""`) clears the field.

## Config / overrides

- `HYPR_API_KEY` — use this key instead of the stored one.
- `HYPR_API_URL` — point at a different `dev-api` deployment (defaults to production).
