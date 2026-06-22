import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { isCoarsePointer, shouldToggleMessageActions } from '../../../lib/chatTouch'
import {
  Trash2, MessageSquare, SmilePlus, MoreHorizontal,
  Link2, MailMinus, Pencil, Video,
} from 'lucide-react'
import RichContentRenderer from '../../ui/RichContentRenderer'
import { renderChatInlineMarkdown, extractTaskIdFromMessage } from '../../../lib/chatInlineMarkdown'
import { extractMeetUrl } from '../../../lib/meetLink'
import ChatTaskCard from '../ChatTaskCard'
import ReactionPicker from '../ReactionPicker'
import MessageReactions from '../MessageReactions'
import SeenByAvatars from '../SeenByAvatars'
import { useChatPrefs } from '../../../hooks/useChatPrefs'
import { formatChatTime } from '../../../lib/formatTime'

// One-click quick reaction shown directly in the hover toolbar (Slack puts
// a small palette of common emoji here before the full picker).
const QUICK_EMOJI = '👍'

// "Your reaction" highlight — design calls for a stronger brand-indigo fill
// than the classic widget's light tint. Passed through to MessageReactions via
// its optional `mineClassName` override (the component is not forked).
const MINE_REACTION_CLASS =
  'bg-[var(--chat-accent,#4f46e5)] border-[var(--chat-accent,#4f46e5)] text-white'

// Rounded-square avatar (Slack convention — squares, not circles). Comfortable
// = 36px; compact = 28px (Slack Compact still shows a small avatar).
function Avatar({ author, compact }) {
  const name = author?.full_name || author?.email || '?'
  const initial = name.charAt(0).toUpperCase()
  const sizeCls = compact ? 'w-7 h-7' : 'w-9 h-9'
  return author?.avatar_url ? (
    <img
      src={author.avatar_url}
      alt={name}
      title={name}
      className={`${sizeCls} rounded-lg object-cover shrink-0`}
    />
  ) : (
    <div
      title={name}
      className={`${sizeCls} rounded-lg bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 text-sm font-semibold flex items-center justify-center shrink-0`}
    >
      {initial}
    </div>
  )
}

// Quote-reply (reply_to_*) — preserved from DmChatMessage; jumps to the
// original message on click.
function QuotedReply({ message, onJump }) {
  if (!message.reply_to_id) return null
  const author = message.reply_to_author?.full_name || 'Someone'
  const preview = message.reply_to_preview || 'message'
  return (
    <button
      type="button"
      onClick={() => onJump?.(message.reply_to_id)}
      className="text-left max-w-full mb-1 rounded-lg border-l-2 border-slate-300 dark:border-slate-500 bg-slate-50 dark:bg-slate-700/60 pl-2 pr-2 py-1 text-[11px] leading-tight truncate hover:brightness-110 text-slate-600 dark:text-slate-300"
      title={`Reply to ${author}: ${preview}`}
    >
      <span className="block text-[10px] font-semibold opacity-70">↪ Reply to {author}</span>
      <span className="block opacity-80 truncate">{preview}</span>
    </button>
  )
}

/**
 * Slack-style message row. Props mirror DmChatMessage plus `isLead`.
 *
 *   message, isMine, myId          — identity + content
 *   isLead                         — first row of an author/time group (the
 *                                    LIST computes this via isLeadMessage)
 *   reactions, onToggleReaction    — useMessageReactions wiring
 *   reactionProfileLookup          — Map<userId, profile> for reactor tooltips
 *   threadInfo                     — { count, lastReplyAt } from useThreadCounts
 *   onOpenThread(message)          — opens the thread flexpane
 *   onReply(message, targetName)   — quote-reply (requestReply equivalent)
 *   onJumpToReply(messageId)       — scroll to a quoted message
 *   onDelete(messageId)            — soft-delete (own messages only)
 *   onMarkUnread(message)          — optional; menu item hidden if absent
 *   onEdit(message)                — optional; menu item hidden if absent
 *   seenBy                         — group "seen by" readers for THIS message
 *                                    (from computeSeenByMessage; empty/absent
 *                                    for 1:1 and non-terminal group messages)
 */
export default function MessageRow({
  message,
  isMine,
  myId,
  isLead = true,
  reactions,
  onToggleReaction,
  reactionProfileLookup,
  threadInfo,
  onOpenThread,
  onReply,
  onJumpToReply,
  onDelete,
  onMarkUnread,
  onEdit,
  seenBy,
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPos, setPickerPos] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const reactBtnRef = useRef(null)

  // Tap-to-reveal the action toolbar on touch devices (there is no :hover there).
  // Desktop is unaffected: the coarse-pointer guard makes onRowClick a no-op.
  const rowRef = useRef(null)
  const [touchActive, setTouchActive] = useState(false)
  const onRowClick = (e) => {
    const hitInteractive = !!e.target.closest('a, button, img, [role="button"], [data-msg-toolbar]')
    if (!shouldToggleMessageActions({ coarsePointer: isCoarsePointer(), hitInteractive })) return
    setTouchActive(v => !v)
  }
  // While the toolbar is open, a tap anywhere outside this row closes it.
  useEffect(() => {
    if (!touchActive) return
    const onDoc = (e) => { if (rowRef.current && !rowRef.current.contains(e.target)) setTouchActive(false) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [touchActive])
  const PICKER_W = 248

  // Presentational prefs (density + 12h/24h time). Read from the per-profile
  // chat-prefs store keyed by the current user (myId). Defaults reproduce the
  // current look (comfortable / 12h).
  const [prefs] = useChatPrefs(myId)
  const compact = prefs.density === 'compact'
  const timeFormat = prefs.timeFormat
  const fmtTime = (iso) => formatChatTime(iso, timeFormat)

  const togglePicker = useCallback(() => {
    setPickerOpen(open => {
      if (open) return false
      const r = reactBtnRef.current?.getBoundingClientRect()
      if (r) {
        const left = Math.min(Math.max(8, r.left - PICKER_W + r.width), window.innerWidth - PICKER_W - 8)
        setPickerPos({ top: r.bottom + 4, left })
      }
      return true
    })
  }, [])

  const isSystem = message.kind === 'system'
  const isCall = message.kind === 'call'
  const isDeleted = !!message.deleted_at

  // ─── System message variant (copied from DmChatMessage) ───
  if (isSystem) {
    const linkedTaskId = extractTaskIdFromMessage(message.content)
    return (
      <div className="my-2 flex flex-col items-center" data-message-id={message.id}>
        <span className="inline-block px-3 py-1 text-xs rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-center">
          {renderChatInlineMarkdown(message.content)}
        </span>
        {linkedTaskId && <ChatTaskCard taskId={linkedTaskId} />}
      </div>
    )
  }

  // ─── Call message variant (copied from DmChatMessage) ───
  if (isCall) {
    const url = extractMeetUrl(message.content)
    const who = isMine ? 'You' : (message.author?.full_name || 'Someone')
    return (
      <div className="my-2 flex justify-center" data-message-id={message.id}>
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-soft max-w-[90%]">
          <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Video className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{who} started a call</div>
            <div className="text-[11px] text-slate-400">{fmtTime(message.created_at)}</div>
          </div>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium"
            >
              Join
            </a>
          )}
        </div>
      </div>
    )
  }

  const replyTargetName = isMine ? 'yourself' : (message.author?.full_name || 'them')

  // @mention-of-me highlight — mentions are [{ user_id, display_name }].
  const mentionsMe = Array.isArray(message.mentions)
    && message.mentions.some(m => m?.user_id === myId)

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/chat/${message.conversation_id || ''}?message=${message.id}`
    try { navigator.clipboard?.writeText(url) } catch { /* clipboard may be unavailable */ }
    setMenuOpen(false)
  }, [message.conversation_id, message.id])

  return (
    <div
      ref={rowRef}
      onClick={onRowClick}
      className={`group/message relative flex pl-5 pr-10 hover:bg-slate-50 dark:hover:bg-white/5 ${
        compact ? 'py-0.5' : 'py-1'
      } ${mentionsMe ? 'border-l-2 border-amber-400 bg-amber-400/10' : ''}`}
      data-message-id={message.id}
    >
      {/* Reaction picker (portal — pane is overflow-hidden, would clip) */}
      {pickerOpen && pickerPos && createPortal(
        <div className="fixed z-[9999]" style={{ top: pickerPos.top, left: pickerPos.left }}>
          <ReactionPicker
            onPick={(emoji) => onToggleReaction?.(message.id, emoji)}
            onClose={() => setPickerOpen(false)}
          />
        </div>,
        document.body
      )}

      {/* Avatar gutter — avatar on lead rows, hover-only timestamp otherwise */}
      <div className={`${compact ? 'w-7 mr-2' : 'w-9 mr-2'} shrink-0 flex flex-col items-center`}>
        {isLead ? (
          <Avatar author={message.author} compact={compact} />
        ) : (
          <span className={`${touchActive ? 'block' : 'hidden'} group-hover/message:block absolute left-5 text-timestamp text-slate-400 leading-[22px] pt-px`}>
            {fmtTime(message.created_at)}
          </span>
        )}
      </div>

      {/* Body column */}
      <div className="min-w-0 flex-1">
        {isLead && (
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-slate-900 dark:text-white leading-tight">
              {message.author?.full_name || 'Unknown'}
            </span>
            <span className="text-timestamp text-slate-400">{fmtTime(message.created_at)}</span>
          </div>
        )}

        <QuotedReply message={message} onJump={onJumpToReply} />

        <div className="text-[15px] leading-[22px] text-slate-900 dark:text-slate-100 min-w-0 break-words">
          {isDeleted ? (
            <span className="italic text-slate-400">message deleted</span>
          ) : (
            <RichContentRenderer
              content={message.content || ''}
              mentions={message.mentions || []}
              inlineImages={message.inline_images || []}
              imagesBucket="dm-attachments"
              attachments={message.attachments || []}
              attachmentBucket="dm-attachments"
            />
          )}
        </div>

        {/* Reaction pills — your reaction highlighted in brand-indigo */}
        {!isDeleted && (
          <MessageReactions
            reactions={reactions}
            onToggle={(emoji) => onToggleReaction?.(message.id, emoji)}
            profileLookup={reactionProfileLookup}
            myUserId={myId}
            mineClassName={MINE_REACTION_CLASS}
          />
        )}

        {/* Thread footer — reuses useThreadCounts data ({count, lastReplyAt}) */}
        {threadInfo && threadInfo.count > 0 && !isDeleted && (
          <button
            type="button"
            onClick={() => onOpenThread?.(message)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-transparent hover:border-slate-200 dark:hover:border-dark-border hover:bg-white dark:hover:bg-dark-card px-1.5 py-0.5 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5 text-brand-600 dark:text-brand-300" />
            <span className="text-[13px] font-semibold text-brand-600 dark:text-brand-300">
              {threadInfo.count} repl{threadInfo.count === 1 ? 'y' : 'ies'}
            </span>
            {threadInfo.lastReplyAt && (
              <span className="text-timestamp text-slate-400">
                Last reply {fmtTime(threadInfo.lastReplyAt)}
              </span>
            )}
          </button>
        )}

        {/* Group "seen by" avatars — shown under the last message seen by
            others (computeSeenByMessage only populates that row). Mirrors the
            legacy DmChatMessage placement at the end of the body column. */}
        {seenBy && seenBy.length > 0 && (
          <SeenByAvatars readers={seenBy} align="start" />
        )}
      </div>

      {/* Hover toolbar — floats above the row's top-right, never shifts layout.
          Revealed on hover AND keyboard focus-within so tabbing to the toolbar
          buttons surfaces it for keyboard users. */}
      {!isDeleted && (
        <div data-msg-toolbar className={`${touchActive ? 'inline-flex' : 'hidden'} group-hover/message:inline-flex group-focus-within/message:inline-flex absolute -top-3 right-9 z-20 rounded-md border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-card p-0.5`}>
          <button
            type="button"
            onClick={() => onToggleReaction?.(message.id, QUICK_EMOJI)}
            className="w-7 h-7 grid place-items-center rounded text-base hover:bg-slate-100 dark:hover:bg-white/10"
            aria-label={`React ${QUICK_EMOJI}`}
            title={`React ${QUICK_EMOJI}`}
          >
            <span>{QUICK_EMOJI}</span>
          </button>
          <button
            ref={reactBtnRef}
            type="button"
            onClick={togglePicker}
            className="w-7 h-7 grid place-items-center rounded text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-brand-500"
            aria-label="Add reaction"
            title="Add reaction"
          >
            <SmilePlus className="w-4 h-4" />
          </button>
          {onOpenThread && (
            <button
              type="button"
              onClick={() => onOpenThread(message)}
              className="w-7 h-7 grid place-items-center rounded text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-brand-500"
              aria-label="Reply in thread"
              title="Reply in thread"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              className="w-7 h-7 grid place-items-center rounded text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-brand-500"
              aria-label="More actions"
              title="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                {/* outside-click catcher */}
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-44 rounded-md border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated py-1 text-sm">
                  <button
                    type="button"
                    onClick={copyLink}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
                  >
                    <Link2 className="w-3.5 h-3.5" /> Copy link
                  </button>
                  {onReply && (
                    <button
                      type="button"
                      onClick={() => { onReply(message, replyTargetName); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Reply
                    </button>
                  )}
                  {onMarkUnread && (
                    <button
                      type="button"
                      onClick={() => { onMarkUnread(message); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
                    >
                      <MailMinus className="w-3.5 h-3.5" /> Mark unread
                    </button>
                  )}
                  {isMine && onEdit && (
                    <button
                      type="button"
                      onClick={() => { onEdit(message); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                  {isMine && onDelete && (
                    <button
                      type="button"
                      onClick={() => { onDelete(message.id); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
