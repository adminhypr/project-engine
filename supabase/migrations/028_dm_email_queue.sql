create table if not exists public.pending_dm_emails (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.dm_messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  enqueued_at     timestamptz not null default now(),
  sent_at         timestamptz,
  skipped_reason  text
);
create index if not exists pending_dm_emails_pending_idx
  on public.pending_dm_emails(enqueued_at)
  where sent_at is null and skipped_reason is null;

create table if not exists public.dm_email_log (
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sent_at         timestamptz not null default now(),
  primary key (recipient_id, conversation_id, sent_at)
);
create index if not exists dm_email_log_recipient_conv_idx
  on public.dm_email_log(recipient_id, conversation_id, sent_at desc);

-- Trigger: on dm_messages INSERT, enqueue one row per other participant
create or replace function public.enqueue_dm_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'user' then return new; end if;
  insert into public.pending_dm_emails (message_id, conversation_id, recipient_id)
    select new.id, new.conversation_id, cp.user_id
    from public.conversation_participants cp
    where cp.conversation_id = new.conversation_id
      and cp.user_id <> new.author_id
      and cp.muted = false;
  return new;
end;
$$;

drop trigger if exists dm_messages_enqueue_email on public.dm_messages;
create trigger dm_messages_enqueue_email
  after insert on public.dm_messages
  for each row execute function public.enqueue_dm_email();
