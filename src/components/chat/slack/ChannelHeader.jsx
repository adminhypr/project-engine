import { useNavigate } from 'react-router-dom'
import {
  Hash, ChevronDown, Users, Search, Video, Loader2,
  ClipboardList, CheckSquare, ArrowUpRight, Maximize2, Minimize2,
  Minus, X, Image as ImageIcon,
} from 'lucide-react'
import PresenceDot from '../PresenceDot'
import { groupDisplayName, memberCountLabel } from '../../../lib/groupConversations'

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// Small colored dot matching task urgency; mirrors ConversationHeader's
// UrgencyDot so task chats keep the same leading affordance.
function UrgencyDot({ urgency }) {
  const color =
    urgency === 'High' ? 'bg-red-500'
    : urgency === 'Med' ? 'bg-orange-500'
    : urgency === 'Low' ? 'bg-emerald-500'
    : 'bg-slate-300'
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`}
      title={urgency ? `${urgency} urgency` : undefined}
      aria-hidden="true"
    />
  )
}

// Up to 3 overlapping member avatars + total count, opening the members modal
// (same trigger as ConversationHeader's Users button). Channels/groups only.
function MemberStack({ participants, onClick }) {
  const list = Array.isArray(participants) ? participants : []
  const shown = list.slice(0, 3)
  const count = list.length
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-md border border-slate-200 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-white/5"
      title="Members"
      aria-label="Members"
    >
      <span className="flex -space-x-1.5">
        {shown.map((p, i) => (
          p?.avatar_url ? (
            <img
              key={p.id || i}
              src={p.avatar_url}
              alt=""
              className="w-5 h-5 rounded object-cover ring-1 ring-white dark:ring-dark-card"
            />
          ) : (
            <span
              key={p?.id || i}
              className="w-5 h-5 rounded bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 text-[10px] font-semibold grid place-items-center ring-1 ring-white dark:ring-dark-card"
            >
              {(p?.full_name || p?.email || '?').charAt(0).toUpperCase()}
            </span>
          )
        ))}
        {count === 0 && <Users className="w-4 h-4 text-slate-400" />}
      </span>
      {count > 0 && (
        <span className="text-[13px] text-slate-600 dark:text-slate-300 font-medium tabular-nums">{count}</span>
      )}
    </button>
  )
}

/**
 * Slack-style conversation header for the full-page chat pane.
 *
 * Drop-in for ConversationHeader (Task 2.4): accepts the same props so the
 * SlackMessagePane can pass exactly what ConversationPane passes today. Extra
 * optional props are noted inline.
 */
export default function ChannelHeader({
  conversation, otherProfile, online, status,
  onAssignTask, canAssignTask,
  onAddTodo, canAddTodo,
  onStartCall, callStarting,
  onSetWallpaper,
  onOpenMembers,
  // Widget-shell controls — optional. On the full page these are usually
  // undefined (no minimize/maximize/close chrome), so each renders only when
  // a handler is supplied, exactly like ConversationHeader.
  isMaximized, onToggleMaximize, onMinimize, onClose,
  // NEW optional prop (note for Task 2.4): a no-op-friendly hook for the
  // in-channel search affordance. The chat stack has no per-conversation
  // search yet, so when omitted the button is a visible-but-disabled stub
  // (see TODO below). Wire it once a search surface exists.
  onSearchInChannel,
  // Tab row (Messages | Files | Links). Additive: when activeTab/onTabChange
  // are omitted (e.g. the floating widget) the row still renders Messages-only
  // styling and clicking is a no-op, preserving the legacy single-tab look.
  activeTab = 'messages',
  onTabChange,
  fileCount,
  linkCount,
}) {
  const navigate = useNavigate()
  const isGroup = conversation?.kind === 'group' || conversation?.kind === 'hub'
  const isTask = conversation?.kind === 'task'
  const isDm = !isGroup && !isTask

  // --- Title / icon derivation (copied from ConversationHeader) ---
  const name = isTask
    ? truncate(conversation.task_title || conversation.title || 'Task', 48)
    : isGroup
      ? groupDisplayName(conversation)
      : (otherProfile?.full_name || otherProfile?.email || 'Unknown')

  // Topic slot: the data model has no topic column yet (Future/DB work), so we
  // surface member count (groups/channels) / presence (DMs) instead of
  // inventing a topic. Tasks show their status.
  // DM presence label reflects the peer's effective status. Fall back to the
  // legacy online boolean when status isn't supplied.
  const dmStatus = status || (online ? 'active' : 'offline')
  const dmStatusLabel = dmStatus === 'active' ? 'Active' : dmStatus === 'away' ? 'Away' : 'Offline'
  const topic = isTask
    ? (conversation.task_status || 'Task chat')
    : isGroup
      ? memberCountLabel(conversation?.participants)
      : dmStatusLabel

  const handleOpenTask = () => {
    if (!isTask || !conversation?.task_id) return
    const taskId = conversation.task_id
    window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId } }))
    navigate(`/my-tasks?task=${taskId}`)
    onClose?.(conversation.id)
  }

  return (
    <header className="flex flex-col bg-white dark:bg-dark-card border-b border-slate-200 dark:border-dark-border">
      <div className="h-[50px] px-4 flex items-center gap-2">
        {/* Leading icon + name + caret → opens members/details */}
        <button
          type="button"
          onClick={onOpenMembers}
          disabled={!onOpenMembers}
          className="flex items-center gap-1.5 min-w-0 group/title disabled:cursor-default rounded-md -ml-1 pl-1 pr-1.5 py-0.5 enabled:hover:bg-slate-50 dark:enabled:hover:bg-white/5"
          title={onOpenMembers ? 'Open details' : undefined}
        >
          <span className="flex items-center shrink-0 text-slate-500 dark:text-slate-400">
            {isTask ? (
              <UrgencyDot urgency={conversation.task_urgency} />
            ) : isDm ? (
              otherProfile?.avatar_url ? (
                <span className="relative">
                  <img src={otherProfile.avatar_url} alt="" className="w-6 h-6 rounded object-cover" />
                  <PresenceDot online={online} status={status} className="absolute -bottom-0.5 -right-0.5 !w-2.5 !h-2.5" />
                </span>
              ) : (
                <PresenceDot online={online} status={status} />
              )
            ) : (
              <Hash className="w-[18px] h-[18px]" strokeWidth={2.5} />
            )}
          </span>
          <span className="text-channel-hdr font-bold text-slate-900 dark:text-white truncate">{name}</span>
          {onOpenMembers && (
            <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
          )}
        </button>

        {/* Topic slot (muted, to the right of the name). Render only when present. */}
        {topic && (
          <span className="hidden sm:block text-[13px] text-slate-500 dark:text-slate-400 truncate border-l border-slate-200 dark:border-dark-border pl-3">
            {topic}
          </span>
        )}

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-1.5">
          {isTask && conversation.task_id && (
            <button
              type="button"
              onClick={handleOpenTask}
              className="flex items-center gap-1 px-2 py-1 text-[13px] font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-900/50"
              title="Open task"
            >
              Open task
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          )}
          {canAssignTask && (
            <button
              type="button"
              onClick={onAssignTask}
              className="flex items-center gap-1 px-2 py-1 text-[13px] font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-900/50"
              title="Assign task"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Assign task</span>
            </button>
          )}
          {canAddTodo && (
            <button
              type="button"
              onClick={onAddTodo}
              className="flex items-center gap-1 px-2 py-1 text-[13px] font-medium rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:hover:bg-brand-900/50"
              title="Add to-do"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Add to-do</span>
            </button>
          )}

          {/* Member avatar stack + count — groups/channels, opens members modal */}
          {isGroup && onOpenMembers && (
            <MemberStack participants={conversation?.participants} onClick={onOpenMembers} />
          )}

          {/* Search-in-channel — STUB. No per-conversation search surface exists
              yet; render a disabled button when no handler is wired so it reads
              as "coming soon" rather than silently doing nothing.
              TODO(chat-search): wire onSearchInChannel once a search UI lands. */}
          <button
            type="button"
            onClick={onSearchInChannel}
            disabled={!onSearchInChannel}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5 dark:hover:text-slate-200 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
            aria-label="Search in conversation"
            title="Search in conversation"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Set wallpaper — shared per-conversation background. Any participant
              can change it (migration 107); shown whenever a handler is wired. */}
          {onSetWallpaper && (
            <button
              type="button"
              onClick={onSetWallpaper}
              className="p-1.5 rounded-md text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="Set chat wallpaper"
              title="Set chat wallpaper"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
          )}

          {/* Call / huddle button — gated identically to ConversationHeader:
              the parent only passes onStartCall when VITE_CALLS_ENABLED is on. */}
          {onStartCall && (
            <button
              type="button"
              onClick={onStartCall}
              disabled={callStarting}
              className="p-1.5 rounded-md text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-wait"
              aria-label="Start video call"
              title="Start a video call"
            >
              {callStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
            </button>
          )}

          {/* Widget-shell chrome (only when handlers provided) */}
          {onToggleMaximize && (
            <button
              type="button"
              onClick={onToggleMaximize}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label={isMaximized ? 'Restore size' : 'Expand'}
              title={isMaximized ? 'Restore size' : 'Expand'}
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="Minimize"
            >
              <Minus className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tab row: Messages | Files | Links. Files/Links panels are auto-
          collected from the conversation (inline images, attachments, links). */}
      <div className="px-4 flex items-center gap-4 -mt-px">
        {[
          { key: 'messages', label: 'Messages', count: undefined },
          { key: 'files', label: 'Files', count: fileCount },
          { key: 'links', label: 'Links', count: linkCount },
        ].map(t => {
          const active = activeTab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange?.(t.key)}
              className={
                active
                  ? 'py-1.5 text-[13px] font-bold text-slate-900 dark:text-white border-b-2 border-slate-900 dark:border-white'
                  : 'py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-400 border-b-2 border-transparent hover:text-slate-700 dark:hover:text-slate-200'
              }
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className="ml-1 text-slate-400 tabular-nums">{t.count}</span>
              )}
            </button>
          )
        })}
      </div>
    </header>
  )
}
