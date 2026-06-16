import { PenSquare } from 'lucide-react'
import ContactSearch from './ContactSearch'
import ContactList from './ContactList'

// Left rail of the dedicated chat page (/chat). Thin wrapper around the
// existing ContactSearch + ContactList so the page and the floating widget
// render the exact same conversation list. Task chats are intentionally not
// passed (out of v1 — they're accessed from their task). `selectedId`
// highlights the open conversation.
export default function ChatSidebar({
  query,
  onQueryChange,
  sections,
  groups,
  campfires,
  presence,
  selectedId,
  onOpenContact,
  onOpenConversation,
  onCreateGroup,
}) {
  return (
    <aside className="flex flex-col h-full w-full bg-white dark:bg-dark-surface">
      <div className="px-3 py-3 border-b border-slate-200/70 dark:border-dark-border flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <ContactSearch value={query} onChange={onQueryChange} placeholder="Search conversations & people" />
        </div>
        {onCreateGroup && (
          <button
            type="button"
            onClick={onCreateGroup}
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10"
            aria-label="New group"
            title="New group"
          >
            <PenSquare className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ContactList
          sections={sections}
          groups={groups}
          campfires={campfires}
          tasks={[]}
          presence={presence}
          onOpen={onOpenContact}
          onOpenGroup={onOpenConversation}
          onOpenCampfire={onOpenConversation}
          selectedId={selectedId}
        />
        {/* onCreateGroup intentionally not forwarded to ContactList — the
            header pencil button is the single "new group" affordance here. */}
      </div>
    </aside>
  )
}
