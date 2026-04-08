-- ============================================================
-- Migration 019: Hub module layout order per user
-- Adds a JSONB column to hub_members so each user can store
-- their preferred module order per hub independently.
-- ============================================================

alter table public.hub_members
  add column module_order jsonb;

-- NULL = use app default order.
-- Shape when set:
--   { "left": ["message-board", "check-ins", "schedule", "docs-files"],
--     "sidebar": ["campfire", "whos-here", "activity"] }

comment on column public.hub_members.module_order is
  'Per-user module order for the hub dashboard. Null = default order.';
