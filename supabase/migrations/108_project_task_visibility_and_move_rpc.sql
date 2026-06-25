-- ─────────────────────────────────────────────
-- 108 · Project members see their features + board-move RPC (Dev Board, 3/3)
--
-- (A) Tasks visibility: project members must see ALL features of their
--     projects (the point of a shared board), even features assigned to
--     people they don't manage. We add EXACTLY ONE branch to the existing
--     tasks SELECT predicate:
--         or (tasks.project_id is not null and is_project_member(project_id))
--     Written INLINE (the policy is recreated in full, copied verbatim from
--     migration 097 plus the one new OR). It is NOT wrapped in a STABLE
--     helper on the SELECT path — migration 083 did that and it broke
--     INSERT...RETURNING (see the 097 header). `is_project_member` is only
--     called as one OR branch here, not as the whole policy, and tasks
--     INSERT...RETURNING returns a row whose project_id is null on creation
--     (features get project_id via a later UPDATE / the board), so the new
--     branch is false on the insert-return path and can't reintroduce 097.
--
-- (B) move_feature(p_task, p_column, p_pos): a SECURITY DEFINER RPC so any
--     PROJECT MEMBER can rearrange the board (set project_column_id +
--     project_pos, and sync tasks.status when the target list maps to one)
--     WITHOUT needing blanket task-UPDATE rights. Single writer for board
--     position.
--
-- Note: "promote a feature request" is done on the FRONTEND (insert the
-- feature task via the existing assignTask flow, then mark the request
-- Promoted) — that reuses task_id generation + task triggers rather than
-- re-implementing them in SQL. No promote RPC here.
-- ─────────────────────────────────────────────

-- ── (A) Recreate tasks_select = 097 predicate + project-member branch ──
drop policy if exists "tasks_select" on public.tasks;

create policy "tasks_select" on public.tasks for select
  using (
    not public.is_external_user(auth.uid())
    and (
      -- Primary assignee.
      tasks.assigned_to = auth.uid()
      -- Assigner.
      or tasks.assigned_by = auth.uid()
      -- Secondary assignee via task_assignees junction.
      or exists (
        select 1 from public.task_assignees ta
         where ta.task_id = tasks.id
           and ta.profile_id = auth.uid()
      )
      -- NEW (108): caller is a member of the task's project → sees every
      -- feature on the board. Recursion-safe (helper bypasses RLS) and
      -- false on INSERT...RETURNING (new tasks have project_id = null).
      or (
        tasks.project_id is not null
        and public.is_project_member(tasks.project_id)
      )
      or exists (
        select 1 from public.profiles p
         where p.id = auth.uid()
           and (
             -- Global Admin.
             p.role = 'Admin'
             -- Manager on the task's team (per-team role, Manager only).
             or exists (
               select 1 from public.profile_teams pt
                where pt.profile_id = auth.uid()
                  and pt.team_id = tasks.team_id
                  and pt.role = 'Manager'
             )
             -- Caller is global Manager/Admin AND the PRIMARY assignee
             -- reports to them.
             or (
               p.role in ('Manager','Admin')
               and exists (
                 select 1 from public.profiles assignee
                  where assignee.id = tasks.assigned_to
                    and assignee.reports_to = auth.uid()
               )
             )
           )
      )
    )
  );

-- ── (B) Board-move RPC ──────────────────────────────────────────
create or replace function public.move_feature(
  p_task   uuid,
  p_column uuid,
  p_pos    double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller         uuid := auth.uid();
  v_project_id   uuid;
  v_col_project  uuid;
  v_maps_status  text;
begin
  if caller is null then
    raise exception 'move_feature: not authenticated' using errcode = '42501';
  end if;

  select project_id into v_project_id from public.tasks where id = p_task;
  if v_project_id is null then
    raise exception 'move_feature: task % is not a project feature' using errcode = '22023';
  end if;

  if not public.is_project_member(v_project_id) then
    raise exception 'move_feature: not a member of this project' using errcode = '42501';
  end if;

  -- Target column must belong to the same project.
  select project_id, maps_to_status
    into v_col_project, v_maps_status
    from public.project_columns where id = p_column;
  if v_col_project is null or v_col_project <> v_project_id then
    raise exception 'move_feature: column does not belong to the task''s project' using errcode = '22023';
  end if;

  if v_maps_status is not null then
    update public.tasks
       set project_column_id = p_column,
           project_pos       = p_pos,
           status            = v_maps_status
     where id = p_task;
  else
    update public.tasks
       set project_column_id = p_column,
           project_pos       = p_pos
     where id = p_task;
  end if;
end;
$$;

revoke all on function public.move_feature(uuid, uuid, double precision) from public;
grant execute on function public.move_feature(uuid, uuid, double precision) to authenticated;
