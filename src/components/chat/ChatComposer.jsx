import { useState } from 'react'
import { Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui'
import ImageAttachments from './ImageAttachments'

const MAX_LEN = 4000

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

export default function ChatComposer({ conversationId, onSend, disabled }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState([])

  async function submit() {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0) || busy || disabled) return
    setBusy(true)
    const uploaded = images.length > 0 ? await uploadImages(conversationId, images) : []
    const ok = await onSend(trimmed, uploaded)
    setBusy(false)
    if (ok) {
      setValue('')
      images.forEach(i => URL.revokeObjectURL(i.preview))
      setImages([])
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-slate-200 dark:border-dark-border">
      <ImageAttachments
        items={images}
        onAdd={item => setImages(s => [...s, item])}
        onRemove={idx => setImages(s => s.filter((_, i) => i !== idx))}
      />
      <div className="p-2 pt-0 flex items-end gap-2">
        <textarea
          value={value}
          onChange={e => setValue(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={handleKey}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 max-h-32"
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
