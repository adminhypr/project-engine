import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

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

  return (
    <div className="rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card overflow-hidden">
      <EditorContent editor={editor} />
    </div>
  )
}
