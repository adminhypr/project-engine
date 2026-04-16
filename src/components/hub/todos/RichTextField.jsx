import { useRef } from 'react'
import RichInput from '../../ui/RichInput'
import { useHubTodoAttachments } from '../../../hooks/useHubTodoAttachments'
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Paperclip, X, FileText } from 'lucide-react'

// Markdown-style surround/prefix transform on the current selection.
function applyWrap(textarea, before, after = before) {
  if (!textarea) return
  const { selectionStart: s, selectionEnd: e, value } = textarea
  const sel = value.slice(s, e)
  const next = value.slice(0, s) + before + sel + after + value.slice(e)
  textarea.value = next
  textarea.focus()
  textarea.selectionStart = s + before.length
  textarea.selectionEnd = e + before.length
  const event = new Event('input', { bubbles: true })
  textarea.dispatchEvent(event)
}

function applyLinePrefix(textarea, prefix) {
  if (!textarea) return
  const { selectionStart: s, value } = textarea
  const before = value.slice(0, s)
  const lineStart = before.lastIndexOf('\n') + 1
  const next = value.slice(0, lineStart) + prefix + value.slice(lineStart)
  textarea.value = next
  textarea.focus()
  textarea.selectionStart = s + prefix.length
  textarea.selectionEnd = s + prefix.length
  const event = new Event('input', { bubbles: true })
  textarea.dispatchEvent(event)
}

export default function RichTextField({
  value, onChange, onSubmit, submitRef,
  hubId, placeholder, rows = 4,
  attachments = [], onAttachmentsChange,
}) {
  const wrapRef = useRef(null)
  const fileInputRef = useRef(null)
  const { uploadFile, uploading } = useHubTodoAttachments(hubId)

  function findTextarea() {
    return wrapRef.current?.querySelector('textarea') || null
  }

  async function handleFilePick(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const next = [...attachments]
    for (const file of files) {
      const uploaded = await uploadFile(file)
      if (uploaded) next.push(uploaded)
    }
    onAttachmentsChange?.(next)
  }

  function removeAttachment(path) {
    onAttachmentsChange?.(attachments.filter(a => a.path !== path))
  }

  const btn = "p-1.5 rounded hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-500 dark:text-slate-400 transition-colors"

  return (
    <div ref={wrapRef} className="rounded-xl border border-slate-200 dark:border-dark-border overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50">
        <button type="button" className={btn} onClick={() => applyWrap(findTextarea(), '**')} title="Bold"><Bold size={14} /></button>
        <button type="button" className={btn} onClick={() => applyWrap(findTextarea(), '_')}  title="Italic"><Italic size={14} /></button>
        <button type="button" className={btn} onClick={() => applyWrap(findTextarea(), '[', '](url)')} title="Link"><LinkIcon size={14} /></button>
        <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-1" />
        <button type="button" className={btn} onClick={() => applyLinePrefix(findTextarea(), '- ')}  title="Bullet list"><List size={14} /></button>
        <button type="button" className={btn} onClick={() => applyLinePrefix(findTextarea(), '1. ')} title="Numbered list"><ListOrdered size={14} /></button>
        <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-1" />
        <button type="button" className={btn} onClick={() => fileInputRef.current?.click()} title="Attach file"><Paperclip size={14} /></button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePick} />
      </div>

      <div className="p-2 bg-white dark:bg-dark-card">
        <RichInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          submitRef={submitRef}
          hubId={hubId}
          enableMentions
          enableImages
          placeholder={placeholder}
          rows={rows}
          className="border-0 bg-transparent p-1"
        />
      </div>

      {(attachments.length > 0 || uploading.length > 0) && (
        <div className="flex flex-wrap gap-2 px-2 py-2 border-t border-slate-100 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50">
          {attachments.map(a => (
            <div key={a.path} className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border">
              <FileText size={12} className="text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{a.name}</span>
              <button type="button" onClick={() => removeAttachment(a.path)} className="text-slate-400 hover:text-red-500">
                <X size={10} />
              </button>
            </div>
          ))}
          {uploading.map(u => (
            <div key={u.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg bg-white/50 dark:bg-dark-card/50 border border-slate-200 dark:border-dark-border opacity-70">
              <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-slate-500 truncate max-w-[160px]">{u.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
