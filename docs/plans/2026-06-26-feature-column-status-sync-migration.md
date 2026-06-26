# Feature column ↔ status sync — Migration 113

**Status: APPLIED to prod 2026-06-26** (via Supabase Management API query endpoint). This doc is for the record / re-apply.

**What:** when a project task's `status` changes (TaskDetailPanel dropdown, dev-api `PATCH`, CLI — any path), move its board card into the column whose `maps_to_status` = the new status. Closes the gap where direct status changes left the card in its old column (status Done but still in Backlog). Dragging was already two-way via `move_feature` (108) and is unaffected — the early-return preserves the drop position.

A one-time backfill realigned existing mismatches:
```sql
update public.tasks t
   set project_column_id = c.id
  from public.project_columns c
 where c.project_id = t.project_id
   and c.maps_to_status = t.status
   and t.project_id is not null
   and t.project_column_id is distinct from c.id;
```

**Migration SQL** (idempotent — `create or replace` + `drop trigger if exists`):

```sql
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
  select id into target_col
    from public.project_columns
   where project_id = new.project_id
     and maps_to_status = new.status
   order by pos asc
   limit 1;

  if target_col is null then return new; end if;
  if new.project_column_id is not distinct from target_col then
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
```
