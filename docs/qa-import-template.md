# QA / backlog import — JSON template

Paste this into a Dev Project's **Import** button (admin-only, top-right of the
project page). It takes a **JSON array** of items; each item is one row.

## Shape

```json
[
  {
    "taskname": "Tenant profile — open & edit",
    "description": "Optional context, steps, or notes. Newlines are fine.",
    "type": "Feature",
    "status": "Done"
  },
  {
    "taskname": "Bulk rent posting throws on empty unit",
    "description": "Steps: open Rent Roll → post with no unit selected.",
    "type": "Bug",
    "status": "Pending"
  },
  {
    "taskname": "Export owner statement to PDF",
    "description": "",
    "type": "Missing Feature",
    "status": "Pending"
  }
]
```

## Fields

| Field | Required | Allowed values | Notes |
|-------|----------|----------------|-------|
| `taskname` | ✅ | any text | The card title. Must be unique within the project — a title that already exists is skipped (safe to re-run). |
| `description` | optional | any text (or `""`) | Body / notes. Empty string is treated as no description. |
| `type` | ✅ | `Bug`, `Feature`, `Missing Feature`, `Enhancement` (anything not `Bug` counts as a feature) | Only matters for **open** items (decides Bug lane vs Feature Requests). Ignored for completed items. |
| `status` | ✅ | `Done` or `Pending` (anything not `Done` is treated as open) | **This is the important one** — see the table below. |

## What each combination becomes

| `status` | `type` | Lands as |
|----------|--------|----------|
| **`Done`** | anything (Bug **or** Feature) | ✅ **A real completed Feature task** — a card in the project's **Done** column, assigned to you. This is the "we already tracked + finished this" case. |
| `Pending` | `Bug` | A lightweight **Bug-lane** row (status *Reported*). |
| `Pending` | `Feature` / `Missing Feature` / `Enhancement` / other | A lightweight **Feature-Request** row (status *Requested*). |

### Why your manual upload looked wrong before

Previously, completed (`status: "Done"`) features imported as **"Promoted" feature
*requests*** — parked placeholder rows with no real task behind them. That's the
"unlikely result" you saw. Now any `status: "Done"` item (feature **or** bug)
imports as a **real Done card on the board**, so completed work shows up where you
expect it.

> The target project must have a column whose status mapping is **Done** (PMAPMS
> does — the "Done" list). If it doesn't, the importer will refuse the completed
> items and tell you.

## Tips

- Re-running is safe: any title already in the project is skipped (no duplicates).
- You can mix completed and open items in one array.
- Completed items are assigned to **you** (the person clicking Import).
- Bugs you've already fixed → set `status: "Done"`; they become Done cards too.
