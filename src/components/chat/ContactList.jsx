import { Plus, Users } from 'lucide-react'
import ContactRow from './ContactRow'
import { groupDisplayName, memberCountLabel } from '../../lib/groupConversations'

function Section({ title, rows, presence, onOpen }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="mb-2">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {rows.map(row => (
        <ContactRow
          key={row.profile.id}
          row={row}
          online={presence.get(row.profile.id)?.online || false}
          onClick={onOpen}
        />
      ))}
    </div>
  )
}

function GroupRow({ conversation, onClick }) {
  const unread = conversation.unread || 0
  const preview = conversation.last_message_preview
  return (
    <button
      type="button"
      onClick={() => onClick(conversation.id)}
      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
    >
      <div className="relative w-9 h-9 flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center">
          <Users className="w-4 h-4" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {groupDisplayName(conversation)}
          </span>
          {unread > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {preview || memberCountLabel(conversation.participants)}
        </div>
      </div>
    </button>
  )
}

function GroupsSection({ groups, onOpenGroup }) {
  if (!groups || groups.length === 0) return null
  return (
    <div className="mb-2">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Groups
      </div>
      {groups.map(g => (
        <GroupRow key={g.id} conversation={g} onClick={onOpenGroup} />
      ))}
    </div>
  )
}

export default function ContactList({
  sections, groups = [], presence, onOpen, onOpenGroup, onCreateGroup,
}) {
  const empty =
    sections.recent.length === 0 &&
    sections.teammates.length === 0 &&
    sections.company.length === 0 &&
    groups.length === 0

  return (
    <div className="py-1">
      {onCreateGroup && (
        <div className="px-3 pt-2 pb-1">
          <button
            type="button"
            onClick={onCreateGroup}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-700 dark:text-brand-200 bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/30 dark:hover:bg-brand-900/50"
          >
            <Plus className="w-4 h-4" />
            New group
          </button>
        </div>
      )}
      {empty ? (
        <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No people to show.
        </div>
      ) : (
        <>
          <GroupsSection groups={groups} onOpenGroup={onOpenGroup} />
          <Section title="Recent"    rows={sections.recent}    presence={presence} onOpen={onOpen} />
          <Section title="Teammates" rows={sections.teammates} presence={presence} onOpen={onOpen} />
          <Section title="Company"   rows={sections.company}   presence={presence} onOpen={onOpen} />
        </>
      )}
    </div>
  )
}
