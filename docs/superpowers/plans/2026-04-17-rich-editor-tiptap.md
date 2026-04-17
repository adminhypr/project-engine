# Todo-Scoped Tiptap Rich Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the markdown-in-textarea `RichInput` inside the Basecamp-style To-dos module with a Tiptap-based WYSIWYG editor that supports bold, italic, links, bullet/ordered lists, inline images, file attachments (passthrough), and `@mentions`.

**Architecture:** New `TodoEditor.jsx` wraps Tiptap's React bindings with a toolbar, custom-positioned mention dropdown, and paste/drop image upload (reusing the existing `hub-files` bucket flow). `RichContentRenderer` detects HTML vs legacy plaintext content via a pure heuristic and branches rendering; HTML is sanitized with DOMPurify and walked with `html-react-parser` to intercept mention spans and data-file-id images. No DB schema changes — existing `content` / `notes` / `mentions` / `inline_images` columns are reused.

**Tech Stack:** React 18, Vite, Tiptap (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`, `@tiptap/extension-mention`, `@tiptap/suggestion`), `dompurify`, `html-react-parser`, Vitest + React Testing Library (for pure-function tests only).

**Spec:** `docs/superpowers/specs/2026-04-17-rich-editor-tiptap-design.md`

---

## File structure

```
src/
  lib/
    contentFormat.js                NEW — isHtmlContent(str) detection heuristic
    tiptapExtract.js                NEW — extractMentionsFromDoc, extractImagesFromDoc
    __tests__/
      contentFormat.test.js         NEW
      tiptapExtract.test.js         NEW
  components/
    hub/
      todos/
        TodoEditor.jsx              NEW — Tiptap editor with toolbar, mentions, images
        RichTextField.jsx           MOD — swap internal RichInput for TodoEditor
        TodoItemPage.jsx            MOD — comment input swapped for TodoEditor
    ui/
      RichContentRenderer.jsx       MOD — add HTML branch (DOMPurify + parser)
package.json                        MOD — add deps
```

---

## Task 1: Install Tiptap + renderer dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the Tiptap + renderer deps**

Run from the repo root:

```bash
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image @tiptap/extension-mention @tiptap/suggestion dompurify html-react-parser
```

- [ ] **Step 2: Verify the dev server still boots**

Run: `npm run dev` in a separate terminal. Expected: Vite starts, no console errors about missing packages. Kill the process after confirming.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Tiptap + dompurify + html-react-parser deps for todo rich editor"
```

---

## Task 2: `contentFormat.js` + tests

**Files:**
- Create: `src/lib/contentFormat.js`
- Create: `src/lib/__tests__/contentFormat.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/contentFormat.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { isHtmlContent } from '../contentFormat'

describe('isHtmlContent', () => {
  it('returns false for empty string', () => {
    expect(isHtmlContent('')).toBe(false)
  })
  it('returns false for plain text', () => {
    expect(isHtmlContent('hello world')).toBe(false)
  })
  it('returns false for markdown-style text', () => {
    expect(isHtmlContent('**bold** and _italic_')).toBe(false)
  })
  it('returns false for inline comparison text', () => {
    expect(isHtmlContent('two < three')).toBe(false)
  })
  it('returns false for non-whitelisted root tags (e.g., script)', () => {
    expect(isHtmlContent('<script>evil</script>')).toBe(false)
  })
  it('returns false for null / undefined', () => {
    expect(isHtmlContent(null)).toBe(false)
    expect(isHtmlContent(undefined)).toBe(false)
  })
  it('returns true for a paragraph-rooted doc', () => {
    expect(isHtmlContent('<p>hi</p>')).toBe(true)
  })
  it('returns true with leading whitespace', () => {
    expect(isHtmlContent('  \n  <ul><li>a</li></ul>')).toBe(true)
  })
  it('returns true for heading-rooted doc', () => {
    expect(isHtmlContent('<h2>title</h2>')).toBe(true)
  })
  it('returns true for blockquote-rooted doc', () => {
    expect(isHtmlContent('<blockquote>q</blockquote>')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/contentFormat.test.js --run`
Expected: FAIL — "Cannot find module '../contentFormat'".

- [ ] **Step 3: Implement the helper**

Create `src/lib/contentFormat.js`:

```js
const HTML_ROOT_RE = /^\s*<(p|ul|ol|h[1-6]|blockquote|div)\b/i

export function isHtmlContent(s) {
  return typeof s === 'string' && HTML_ROOT_RE.test(s)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/contentFormat.test.js --run`
Expected: PASS — 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contentFormat.js src/lib/__tests__/contentFormat.test.js
git commit -m "feat: isHtmlContent content-format detection helper + tests"
```

---

## Task 3: `tiptapExtract.js` + tests

**Files:**
- Create: `src/lib/tiptapExtract.js`
- Create: `src/lib/__tests__/tiptapExtract.test.js`

Background: Tiptap's `editor.getJSON()` returns a nested ProseMirror doc. Mentions are nodes with `type: 'mention'` and `attrs: { id, label }`. Images we care about are nodes with `type: 'image'` and `attrs` containing our `data-file-id`, `data-file-name`, `data-mime`, `src`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/tiptapExtract.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { extractMentionsFromDoc, extractImagesFromDoc } from '../tiptapExtract'

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

const mentionDoc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'hey ' },
      { type: 'mention', attrs: { id: 'u1', label: 'Alice' } },
    ],
  }],
}

const dupeMentionDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u1', label: 'Alice' } }] },
    { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u1', label: 'Alice' } }] },
    { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u2', label: 'Bob' } }] },
  ],
}

const nestedMentionDoc = {
  type: 'doc',
  content: [{
    type: 'bulletList',
    content: [{
      type: 'listItem',
      content: [{
        type: 'paragraph',
        content: [{ type: 'mention', attrs: { id: 'u3', label: 'Carol' } }],
      }],
    }],
  }],
}

const imageDoc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{
      type: 'image',
      attrs: {
        'data-file-id': 'f1',
        'data-file-name': 'screenshot.png',
        'data-mime': 'image/png',
        src: 'blob:abc',
      },
    }],
  }],
}

const imageNoIdDoc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'image', attrs: { src: 'https://foo/x.png' } }],
  }],
}

describe('extractMentionsFromDoc', () => {
  it('returns [] for empty doc', () => {
    expect(extractMentionsFromDoc(emptyDoc)).toEqual([])
  })
  it('extracts a single mention', () => {
    expect(extractMentionsFromDoc(mentionDoc)).toEqual([
      { user_id: 'u1', display_name: 'Alice' },
    ])
  })
  it('dedupes repeated mentions by user_id', () => {
    expect(extractMentionsFromDoc(dupeMentionDoc)).toEqual([
      { user_id: 'u1', display_name: 'Alice' },
      { user_id: 'u2', display_name: 'Bob' },
    ])
  })
  it('finds mentions nested in lists', () => {
    expect(extractMentionsFromDoc(nestedMentionDoc)).toEqual([
      { user_id: 'u3', display_name: 'Carol' },
    ])
  })
  it('tolerates null/undefined input', () => {
    expect(extractMentionsFromDoc(null)).toEqual([])
    expect(extractMentionsFromDoc(undefined)).toEqual([])
  })
})

describe('extractImagesFromDoc', () => {
  it('returns [] for empty doc', () => {
    expect(extractImagesFromDoc(emptyDoc)).toEqual([])
  })
  it('extracts an image with data-file-id', () => {
    expect(extractImagesFromDoc(imageDoc)).toEqual([
      { file_id: 'f1', file_name: 'screenshot.png', mime_type: 'image/png', storage_path: null },
    ])
  })
  it('skips images missing data-file-id (external URLs etc.)', () => {
    expect(extractImagesFromDoc(imageNoIdDoc)).toEqual([])
  })
  it('tolerates null/undefined input', () => {
    expect(extractImagesFromDoc(null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/tiptapExtract.test.js --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/tiptapExtract.js`:

```js
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return
  visitor(node)
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, visitor)
  }
}

export function extractMentionsFromDoc(doc) {
  if (!doc) return []
  const seen = new Set()
  const out = []
  walk(doc, node => {
    if (node.type === 'mention') {
      const id = node.attrs?.id
      const label = node.attrs?.label ?? ''
      if (id && !seen.has(id)) {
        seen.add(id)
        out.push({ user_id: id, display_name: label })
      }
    }
  })
  return out
}

export function extractImagesFromDoc(doc) {
  if (!doc) return []
  const out = []
  walk(doc, node => {
    if (node.type === 'image') {
      const attrs = node.attrs || {}
      const fileId = attrs['data-file-id']
      if (!fileId) return
      out.push({
        file_id: fileId,
        file_name: attrs['data-file-name'] ?? '',
        mime_type: attrs['data-mime'] ?? '',
        storage_path: attrs['data-storage-path'] ?? null,
      })
    }
  })
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/tiptapExtract.test.js --run`
Expected: PASS — 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tiptapExtract.js src/lib/__tests__/tiptapExtract.test.js
git commit -m "feat: tiptapExtract helpers for mentions and inline images + tests"
```

---

## Task 4: `TodoEditor.jsx` scaffold with StarterKit

**Files:**
- Create: `src/components/hub/todos/TodoEditor.jsx`

The editor ships in multiple tasks — scaffold first, then add features one at a time, verifying in the browser between tasks. This task produces a bare editor: paragraph + typing + bold/italic keyboard shortcuts (from StarterKit) — no toolbar or mentions yet.

- [ ] **Step 1: Create the scaffold**

Create `src/components/hub/todos/TodoEditor.jsx`:

```jsx
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
```

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/hub/todos/TodoEditor.jsx
git commit -m "feat: TodoEditor scaffold (Tiptap StarterKit only)"
```

---

## Task 5: Toolbar (bold / italic / bullet / ordered / link button)

**Files:**
- Modify: `src/components/hub/todos/TodoEditor.jsx`

Tiptap commands:
- Bold: `editor.chain().focus().toggleBold().run()`
- Italic: `toggleItalic()`
- Bullet list: `toggleBulletList()`
- Ordered list: `toggleOrderedList()`
- Link: handled in Task 6 (needs a small URL prompt)

- [ ] **Step 1: Replace the editor return with a toolbar + editor**

Edit `src/components/hub/todos/TodoEditor.jsx`. Replace the existing `return` block AND add the `Bold`/`Italic`/`List`/`ListOrdered` imports at the top of the file.

Add to imports at the top:

```jsx
import { Bold, Italic, List, ListOrdered } from 'lucide-react'
```

Replace the `return (...)` block with:

```jsx
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Commit**

```bash
git add src/components/hub/todos/TodoEditor.jsx
git commit -m "feat: TodoEditor toolbar — bold, italic, bullet, ordered"
```

---

## Task 6: Link extension + inline URL prompt

**Files:**
- Modify: `src/components/hub/todos/TodoEditor.jsx`

- [ ] **Step 1: Add Link extension and link button**

Edit `src/components/hub/todos/TodoEditor.jsx`. Add the Link import at the top:

```jsx
import Link from '@tiptap/extension-link'
import { Bold, Italic, List, ListOrdered, Link as LinkIcon } from 'lucide-react'
```

(Replace the existing `lucide-react` import line if it already exists — merge into the line above.)

Change the `extensions` array in `useEditor` to:

```jsx
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank', class: 'text-brand-600 dark:text-brand-400 underline' },
      }),
    ],
```

Add a `promptLink` handler above the `return`:

```jsx
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
```

Insert the link button into the toolbar between Italic and the separator:

```jsx
        <button type="button" className={cls(editor?.isActive('link'))} onClick={promptLink} title="Link"><LinkIcon size={14} /></button>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Commit**

```bash
git add src/components/hub/todos/TodoEditor.jsx
git commit -m "feat: TodoEditor link extension + inline URL prompt"
```

---

## Task 7: Image extension + paste/drop upload

**Files:**
- Modify: `src/components/hub/todos/TodoEditor.jsx`

Reuse the existing `hub-files` bucket + `hub_files` DB table — same pattern as `RichInput` uses today.

- [ ] **Step 1: Add imports and image extension**

Edit `src/components/hub/todos/TodoEditor.jsx`. Add imports:

```jsx
import Image from '@tiptap/extension-image'
import { Image as ImageIcon } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { showToast } from '../../ui/index'
import { extractImagesFromDoc, extractMentionsFromDoc } from '../../../lib/tiptapExtract'
```

(Merge the `useEffect` import with the existing one. Merge the lucide icon imports onto one line alongside the Task-5/6 icons.)

Extend the image extension with our custom data-* attributes. Above the `useEditor` call, add:

```jsx
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
```

Add it to the `extensions` array:

```jsx
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ /* unchanged */ }),
      FileImage.configure({
        inline: false,
        HTMLAttributes: { class: 'rounded-lg max-w-xs max-h-48' },
      }),
    ],
```

- [ ] **Step 2: Add the upload helper + file input + paste handler**

Inside the component, above the existing `useEffect`s, add:

```jsx
  const { profile } = useAuth()
  const fileInputRef = useRef(null)

  const uploadImage = useCallback(async (file) => {
    if (!editor) return
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
    editor.chain().focus().setImage({
      src: signed?.signedUrl || '',
      alt: fileName,
      'data-file-id': data.id,
      'data-file-name': fileName,
      'data-mime': file.type,
      'data-storage-path': storagePath,
    }).run()
  }, [editor, hubId, profile?.id])
```

Update the `editorProps` to include paste/drop handlers:

```jsx
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
```

Add the image button (opens a file picker) to the toolbar, after the ordered-list button:

```jsx
        <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-1" />
        <button type="button" className={btn} onClick={() => fileInputRef.current?.click()} title="Insert image"><ImageIcon size={14} /></button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          for (const f of files) if (f.type.startsWith('image/')) uploadImage(f)
        }} />
```

Update the `submitRef` block to extract images:

```jsx
    submitRef.current = () => {
      if (!editor) return
      const json = editor.getJSON()
      onSubmit?.({
        html: editor.getHTML(),
        mentions: extractMentionsFromDoc(json),
        inlineImages: extractImagesFromDoc(json),
      })
    }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 4: Commit**

```bash
git add src/components/hub/todos/TodoEditor.jsx
git commit -m "feat: TodoEditor image extension + paste/drop upload to hub-files"
```

---

## Task 8: Mention extension + custom dropdown

**Files:**
- Modify: `src/components/hub/todos/TodoEditor.jsx`

Render the dropdown ourselves (no `tippy.js`). Use `@tiptap/suggestion`'s `clientRect()` callback for caret positioning.

- [ ] **Step 1: Add imports**

Add to the top of `TodoEditor.jsx`:

```jsx
import { useState } from 'react'
import Mention from '@tiptap/extension-mention'
import { useHubMembers } from '../../../hooks/useHubMembers'
```

(Merge `useState` into the existing React import.)

- [ ] **Step 2: Add mention state + member filter**

Inside the component, near the other `useState` calls, add:

```jsx
  const { members } = useHubMembers(hubId)
  const [mentionQuery, setMentionQuery] = useState(null)  // null when inactive, string when active
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionRect, setMentionRect] = useState(null)
  const mentionCommandRef = useRef(null)

  const filteredMembers = mentionQuery === null ? [] : members
    .filter(m => m.profile?.id && m.profile.id !== profile?.id)
    .filter(m => (m.profile?.full_name || '').toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 6)
```

- [ ] **Step 3: Wire the Mention extension with a custom render**

Add to the `extensions` array (after the Image extension):

```jsx
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
```

- [ ] **Step 4: Render the dropdown**

Add just above the closing `</div>` of the outermost wrapper (i.e., after `<EditorContent />`):

```jsx
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
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 6: Commit**

```bash
git add src/components/hub/todos/TodoEditor.jsx
git commit -m "feat: TodoEditor mention extension + custom caret-anchored dropdown"
```

---

## Task 9: Submit-on-Enter behavior

**Files:**
- Modify: `src/components/hub/todos/TodoEditor.jsx`

For comment inputs we want Enter = submit, Shift+Enter = newline. For notes we want Enter = newline and submit via the parent button (current behavior via `submitRef`).

- [ ] **Step 1: Add the Enter handler**

In `TodoEditor.jsx`, extend `editorProps` with a `handleKeyDown`:

```jsx
      handleKeyDown(view, event) {
        if (!enableSubmitOnEnter) return false
        if (event.key !== 'Enter' || event.shiftKey) return false
        // Let the mention suggestion consume Enter first if it's open.
        if (mentionQuery !== null) return false
        event.preventDefault()
        const json = editor?.getJSON()
        const html = editor?.getHTML() || ''
        if (!html || html === '<p></p>') return true
        onSubmit?.({
          html,
          mentions: extractMentionsFromDoc(json),
          inlineImages: extractImagesFromDoc(json),
        })
        editor?.commands.clearContent(true)
        return true
      },
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Commit**

```bash
git add src/components/hub/todos/TodoEditor.jsx
git commit -m "feat: TodoEditor Enter-to-submit for comment contexts"
```

---

## Task 10: `RichContentRenderer` HTML branch

**Files:**
- Modify: `src/components/ui/RichContentRenderer.jsx`

The legacy plaintext branch stays untouched. New HTML branch: DOMPurify + `html-react-parser`, with `replace` intercepting mentions (class-based pill) and images (signed URL by `data-file-id`).

- [ ] **Step 1: Add imports and the sanitize config**

Edit `src/components/ui/RichContentRenderer.jsx`. Add to the imports:

```jsx
import parse from 'html-react-parser'
import DOMPurify from 'dompurify'
import { isHtmlContent } from '../../lib/contentFormat'
```

Above the component function, add:

```jsx
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p','strong','em','u','s','a','ul','ol','li','blockquote','h1','h2','h3','h4','h5','h6','br','span','img'],
  ALLOWED_ATTR: ['href','target','rel','class','data-type','data-id','data-label','src','alt','data-file-id','data-file-name','data-mime','data-storage-path'],
}
```

- [ ] **Step 2: Add the HTML branch rendering**

Inside the `RichContentRenderer` component body, *above* the existing `return (...)` block, insert:

```jsx
  const isHtml = isHtmlContent(content)

  // Shared: sign URLs for <img data-file-id="..."> on the HTML path.
  const htmlFileIds = useMemo(() => {
    if (!isHtml) return []
    const out = []
    const doc = new DOMParser().parseFromString(content || '', 'text/html')
    doc.querySelectorAll('img[data-file-id]').forEach(img => {
      const id = img.getAttribute('data-file-id')
      const path = img.getAttribute('data-storage-path')
      if (id && path) out.push({ file_id: id, storage_path: path })
    })
    return out
  }, [content, isHtml])

  const [htmlSignedUrls, setHtmlSignedUrls] = useState({})
  useEffect(() => {
    if (!isHtml || htmlFileIds.length === 0) return
    let cancelled = false
    async function signAll() {
      const urls = {}
      for (const img of htmlFileIds) {
        const { data } = await supabase.storage.from('hub-files').createSignedUrl(img.storage_path, 3600)
        if (data?.signedUrl) urls[img.file_id] = data.signedUrl
      }
      if (!cancelled) setHtmlSignedUrls(urls)
    }
    signAll()
    return () => { cancelled = true }
  }, [htmlFileIds, isHtml])
```

(`useState`, `useEffect`, `useMemo`, and `supabase` are already imported in the existing file — leave them alone.)

- [ ] **Step 3: Render HTML when detected**

Insert the following block immediately above the existing `return (...)` statement. Do NOT delete the existing return — it is the legacy branch that keeps rendering pre-Tiptap content.

```jsx
  if (isHtml) {
    const clean = DOMPurify.sanitize(content || '', PURIFY_CONFIG)
    const tree = parse(clean, {
      replace(node) {
        if (node.type !== 'tag') return
        if (node.name === 'span' && node.attribs?.['data-type'] === 'mention') {
          const label = node.attribs['data-label'] || node.children?.[0]?.data || ''
          return (
            <span className="inline-block bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 font-medium rounded px-1 -mx-0.5">
              {label.startsWith('@') ? label : `@${label}`}
            </span>
          )
        }
        if (node.name === 'img' && node.attribs?.['data-file-id']) {
          const id = node.attribs['data-file-id']
          const name = node.attribs['data-file-name'] || ''
          const url = htmlSignedUrls[id] || node.attribs.src || ''
          return url ? (
            <img
              src={url}
              alt={name}
              loading="lazy"
              className="max-w-xs max-h-48 rounded-lg border border-slate-200 dark:border-dark-border"
            />
          ) : (
            <span className="inline-block w-32 h-24 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse" />
          )
        }
        if (node.name === 'a') {
          node.attribs.target = '_blank'
          node.attribs.rel = 'noopener noreferrer nofollow'
          node.attribs.class = 'text-brand-600 dark:text-brand-400 hover:underline'
        }
      },
    })
    return (
      <div className="rich-html prose prose-sm dark:prose-invert max-w-none">
        {tree}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {attachments.map((a, i) => {
              const url = attSignedUrls[a.path]
              return (
                <a key={a.path + i} href={url || '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors">
                  <span className="text-slate-500 dark:text-slate-400">📎</span>
                  <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{a.name}</span>
                </a>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Legacy plaintext branch (existing code — unchanged below).
  return (
    // ...existing JSX block returning <div> with <p className="whitespace-pre-wrap"> etc.
  )
```

After this change, when `content` is HTML the function returns early; otherwise it falls through to the existing legacy branch unchanged.

- [ ] **Step 4: Verify build + unit tests**

Run: `npm run build`
Expected: build completes.

Run: `npm run test:run`
Expected: all existing tests still pass; new `contentFormat` and `tiptapExtract` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/RichContentRenderer.jsx
git commit -m "feat: RichContentRenderer HTML branch (DOMPurify + html-react-parser)"
```

---

## Task 11: Swap `RichTextField` internals to `TodoEditor`

**Files:**
- Modify: `src/components/hub/todos/RichTextField.jsx`

`RichTextField` is used by `NewListForm`, `NewItemForm`, `TodoItemPage` notes. Today it wraps `RichInput` with a markdown toolbar + attachment chips. We drop the markdown toolbar (now inside `TodoEditor`) and keep the attachment chips.

- [ ] **Step 1: Replace the file contents**

Overwrite `src/components/hub/todos/RichTextField.jsx`:

```jsx
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Verify in the browser**

Start dev: `npm run dev`. Open a hub, open To-dos, click **New list**. Expected:
- Title input as before
- Below it, the Tiptap editor with toolbar (B / I / link / bullet / ordered / image)
- Clicking **B** bolds selected text (no `**` in the editor)
- "Attach" button below the editor opens the file picker; uploaded attachment shows as a chip below

Kill the dev server after verifying.

- [ ] **Step 4: Commit**

```bash
git add src/components/hub/todos/RichTextField.jsx
git commit -m "feat: RichTextField swap internals to TodoEditor (drop markdown toolbar)"
```

---

## Task 12: Swap `TodoItemPage` comment input to `TodoEditor`

**Files:**
- Modify: `src/components/hub/todos/TodoItemPage.jsx`

Notes already go through `RichTextField` (→ `TodoEditor` from Task 11). Only the comment input still uses `RichInput` directly.

- [ ] **Step 1: Replace the comment RichInput with TodoEditor**

In `src/components/hub/todos/TodoItemPage.jsx`:

Remove the import:

```jsx
import RichInput from '../../ui/RichInput'
```

Add the import:

```jsx
import TodoEditor from './TodoEditor'
```

Replace the `<RichInput ... />` block inside the comment composer (the last `<div className="flex-1">` inside the comments section) with:

```jsx
                <TodoEditor
                  value={commentText}
                  onChange={setCommentText}
                  onSubmit={handleAddComment}
                  submitRef={commentSubmitRef}
                  hubId={hubId}
                  placeholder="Add a comment here…"
                  minRows={1}
                  enableSubmitOnEnter
                />
```

The existing `handleAddComment({ content, mentions, inlineImages })` expects `content`. `TodoEditor`'s submit payload uses `html`. Update `handleAddComment` in the same file:

```jsx
  async function handleAddComment({ html, mentions, inlineImages }) {
    const stripped = (html || '').replace(/<[^>]+>/g, '').trim()
    if (!stripped) return
    await addComment(html, mentions, inlineImages)
    setCommentText('')
  }
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build completes.

- [ ] **Step 3: Verify in the browser**

Start dev: `npm run dev`. Open any todo item, type a comment, press Enter. Expected: comment posts, editor clears. Shift+Enter adds a newline inside the editor.

- [ ] **Step 4: Commit**

```bash
git add src/components/hub/todos/TodoItemPage.jsx
git commit -m "feat: TodoItemPage comments use TodoEditor (WYSIWYG + submit on Enter)"
```

---

## Task 13: Manual verification checklist

No code. Run through the full matrix before closing out.

- [ ] **Step 1: Boot the dev server**

Run: `npm run dev`. Open http://localhost:5173/.

- [ ] **Step 2: New list — formatting**

Open a hub → To-dos → **New list**. In the description editor:
- Select text, click **B** → renders bold inline (not `**text**`).
- Select text, click **I** → renders italic inline.
- Click link → prompt appears → enter URL → link mark applied (underlined, brand color).
- Bullet / ordered buttons → list items render.

- [ ] **Step 3: New list — mentions**

Type `@`. Dropdown appears anchored to the caret. Arrow keys move the highlight. Enter picks. The chosen member appears as a styled mention pill.

- [ ] **Step 4: New list — image paste**

Copy any image to clipboard and paste into the description editor. Expected: image uploads to `hub-files`, shows inline immediately at a capped size.

- [ ] **Step 5: Save and reload**

Save the list (click **Add this list**). Reload the page. Open the list. Expected: title/description render with the formatting preserved. Mention pill and inline image still render.

- [ ] **Step 6: Email notification for mention**

Confirm the mentioned user received the email via the existing `hub-mention-notify` edge function and the in-app bell badge increments.

- [ ] **Step 7: Item notes + comments**

Create an item. Notes editor works identically. Open the item detail page:
- Notes editor saves with WYSIWYG content.
- Comment input: type text + Enter submits. Shift+Enter newlines.

- [ ] **Step 8: Legacy content still works**

If any pre-existing todo lists (e.g., the "Test" list) have plaintext content, they render correctly in both the item row preview and the list/item pages — no literal `<p>` tags, no literal `**`.

- [ ] **Step 9: Unrelated modules unchanged**

Open Campfire, message board, check-ins. They still use `RichInput`. Send a message in each, including a mention. Confirm rendering is unchanged.

- [ ] **Step 10: Dark mode**

Toggle theme. Confirm toolbar contrast, mention dropdown background, mention pill, and link color are legible.

- [ ] **Step 11: Build**

Kill dev, run `npm run build`. Expected: green.

- [ ] **Step 12: If everything passes, close out**

```bash
git status
# should be clean
```

No commit — this is a verification task only.
