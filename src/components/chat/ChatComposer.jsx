import { useEffect, useRef, useState } from 'react'
import { Send, X, CornerUpLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui'
import ImageAttachments from './ImageAttachments'
import { useReplyContext } from './ReplyContext'

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

export default function ChatComposer({ conversationId, onSend, onTyping, disabled }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState([])
  const [textareaHeight, setTextareaHeight] = useState(DEFAULT_H)
  const { target: replyTarget, clearReply } = useReplyContext()
  const textareaRef = useRef(null)

  function startResize(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = textareaHeight
    function onMove(ev) {
      // Dragging up grows the textarea — Y decreases as the pointer rises.
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

  // Focus composer whenever a reply target is set, so the user can type
  // immediately after clicking the reply button on a message.
  useEffect(() => {
    if (replyTarget) textareaRef.current?.focus()
  }, [replyTarget])

  async function submit() {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0) || busy || disabled) return
    setBusy(true)
    const uploaded = images.length > 0 ? await uploadImages(conversationId, images) : []
    const ok = await onSend(trimmed, uploaded, replyTarget)
    setBusy(false)
    if (ok) {
      setValue('')
      images.forEach(i => URL.revokeObjectURL(i.preview))
      setImages([])
      clearReply()
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && replyTarget) {
      e.preventDefault()
      clearReply()
    }
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
      {/* Drag handle — grab and pull up to grow the composer. */}
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
      <div className="p-2 pt-0 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => {
            setValue(e.target.value.slice(0, MAX_LEN))
            if (e.target.value.length > 0) onTyping?.()
          }}
          onKeyDown={handleKey}
          onPaste={handlePaste}
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
