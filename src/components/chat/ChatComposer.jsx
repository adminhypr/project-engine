import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, X, CornerUpLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui'
import ImageAttachments from './ImageAttachments'
import { useReplyContext } from './ReplyContext'
import MentionPopover from './MentionPopover'
import { parseMentionQuery, insertMention } from '../../lib/mentions'

const MAX_LEN = 4000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

async function uploadImages(conversationId, items) {
  const uploaded = []
  for (const it of items) {
    const messageUuid = crypto.randomUUID()
    const ext = (it.name.split('.').pop() || 'png').toLowerCase()
    const path = `${conversationId}/${messageUuid}/${messageUuid}.${ext}`
    const { error } = await supabase.storage
      .from('dm-attachments')
      .upload(path, it.file, { contentType: it.type, upsert: false })
    if (error) { showToast('Image upload failed', 'error'); continue }
    uploaded.push({ storage_path: path, name: it.name, size: it.size, type: it.type })
  }
  return uploaded
}

const MIN_H = 40
const DEFAULT_H = 40
const MAX_H = 260
const MAX_MENTION_MATCHES = 6

export default function ChatComposer({ conversationId, onSend, onTyping, disabled, mentionablePeople = [] }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState([])
  const [textareaHeight, setTextareaHeight] = useState(DEFAULT_H)
  // Parsed mention selections accumulated as the user picks them. We store
  // the full set and dedupe by user_id on send, so re-mentioning the same
  // person doesn't double up the row in the DB column.
  const [pickedMentions, setPickedMentions] = useState([])
  const [mentionQuery, setMentionQuery] = useState(null) // { query, startIndex } | null
  const [mentionIdx, setMentionIdx] = useState(0)
  const { target: replyTarget, clearReply } = useReplyContext()
  const textareaRef = useRef(null)

  // Filter + limit candidates whenever the query changes.
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery || !mentionablePeople || mentionablePeople.length === 0) return []
    const q = mentionQuery.query.toLowerCase()
    return mentionablePeople
      .filter(p => (p.full_name || '').toLowerCase().includes(q))
      .slice(0, MAX_MENTION_MATCHES)
  }, [mentionQuery, mentionablePeople])

  // Keep the active index in bounds when the candidate list changes.
  useEffect(() => {
    if (mentionIdx >= mentionCandidates.length) setMentionIdx(0)
  }, [mentionCandidates.length, mentionIdx])

  function refreshMentionQuery(newValue, cursorPos) {
    if (!mentionablePeople || mentionablePeople.length === 0) {
      setMentionQuery(null)
      return
    }
    const { active, query, startIndex } = parseMentionQuery(newValue, cursorPos)
    if (active) setMentionQuery({ query, startIndex })
    else setMentionQuery(null)
  }

  function pickMention(person) {
    const el = textareaRef.current
    if (!el) return
    const cursor = el.selectionStart ?? value.length
    const { newText, newCursorPosition } = insertMention(value, cursor, person.full_name)
    setValue(newText)
    setPickedMentions(prev => {
      if (prev.some(m => m.user_id === person.id && m.display_name === person.full_name)) return prev
      return [...prev, { user_id: person.id, display_name: person.full_name }]
    })
    setMentionQuery(null)
    setMentionIdx(0)
    // Restore focus + caret after the value prop updates.
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition)
    })
  }

  function startResize(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = textareaHeight
    function onMove(ev) {
      const next = Math.min(MAX_H, Math.max(MIN_H, startH + (startY - ev.clientY)))
      setTextareaHeight(next)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useEffect(() => {
    if (replyTarget) textareaRef.current?.focus()
  }, [replyTarget])

  async function submit() {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0) || busy || disabled) return
    setBusy(true)
    const uploaded = images.length > 0 ? await uploadImages(conversationId, images) : []
    // Only forward mentions that still appear in the outgoing text — users
    // may have deleted an inserted @name after picking it.
    const effectiveMentions = pickedMentions.filter(m =>
      trimmed.includes(`@${m.display_name}`)
    )
    const ok = await onSend(trimmed, uploaded, replyTarget, effectiveMentions)
    setBusy(false)
    if (ok) {
      setValue('')
      images.forEach(i => URL.revokeObjectURL(i.preview))
      setImages([])
      setPickedMentions([])
      setMentionQuery(null)
      clearReply()
    }
  }

  function handleKey(e) {
    // Mention popover intercepts arrows + Enter/Tab.
    if (mentionQuery && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx(i => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(mentionCandidates[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && replyTarget) {
      e.preventDefault()
      clearReply()
    }
  }

  function handleChange(e) {
    const next = e.target.value.slice(0, MAX_LEN)
    setValue(next)
    if (next.length > 0) onTyping?.()
    refreshMentionQuery(next, e.target.selectionStart ?? next.length)
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items
    if (!items || items.length === 0) return
    const files = []
    for (const item of items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file) continue
      if (file.size > MAX_IMAGE_BYTES) {
        showToast('Pasted image exceeds 5 MB', 'error')
        continue
      }
      const ext = (file.type.split('/')[1] || 'png').split('+')[0]
      const name = file.name && file.name !== 'image.png'
        ? file.name
        : `pasted-${Date.now()}.${ext}`
      files.push({ file, name, type: file.type, size: file.size })
    }
    if (files.length === 0) return
    e.preventDefault()
    setImages(prev => [
      ...prev,
      ...files.map(f => ({ ...f, preview: URL.createObjectURL(f.file) })),
    ])
  }

  return (
    <div className="border-t border-slate-200 dark:border-dark-border">
      {replyTarget && (
        <div className="flex items-start gap-2 px-3 pt-2 pb-1 border-b border-slate-200/60 dark:border-dark-border/60 bg-slate-50 dark:bg-slate-800/40">
          <CornerUpLeft className="w-3.5 h-3.5 text-brand-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0 text-[11px] leading-tight">
            <div className="font-semibold text-slate-700 dark:text-slate-200">
              Replying to {replyTarget.authorName}
            </div>
            <div className="truncate text-slate-500 dark:text-slate-400">
              {replyTarget.preview}
            </div>
          </div>
          <button
            type="button"
            onClick={clearReply}
            className="text-slate-400 hover:text-slate-600 shrink-0"
            aria-label="Cancel reply"
            title="Cancel reply (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <ImageAttachments
        items={images}
        onAdd={item => setImages(s => [...s, item])}
        onRemove={idx => setImages(s => s.filter((_, i) => i !== idx))}
      />
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setTextareaHeight(DEFAULT_H)}
        className="h-1.5 mx-2 rounded-full bg-transparent hover:bg-slate-200 dark:hover:bg-slate-700 cursor-ns-resize flex items-center justify-center group"
        role="separator"
        aria-label="Resize composer (double-click to reset)"
        title="Drag to resize · double-click to reset"
      >
        <span className="w-8 h-0.5 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-slate-400 dark:group-hover:bg-slate-500" />
      </div>
      <div className="relative p-2 pt-0 flex items-end gap-2">
        {mentionQuery && mentionCandidates.length > 0 && (
          <MentionPopover
            people={mentionCandidates}
            activeIdx={mentionIdx}
            onPick={pickMention}
            onHover={setMentionIdx}
          />
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          onKeyUp={e => refreshMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onClick={e => refreshMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onPaste={handlePaste}
          onBlur={() => setMentionQuery(null)}
          placeholder={replyTarget ? `Reply to ${replyTarget.authorName}…` : 'Type a message…'}
          rows={1}
          style={{ height: textareaHeight }}
          className="flex-1 resize-none rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || disabled || (!value.trim() && images.length === 0)}
          className="w-9 h-9 rounded-full bg-brand-500 hover:bg-brand-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
