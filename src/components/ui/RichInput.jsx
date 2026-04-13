import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useHubMembers } from '../../hooks/useHubMembers'
import { parseMentionQuery, insertMention } from '../../lib/mentions'
import { showToast } from './index'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_DROPDOWN = 6

export default function RichInput({
  value,
  onChange,
  onSubmit,
  submitRef,
  hubId,
  enableMentions = true,
  enableImages = true,
  placeholder,
  rows = 1,
  className = '',
  singleLine = false,
}) {
  const { profile } = useAuth()
  const { members } = useHubMembers(hubId)
  const textareaRef = useRef(null)

  // Mention state
  const [mentionState, setMentionState] = useState({ active: false, query: '', startIndex: -1 })
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentions, setMentions] = useState([])
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })

  // Image state
  const [inlineImages, setInlineImages] = useState([])
  const [uploading, setUploading] = useState([])
  const [dragOver, setDragOver] = useState(false)

  // Filter members for autocomplete
  const filteredMembers = enableMentions && mentionState.active
    ? members
        .filter(m => m.profile?.id !== profile?.id)
        .filter(m => {
          const name = m.profile?.full_name || ''
          return name.toLowerCase().includes(mentionState.query.toLowerCase())
        })
        .slice(0, MAX_DROPDOWN)
    : []

  function handleChange(e) {
    const text = e.target.value
    onChange(text)

    if (enableMentions) {
      const cursor = e.target.selectionStart
      const parsed = parseMentionQuery(text, cursor)
      setMentionState(parsed)
      setMentionIndex(0)

      if (parsed.active && textareaRef.current) {
        const rect = textareaRef.current.getBoundingClientRect()
        setDropdownPos({ top: rect.height + 4, left: 0 })
      }
    }
  }

  function selectMention(member) {
    const displayName = member.profile?.full_name
    if (!displayName) return

    const cursor = textareaRef.current?.selectionStart || value.length
    const { newText, newCursorPosition } = insertMention(value, cursor, displayName)
    onChange(newText)
    setMentions(prev => {
      if (prev.some(m => m.user_id === member.profile.id)) return prev
      return [...prev, { user_id: member.profile.id, display_name: displayName }]
    })
    setMentionState({ active: false, query: '', startIndex: -1 })

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.selectionStart = newCursorPosition
        textareaRef.current.selectionEnd = newCursorPosition
      }
    }, 0)
  }

  function handleKeyDown(e) {
    if (mentionState.active && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => (i + 1) % filteredMembers.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => (i - 1 + filteredMembers.length) % filteredMembers.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        selectMention(filteredMembers[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        setMentionState({ active: false, query: '', startIndex: -1 })
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !mentionState.active) {
      if (singleLine || rows <= 2) {
        e.preventDefault()
        handleSubmit()
      }
    }
  }

  function handleSubmit() {
    if (!value.trim() && inlineImages.length === 0) return
    onSubmit?.({
      content: value.trim(),
      mentions,
      inlineImages,
    })
    setMentions([])
    setInlineImages([])
    setMentionState({ active: false, query: '', startIndex: -1 })
  }

  // Expose submit to parent via ref
  useEffect(() => {
    if (submitRef) submitRef.current = handleSubmit
  })

  async function uploadImage(file) {
    if (!file.type.startsWith('image/')) return
    if (file.size > MAX_IMAGE_SIZE) {
      showToast(`${file.name || 'Image'} exceeds 5 MB limit`, 'error')
      return
    }
    if (!hubId || !profile?.id) return

    const tempId = crypto.randomUUID()
    const preview = URL.createObjectURL(file)
    setUploading(prev => [...prev, { id: tempId, name: file.name || 'screenshot.png', preview }])

    const uid = crypto.randomUUID()
    const fileName = file.name || `screenshot-${uid}.png`
    const storagePath = `${hubId}/inline/${uid}_${fileName}`

    const { error: uploadErr } = await supabase.storage.from('hub-files').upload(storagePath, file)
    if (uploadErr) {
      showToast('Image upload failed', 'error')
      setUploading(prev => prev.filter(u => u.id !== tempId))
      URL.revokeObjectURL(preview)
      return
    }

    const { data, error: dbErr } = await supabase.from('hub_files').insert({
      hub_id: hubId,
      folder_id: null,
      uploaded_by: profile.id,
      file_name: fileName,
      file_size: file.size,
      mime_type: file.type,
      storage_path: storagePath,
    }).select().single()

    if (dbErr) {
      await supabase.storage.from('hub-files').remove([storagePath])
      showToast('Failed to save image', 'error')
      setUploading(prev => prev.filter(u => u.id !== tempId))
      URL.revokeObjectURL(preview)
      return
    }

    setUploading(prev => prev.filter(u => u.id !== tempId))
    setInlineImages(prev => [...prev, {
      file_id: data.id,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: file.type,
      preview,
    }])
  }

  function removeImage(index) {
    const img = inlineImages[index]
    if (img.file_id) {
      supabase.from('hub_files').delete().eq('id', img.file_id).then(() => {})
      supabase.storage.from('hub-files').remove([img.storage_path]).then(() => {})
    }
    if (img.preview) URL.revokeObjectURL(img.preview)
    setInlineImages(prev => prev.filter((_, i) => i !== index))
  }

  function handlePaste(e) {
    if (!enableImages) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) uploadImage(file)
      }
    }
  }

  function handleDragOver(e) {
    if (!enableImages) return
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(e) {
    if (!enableImages) return
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (!files) return
    for (const file of files) {
      if (file.type.startsWith('image/')) uploadImage(file)
    }
  }

  useEffect(() => {
    function handleClick(e) {
      if (textareaRef.current && !textareaRef.current.parentElement.contains(e.target)) {
        setMentionState({ active: false, query: '', startIndex: -1 })
      }
    }
    if (mentionState.active) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [mentionState.active])

  const hasImages = inlineImages.length > 0 || uploading.length > 0

  return (
    <div className="relative">
      <div
        className={`relative ${dragOver ? 'ring-2 ring-brand-400 ring-offset-1 rounded-xl' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={singleLine ? 1 : rows}
          className={`form-input w-full resize-none text-sm ${singleLine ? 'py-1.5' : ''} ${className}`}
        />
      </div>

      {mentionState.active && filteredMembers.length > 0 && (
        <div
          className="absolute z-50 w-64 bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border rounded-xl shadow-elevated overflow-hidden"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {filteredMembers.map((m, i) => (
            <button
              key={m.profile?.id}
              type="button"
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                i === mentionIndex
                  ? 'bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                selectMention(m)
              }}
              onMouseEnter={() => setMentionIndex(i)}
            >
              {m.profile?.avatar_url ? (
                <img src={m.profile.avatar_url} className="w-6 h-6 rounded-full" alt="" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
                  {m.profile?.full_name?.[0] || '?'}
                </div>
              )}
              <span className="truncate">{m.profile?.full_name}</span>
            </button>
          ))}
        </div>
      )}

      {hasImages && (
        <div className="flex flex-wrap gap-2 mt-2">
          {inlineImages.map((img, i) => (
            <div key={img.file_id} className="relative group">
              <img
                src={img.preview}
                alt={img.file_name}
                className="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-dark-border"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {uploading.map(u => (
            <div key={u.id} className="relative">
              <img
                src={u.preview}
                alt={u.name}
                className="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-dark-border opacity-50"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={16} className="animate-spin text-brand-500" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
