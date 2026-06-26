-- ---------------------------------------------
-- 113 - Keep a feature card's board column in sync with its task status
--
-- Dragging a card already syncs both ways (move_feature, mig 108: sets
-- project_column_id AND status when the target column maps_to_status). But
-- changing the STATUS directly — the TaskDetailPanel "Update Task" dropdown, the
-- dev-api PATCH, the CLI — only wrote tasks.status, so the card stayed in its old
-- column (status Done but still sitting in Backlog).
--
-- This BEFORE UPDATE trigger closes the gap: when a project task's status
-- changes, move it into the column whose maps_to_status = the new status (lowest
-- pos wins; appended to the bottom of that column). If no column maps to the new
-- status, the card is left where it is.
--
-- Drag is unaffected: move_feature already sets project_column_id to the mapped
-- column, so the early-return (`already in the target column`) fires and the
-- drop position is preserved — the trigger never clobbers a drag.
-- ---------------------------------------------

create or replace function public.sync_feature_column_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_col uuid;
  new_pos    numeric;
begin
  -- find the canonical column for the new status in this project
  select id into target_col
    from public.project_columns
   where project_id = new.project_id
     and maps_to_status = new.status
   order by pos asc
   limit 1;

  if target_col is null then return new; end if;                      -- no mapped column → leave card
  if new.project_column_id is not distinct from target_col then       -- already there (e.g. a drag) → don't touch pos
    return new;
  end if;

  select coalesce(max(project_pos), 0) + 1000 into new_pos
    from public.tasks
   where project_column_id = target_col;

  new.project_column_id := target_col;
  new.project_pos := new_pos;
  return new;
end;
$$;

drop trigger if exists sync_feature_column_on_status_trg on public.tasks;
create trigger sync_feature_column_on_status_trg
  before update on public.tasks
  for each row
  when (old.status is distinct from new.status and new.project_id is not null)
  execute function public.sync_feature_column_on_status();
