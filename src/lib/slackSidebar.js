// Pure mapping from useContactList's output into Slack's sidebar taxonomy:
// Channels (campfires before groups), Direct messages (flattened + deduped),
// and Task chats. No React / Supabase — safe to unit test and reuse.
//
// Real input shapes (see src/hooks/useContactList.js + src/lib/dmContacts.js):
//   sections.recent/teammates/company: [{ profile, conversation? }]
//     - `recent` rows always carry a `conversation` (an open DM)
//     - `teammates` / `company` rows often have NO conversation yet
//   campfires / groups: full conversation rows { id, kind:'hub'|'group', title, ... }
//   tasks:              conversation rows { id, kind:'task', task_title, title, ... }

function normalizeDm(row) {
  const profile = row?.profile || {};
  const conversation = row?.conversation || null;
  // Conversation key when an open DM exists, else fall back to the profile id
  // so we can still dedup the "start a DM" rows from teammates/company.
  const conversationId = conversation?.id || conversation?.conversation_id || null;
  return {
    // `id` is the conversation id when one exists (what the pane needs to open),
    // otherwise null — the caller opens via profileId in that case.
    id: conversationId,
    conversationId,
    profileId: profile.id || null,
    name: profile.full_name || profile.email || '',
    kind: 'dm',
    profile,
    conversation,
  };
}

export function buildSidebarSections(input = {}) {
  const { sections = {}, groups = [], campfires = [], tasks = [] } = input || {};
  const dmRaw = [
    ...(sections.recent || []),
    ...(sections.teammates || []),
    ...(sections.company || []),
  ];
  const seen = new Set();
  const directMessages = [];
  for (const row of dmRaw) {
    const dm = normalizeDm(row);
    // Prefer the conversation id as the dedup key; fall back to profile id for
    // conversation-less teammate/company rows.
    const key = dm.conversationId || dm.profileId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    directMessages.push(dm);
  }
  return {
    channels: [...(campfires || []), ...(groups || [])],
    directMessages,
    taskChats: tasks || [],
  };
}
