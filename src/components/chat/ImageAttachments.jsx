import { X, Image as ImageIcon } from 'lucide-react'
import { useRef } from 'react'

const MAX_BYTES = 5 * 1024 * 1024

export default function ImageAttachments({ items, onAdd, onRemove }) {
  const inputRef = useRef(null)

  function handleFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_BYTES) continue
      const preview = URL.createObjectURL(file)
      onAdd({ file, preview, name: file.name, type: file.type, size: file.size })
    }
  }

  return (
    <div>
      {items.length > 0 && (
        <div className="flex gap-2 p-2 flex-wrap">
          {items.map((it, i) => (
            <div key={i} className="relative">
              <img src={it.preview} alt="" className="w-14 h-14 rounded-md object-cover" />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center"
                aria-label="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          handleFiles(e.target.files || [])
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2"
        aria-label="Attach image"
        title="Attach image (max 5 MB)"
      >
        <ImageIcon className="w-4 h-4" />
      </button>
    </div>
  )
}
