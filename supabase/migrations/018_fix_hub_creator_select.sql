-- Fix: hub creator can't read their own hub immediately after INSERT
-- because they aren't in hub_members yet (added in the next step).
-- Allow creators to always see their own hubs.

drop policy if exists "hubs_select" on public.hubs;

create policy "hubs_select" on public.hubs for select using (
  public.is_hub_member(hubs.id)
  or hubs.created_by = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);
