import { useState, useCallback, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Mention from '@tiptap/extension-mention'
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Image as ImageIcon } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { useHubMembers } from '../../../hooks/useHubMembers'
import { showToast } from '../../ui/index'
import { extractImagesFromDoc, extractMentionsFromDoc } from '../../../lib/tiptapExtract'

const FileImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-file-id':    { default: null, parseHTML: el => el.getAttribute('data-file-id'),    renderHTML: a => a['data-file-id']    ? { 'data-file-id': a['data-file-id'] }       : {} },
      'data-file-name':  { default: null, parseHTML: el => el.getAttribute('data-file-name'),  renderHTML: a => a['data-file-name']  ? { 'data-file-name': a['data-file-name'] }   : {} },
      'data-mime':       { default: null, parseHTML: el => el.getAttribute('data-mime'),       renderHTML: a => a['data-mime']       ? { 'data-mime': a['data-mime'] }              : {} },
      'data-storage-path': { default: null, parseHTML: el => el.getAttribute('data-storage-path'), renderHTML: a => a['data-storage-path'] ? { 'data-storage-path': a['data-storage-path'] } : {} },
    }
  },
})

export default function TodoEditor({
  value = '',
  onChange,
  onSubmit,
  submitRef,
  hubId,
  placeholder = 'Write something…',
  minRows = 2,
  enableSubmitOnEnter = false,
  autoFocus = false,
}) {
  const { profile } = useAuth()
  const fileInputRef = useRef(null)
  // Keep a stable ref to the editor so uploadImage can access it without stale closure
  const editorRef = useRef(null)

  const { members } = useHubMembers(hubId)
  const [mentionQuery, setMentionQuery] = useState(null)  // null when inactive, string when active
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionRect, setMentionRect] = useState(null)
  const mentionCommandRef = useRef(null)

  const filteredMembers = mentionQuery === null ? [] : members
    .filter(m => m.profile?.id && m.profile.id !== profile?.id)
    .filter(m => (m.profile?.full_name || '').toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 6)

  const uploadImage = useCallback(async (file) => {
    const ed = editorRef.current
    if (!ed) return
    if (!file.type.startsWith('image/')) return
    if (file.size > 5 * 1024 * 1024) {
      showToast(`${file.name || 'Image'} exceeds 5 MB limit`, 'error')
      return
    }
    if (!hubId || !profile?.id) return

    const uid = crypto.randomUUID()
    const fileName = file.name || `screenshot-${uid}.png`
    const storagePath = `${hubId}/inline/${uid}_${fileName}`

    const { error: uploadErr } = await supabase.storage.from('hub-files').upload(storagePath, file)
    if (uploadErr) { showToast('Image upload failed', 'error'); return }

    const { data, error: dbErr } = await supabase.from('hub_files').insert({
      hub_id: hubId, folder_id: null, uploaded_by: profile.id,
      file_name: fileName, file_size: file.size, mime_type: file.type, storage_path: storagePath,
    }).select().single()
    if (dbErr) {
      await supabase.storage.from('hub-files').remove([storagePath])
      showToast('Failed to save image', 'error')
      return
    }

    const { data: signed } = await supabase.storage.from('hub-files').createSignedUrl(storagePath, 3600)
    ed.chain().focus().setImage({
      src: signed?.signedUrl || '',
      alt: fileName,
      'data-file-id': data.id,
      'data-file-name': fileName,
      'data-mime': file.type,
      'data-storage-path': storagePath,
    }).run()
  }, [hubId, profile?.id])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank', class: 'text-brand-600 dark:text-brand-400 underline' },
      }),
      FileImage.configure({
        inline: false,
        HTMLAttributes: { class: 'rounded-lg max-w-xs max-h-48' },
      }),
      Mention.configure({
        HTMLAttributes: { class: 'mention inline-block bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 font-medium rounded px-1' },
        renderLabel: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        suggestion: {
          char: '@',
          items: ({ query }) => members
            .filter(m => m.profile?.id && m.profile.id !== profile?.id)
            .filter(m => (m.profile?.full_name || '').toLowerCase().includes(query.toLowerCase()))
            .slice(0, 6)
            .map(m => ({ id: m.profile.id, label: m.profile.full_name })),
          render: () => ({
            onStart: (props) => {
              mentionCommandRef.current = props.command
              setMentionQuery(props.query)
              setMentionIndex(0)
              setMentionRect(props.clientRect?.() || null)
            },
            onUpdate: (props) => {
              mentionCommandRef.current = props.command
              setMentionQuery(props.query)
              setMentionIndex(0)
              setMentionRect(props.clientRect?.() || null)
            },
            onKeyDown: (props) => {
              if (props.event.key === 'ArrowDown') {
                setMentionIndex(i => (i + 1) % Math.max(filteredMembers.length, 1))
                return true
              }
              if (props.event.key === 'ArrowUp') {
                setMentionIndex(i => (i - 1 + Math.max(filteredMembers.length, 1)) % Math.max(filteredMembers.length, 1))
                return true
              }
              if (props.event.key === 'Enter') {
                const picked = filteredMembers[mentionIndex]
                if (picked) {
                  mentionCommandRef.current?.({ id: picked.profile.id, label: picked.profile.full_name })
                  return true
                }
              }
              if (props.event.key === 'Escape') {
                setMentionQuery(null)
                return true
              }
              return false
            },
            onExit: () => {
              setMentionQuery(null)
              setMentionRect(null)
            },
          }),
        },
      }),
    ],
    content: value || '',
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[var(--todo-editor-min-h)] px-3 py-2',
        'data-placeholder': placeholder,
        style: `--todo-editor-min-h: ${minRows * 1.5}rem`,
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) uploadImage(file)
            return true
          }
        }
        return false
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        let handled = false
        for (const file of files) {
          if (file.type.startsWith('image/')) { event.preventDefault(); uploadImage(file); handled = true }
        }
        return handled
      },
    },
    onUpdate({ editor }) {
      onChange?.(editor.getHTML())
    },
  })

  // Keep editorRef in sync with the live editor instance
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Sync external value changes (e.g., after save-then-reset in parent).
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (value !== current && !editor.isFocused) {
      editor.commands.setContent(value || '', false)
    }
  }, [value, editor])

  // Expose a simple submit fn so parents keep the existing submitRef pattern.
  useEffect(() => {
    if (!submitRef) return
    submitRef.current = () => {
      if (!editor) return
      const json = editor.getJSON()
      onSubmit?.({
        html: editor.getHTML(),
        mentions: extractMentionsFromDoc(json),
        inlineImages: extractImagesFromDoc(json),
      })
    }
  }, [editor, submitRef, onSubmit])

  function promptLink() {
    if (!editor) return
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('Link URL', prev)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const btn = 'p-1.5 rounded hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-500 dark:text-slate-400 transition-colors'
  const btnActive = 'bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400'
  const cls = (active) => `${btn} ${active ? btnActive : ''}`

  return (
    <div className="rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50">
        <button type="button" className={cls(editor?.isActive('bold'))} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold"><Bold size={14} /></button>
        <button type="button" className={cls(editor?.isActive('italic'))} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic"><Italic size={14} /></button>
        <button type="button" className={cls(editor?.isActive('link'))} onClick={promptLink} title="Link"><LinkIcon size={14} /></button>
        <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-1" />
        <button type="button" className={cls(editor?.isActive('bulletList'))} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet list"><List size={14} /></button>
        <button type="button" className={cls(editor?.isActive('orderedList'))} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered size={14} /></button>
        <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-1" />
        <button type="button" className={btn} onClick={() => fileInputRef.current?.click()} title="Insert image"><ImageIcon size={14} /></button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          for (const f of files) if (f.type.startsWith('image/')) uploadImage(f)
        }} />
      </div>
      <EditorContent editor={editor} />
      {mentionQuery !== null && filteredMembers.length > 0 && mentionRect && (
        <div
          className="fixed z-50 w-64 bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border rounded-xl shadow-elevated overflow-hidden"
          style={{ top: mentionRect.bottom + 4, left: mentionRect.left }}
        >
          {filteredMembers.map((m, i) => (
            <button
              key={m.profile.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                mentionCommandRef.current?.({ id: m.profile.id, label: m.profile.full_name })
              }}
              onMouseEnter={() => setMentionIndex(i)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                i === mentionIndex
                  ? 'bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
              }`}
            >
              {m.profile.avatar_url ? (
                <img src={m.profile.avatar_url} className="w-6 h-6 rounded-full" alt="" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
                  {m.profile.full_name?.[0] || '?'}
                </div>
              )}
              <span className="truncate">{m.profile.full_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
