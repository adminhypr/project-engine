import { useRef } from 'react'
import TodoEditor from './TodoEditor'
import { useHubTodoAttachments } from '../../../hooks/useHubTodoAttachments'
import { Paperclip, X, FileText } from 'lucide-react'

export default function RichTextField({
  value, onChange, onSubmit, submitRef,
  hubId, placeholder, rows = 4,
  attachments = [], onAttachmentsChange,
}) {
  const fileInputRef = useRef(null)
  const { uploadFile, uploading } = useHubTodoAttachments(hubId)

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

  return (
    <div>
      <TodoEditor
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        submitRef={submitRef}
        hubId={hubId}
        placeholder={placeholder}
        minRows={rows}
      />

      <div className="flex items-center gap-0.5 px-2 py-1 border-t-0 mt-1">
        <button type="button" className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-500 dark:text-slate-400 transition-colors text-xs flex items-center gap-1"
                onClick={() => fileInputRef.current?.click()} title="Attach file">
          <Paperclip size={12} /> Attach
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePick} />
      </div>

      {(attachments.length > 0 || uploading.length > 0) && (
        <div className="flex flex-wrap gap-2 mt-2">
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
