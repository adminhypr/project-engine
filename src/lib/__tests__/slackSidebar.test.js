import { describe, it, expect } from 'vitest';
import { buildSidebarSections } from '@/lib/slackSidebar';

// NOTE: input shapes mirror the REAL output of useContactList:
//  - sections.recent/teammates/company entries are { profile, conversation? }
//    (teammates/company often have no conversation yet)
//  - campfires/groups are full conversation rows { id, kind, title, ... }
//  - tasks are conversation rows { id, kind:'task', task_title, title, ... }

it('maps campfires + groups into Channels and 1:1s into Direct messages', () => {
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
  expect(out.directMessages.map(d => d.name)).toContain('Marie Anne');
  expect(out.directMessages.map(d => d.name)).toContain('Mark Rivera');
  expect(out.taskChats.map(t => t.id)).toEqual(['t1']);
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
  const out = buildSidebarSections(input);
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
