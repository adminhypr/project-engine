-- Hypr Task — 005: Task Icon
-- Adds an optional icon field to tasks for visual categorization

ALTER TABLE tasks ADD COLUMN icon text DEFAULT null;
