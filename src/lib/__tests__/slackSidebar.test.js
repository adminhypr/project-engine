import { describe, it, expect } from 'vitest';
import { buildSidebarSections, normalizeDm } from '@/lib/slackSidebar';

describe('normalizeDm (exported for starred-DM sourcing from the full list)', () => {
  it('maps a conversation row + other_profile into the sidebar DM shape', () => {
    const conv = { id: 'd9', kind: 'dm', unread: 3 };
    const profile = { id: 'u9', full_name: 'Quiet Star', email: 'q@x.com' };
    const dm = normalizeDm({ profile, conversation: conv });
    expect(dm.id).toBe('d9');
    expect(dm.conversationId).toBe('d9');
    expect(dm.profileId).toBe('u9');
    expect(dm.name).toBe('Quiet Star');
    expect(dm.kind).toBe('dm');
    expect(dm.conversation).toBe(conv);
    expect(dm.profile).toBe(profile);
  });

  it('falls back to email when full_name is missing and tolerates a null profile', () => {
    expect(normalizeDm({ profile: { id: 'u1', email: 'e@x.com' }, conversation: { id: 'd1' } }).name)
      .toBe('e@x.com');
    const empty = normalizeDm({ conversation: { id: 'd2' } });
    expect(empty.profileId).toBe(null);
    expect(empty.conversationId).toBe('d2');
  });
});

// NOTE: input shapes mirror the REAL output of useContactList:
//  - sections.recent/teammates/company entries are { profile, conversation? }
//    (teammates/company often have no conversation yet)
//  - campfires/groups are full conversation rows { id, kind, title, ... }
//  - tasks are conversation rows { id, kind:'task', task_title, title, ... }

it('maps campfires + groups into Channels; default DMs are real conversations only', () => {
  const input = {
    sections: {
      recent: [
        { profile: { id: 'u1', full_name: 'Marie Anne' }, conversation: { id: 'd1', kind: 'dm' } },
      ],
      teammates: [
        { profile: { id: 'u2', full_name: 'Mark Rivera' } }, // no conversation yet
      ],
      company: [],
    },
    groups:    [{ id: 'g1', kind: 'group', title: 'Ops' }],
    campfires: [{ id: 'c1', kind: 'hub', title: 'Systems Dev' }],
    tasks:     [{ id: 't1', kind: 'task', task_title: 'Fix login' }],
  };
  const out = buildSidebarSections(input);
  expect(out.channels.map(c => c.id)).toEqual(['c1', 'g1']);       // campfires first, then groups
  // Default (includeAllPeople omitted/false): only real DMs (recent), no
  // conversation-less teammates/company candidates.
  expect(out.directMessages.map(d => d.name)).toContain('Marie Anne');
  expect(out.directMessages.map(d => d.name)).not.toContain('Mark Rivera');
  expect(out.taskChats.map(t => t.id)).toEqual(['t1']);
});

it('includeAllPeople:true surfaces conversation-less teammates/company', () => {
  const input = {
    sections: {
      recent: [
        { profile: { id: 'u1', full_name: 'Marie Anne' }, conversation: { id: 'd1', kind: 'dm' } },
      ],
      teammates: [
        { profile: { id: 'u2', full_name: 'Mark Rivera' } }, // no conversation yet
      ],
      company: [
        { profile: { id: 'u3', full_name: 'Cleo Vega' } },   // no conversation yet
      ],
    },
    groups: [], campfires: [], tasks: [],
  };
  const out = buildSidebarSections(input, { includeAllPeople: true });
  const names = out.directMessages.map(d => d.name);
  expect(names).toContain('Marie Anne');
  expect(names).toContain('Mark Rivera');
  expect(names).toContain('Cleo Vega');
});

it('default excludes conversation-less people even when recent is empty', () => {
  const input = {
    sections: {
      recent: [],
      teammates: [{ profile: { id: 'u2', full_name: 'Mark Rivera' } }],
      company: [{ profile: { id: 'u3', full_name: 'Cleo Vega' } }],
    },
    groups: [], campfires: [], tasks: [],
  };
  const out = buildSidebarSections(input);
  expect(out.directMessages).toHaveLength(0);
});

it('dedups direct messages that appear in multiple sections', () => {
  const dmRow = { profile: { id: 'u1', full_name: 'Marie Anne' }, conversation: { id: 'd1', kind: 'dm' } };
  const input = {
    sections: { recent: [dmRow], teammates: [], company: [dmRow] },
    groups: [], campfires: [], tasks: [],
  };
  const out = buildSidebarSections(input);
  expect(out.directMessages).toHaveLength(1);
  expect(out.directMessages[0].id).toBe('d1');
});

it('dedups conversation-less profile rows by profile id', () => {
  const profRow = { profile: { id: 'u2', full_name: 'Mark Rivera' } };
  const input = {
    sections: { recent: [], teammates: [profRow], company: [profRow] },
    groups: [], campfires: [], tasks: [],
  };
  // Conversation-less rows only appear with includeAllPeople; verify dedup there.
  const out = buildSidebarSections(input, { includeAllPeople: true });
  expect(out.directMessages).toHaveLength(1);
  expect(out.directMessages[0].profileId).toBe('u2');
});

it('returns empty arrays for missing input safely', () => {
  const out = buildSidebarSections({});
  expect(out.channels).toEqual([]);
  expect(out.directMessages).toEqual([]);
  expect(out.taskChats).toEqual([]);
});

it('handles a completely empty call', () => {
  const out = buildSidebarSections();
  expect(out.channels).toEqual([]);
  expect(out.directMessages).toEqual([]);
  expect(out.taskChats).toEqual([]);
});
