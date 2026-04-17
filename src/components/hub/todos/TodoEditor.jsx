import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, List, ListOrdered } from 'lucide-react'

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
  const editor = useEditor({
    extensions: [StarterKit],
    content: value || '',
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[var(--todo-editor-min-h)] px-3 py-2',
        'data-placeholder': placeholder,
        style: `--todo-editor-min-h: ${minRows * 1.5}rem`,
      },
    },
    onUpdate({ editor }) {
      onChange?.(editor.getHTML())
    },
  })

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
      onSubmit?.({
        html: editor.getHTML(),
        mentions: [], // filled in Task 8
        inlineImages: [], // filled in Task 7
      })
    }
  }, [editor, submitRef, onSubmit])

  const btn = 'p-1.5 rounded hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-500 dark:text-slate-400 transition-colors'
  const btnActive = 'bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400'
  const cls = (active) => `${btn} ${active ? btnActive : ''}`

  return (
    <div className="rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50">
        <button type="button" className={cls(editor?.isActive('bold'))} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold"><Bold size={14} /></button>
        <button type="button" className={cls(editor?.isActive('italic'))} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic"><Italic size={14} /></button>
        <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-1" />
        <button type="button" className={cls(editor?.isActive('bulletList'))} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bullet list"><List size={14} /></button>
        <button type="button" className={cls(editor?.isActive('orderedList'))} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered size={14} /></button>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
