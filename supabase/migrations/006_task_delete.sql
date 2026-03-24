-- Allow task deletion by role
-- Admins: any task. Managers: own team tasks. Assignee/assigner: own tasks.
create policy "Task delete by role"
  on public.tasks for delete
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or (p.role = 'Manager' and p.team_id = tasks.team_id)
      )
    )
  );
