# Hub @Mentions & Inline Image Paste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add @mention autocomplete and inline image paste/drop to hub inputs, with in-app + email notifications on mention.

**Architecture:** Keep existing `<textarea>` inputs. A shared `RichInput` component wraps textareas with a floating mention dropdown and paste/drop image handling. A shared `RichContentRenderer` replaces plain-text display with styled mention chips and inline image galleries. Mentions metadata and image refs stored as JSONB columns alongside existing `content` text. A `hub_mentions` table drives notification delivery.

**Tech Stack:** React 18, Supabase (Postgres + Storage + Realtime), Deno edge functions, Resend email, Vitest

**Spec:** `docs/superpowers/specs/2026-04-13-hub-mentions-images-design.md`

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/021_hub_mentions.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- Migration 021: Hub @mentions + inline images
-- Adds JSONB metadata columns for mentions and inline images
-- to hub content tables, plus a hub_mentions notification table.
-- ============================================================

-- 1. Add JSONB columns to existing tables
ALTER TABLE hub_chat_messages
  ADD COLUMN IF NOT EXISTS mentions      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS inline_images jsonb DEFAULT '[]'::jsonb;

ALTER TABLE hub_messages
  ADD COLUMN IF NOT EXISTS mentions      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS inline_images jsonb DEFAULT '[]'::jsonb;

ALTER TABLE hub_check_in_responses
  ADD COLUMN IF NOT EXISTS mentions      jsonb DEFAULT '[]'::jsonb;

-- 2. Hub mentions notification table
CREATE TABLE IF NOT EXISTS hub_mentions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id          uuid NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  mentioned_by    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mentioned_user  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  seen            boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_mentions_user_seen
  ON hub_mentions(mentioned_user, seen);
CREATE INDEX IF NOT EXISTS idx_hub_mentions_entity
  ON hub_mentions(entity_type, entity_id);

-- 3. RLS policies for hub_mentions
ALTER TABLE hub_mentions ENABLE ROW LEVEL SECURITY;

-- Users can read their own mentions
CREATE POLICY hub_mentions_select ON hub_mentions
  FOR SELECT USING (mentioned_user = auth.uid());

-- Hub members can insert mentions for their hub
CREATE POLICY hub_mentions_insert ON hub_mentions
  FOR INSERT WITH CHECK (
    mentioned_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hub_members
      WHERE hub_members.hub_id = hub_mentions.hub_id
      AND hub_members.profile_id = auth.uid()
    )
  );

-- Users can mark their own mentions as seen
CREATE POLICY hub_mentions_update ON hub_mentions
  FOR UPDATE USING (mentioned_user = auth.uid())
  WITH CHECK (mentioned_user = auth.uid());

-- Users can delete their own mentions
CREATE POLICY hub_mentions_delete ON hub_mentions
  FOR DELETE USING (mentioned_by = auth.uid());

-- 4. Enable realtime on hub_mentions
ALTER PUBLICATION supabase_realtime ADD TABLE hub_mentions;

-- 5. Notify PostgREST to pick up schema changes
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/021_hub_mentions.sql
git commit -m "feat: add migration 021 — hub mentions + inline images JSONB columns"
```

---

## Task 2: Mention Parsing Utilities + Tests

Pure functions for mention text handling — no Supabase dependency, fully testable.

**Files:**
- Create: `src/lib/mentions.js`
- Create: `src/lib/__tests__/mentions.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/__tests__/mentions.test.js
import { describe, it, expect } from 'vitest'
import { parseMentionQuery, insertMention, buildMentionSegments } from '../mentions'

describe('parseMentionQuery', () => {
  it('returns inactive when no @ present', () => {
    const result = parseMentionQuery('hello world', 11)
    expect(result.active).toBe(false)
  })

  it('detects @ at start of text', () => {
    const result = parseMentionQuery('@jan', 4)
    expect(result).toEqual({ active: true, query: 'jan', startIndex: 0 })
  })

  it('detects @ after a space', () => {
    const result = parseMentionQuery('hey @bob', 8)
    expect(result).toEqual({ active: true, query: 'bob', startIndex: 4 })
  })

  it('detects @ after a newline', () => {
    const result = parseMentionQuery('line1\n@al', 9)
    expect(result).toEqual({ active: true, query: 'al', startIndex: 6 })
  })

  it('returns inactive when @ is mid-word', () => {
    const result = parseMentionQuery('email@test', 10)
    expect(result.active).toBe(false)
  })

  it('returns inactive when cursor is before @', () => {
    const result = parseMentionQuery('hello @bob', 3)
    expect(result.active).toBe(false)
  })

  it('returns inactive when space follows @query', () => {
    const result = parseMentionQuery('@bob is here', 12)
    expect(result.active).toBe(false)
  })

  it('returns empty query for bare @', () => {
    const result = parseMentionQuery('hey @', 5)
    expect(result).toEqual({ active: true, query: '', startIndex: 4 })
  })
})

describe('insertMention', () => {
  it('replaces @query with @DisplayName and trailing space', () => {
    const result = insertMention('hey @bo', 7, 'Bob Smith')
    expect(result.newText).toBe('hey @Bob Smith ')
    expect(result.newCursorPosition).toBe(15)
  })

  it('works at start of text', () => {
    const result = insertMention('@ja', 3, 'Jane Doe')
    expect(result.newText).toBe('@Jane Doe ')
    expect(result.newCursorPosition).toBe(10)
  })

  it('preserves text after cursor', () => {
    const result = insertMention('@bo and others', 3, 'Bob Smith')
    expect(result.newText).toBe('@Bob Smith and others')
  })
})

describe('buildMentionSegments', () => {
  it('returns single text segment when no mentions', () => {
    const result = buildMentionSegments('hello world', [])
    expect(result).toEqual([{ type: 'text', value: 'hello world' }])
  })

  it('splits text around a mention', () => {
    const result = buildMentionSegments('hey @Jane Smith check this', [
      { user_id: '123', display_name: 'Jane Smith' }
    ])
    expect(result).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'mention', value: '@Jane Smith', user_id: '123', display_name: 'Jane Smith' },
      { type: 'text', value: ' check this' },
    ])
  })

  it('handles multiple mentions', () => {
    const result = buildMentionSegments('@Alice and @Bob', [
      { user_id: 'a', display_name: 'Alice' },
      { user_id: 'b', display_name: 'Bob' },
    ])
    expect(result).toEqual([
      { type: 'mention', value: '@Alice', user_id: 'a', display_name: 'Alice' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: '@Bob', user_id: 'b', display_name: 'Bob' },
    ])
  })

  it('ignores @Name not in mentions array', () => {
    const result = buildMentionSegments('hey @Ghost', [])
    expect(result).toEqual([{ type: 'text', value: 'hey @Ghost' }])
  })

  it('handles mention at end of text', () => {
    const result = buildMentionSegments('hello @Jane Smith', [
      { user_id: '1', display_name: 'Jane Smith' }
    ])
    expect(result).toEqual([
      { type: 'text', value: 'hello ' },
      { type: 'mention', value: '@Jane Smith', user_id: '1', display_name: 'Jane Smith' },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/mentions.test.js`
Expected: FAIL — module `../mentions` not found

- [ ] **Step 3: Write the implementation**

```js
// src/lib/mentions.js

/**
 * Check if the cursor is in an active @mention query.
 * Returns { active, query, startIndex } where startIndex is the position of '@'.
 */
export function parseMentionQuery(text, cursorPosition) {
  const before = text.slice(0, cursorPosition)
  // Find the last @ that is either at position 0 or preceded by whitespace
  const match = before.match(/(?:^|[\s])@([^\s]*)$/)
  if (!match) return { active: false, query: '', startIndex: -1 }

  const query = match[1]
  // startIndex is position of '@' in the original text
  const startIndex = before.length - match[0].length + (match[0].startsWith('@') ? 0 : 1)
  return { active: true, query, startIndex }
}

/**
 * Replace the @query at startIndex with @DisplayName + trailing space.
 * Returns { newText, newCursorPosition }.
 */
export function insertMention(text, cursorPosition, displayName) {
  const { startIndex } = parseMentionQuery(text, cursorPosition)
  if (startIndex === -1) return { newText: text, newCursorPosition: cursorPosition }

  const before = text.slice(0, startIndex)
  const after = text.slice(cursorPosition)
  const mention = `@${displayName} `
  return {
    newText: before + mention + after,
    newCursorPosition: before.length + mention.length,
  }
}

/**
 * Split content into segments for rendering: text and mention chunks.
 * Only matches @DisplayName that exists in the mentions array.
 */
export function buildMentionSegments(content, mentions) {
  if (!mentions || mentions.length === 0) {
    return [{ type: 'text', value: content }]
  }

  // Build a regex that matches any @DisplayName from the mentions list
  // Sort by display_name length descending so longer names match first
  const sorted = [...mentions].sort((a, b) => b.display_name.length - a.display_name.length)
  const escaped = sorted.map(m => m.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g')

  const segments = []
  let lastIndex = 0
  let match

  while ((match = pattern.exec(content)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    // Find the mention metadata
    const matchedName = match[1]
    const mentionData = sorted.find(m => m.display_name === matchedName)
    segments.push({
      type: 'mention',
      value: match[0],
      user_id: mentionData.user_id,
      display_name: mentionData.display_name,
    })
    lastIndex = pattern.lastIndex
  }

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return segments
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/mentions.test.js`
Expected: all 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mentions.js src/lib/__tests__/mentions.test.js
git commit -m "feat: add mention parsing utilities with tests"
```

---

## Task 3: RichInput Component

Shared textarea wrapper with @mention autocomplete dropdown and image paste/drop.

**Files:**
- Create: `src/components/ui/RichInput.jsx`

- [ ] **Step 1: Create the RichInput component**

```jsx
// src/components/ui/RichInput.jsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, ImagePlus, Loader2 } from 'lucide-react'
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
  const [uploading, setUploading] = useState([]) // [{id, name, preview}]
  const [dragOver, setDragOver] = useState(false)

  // Filter members for autocomplete — exclude self, filter by query
  const filteredMembers = enableMentions && mentionState.active
    ? members
        .filter(m => m.profile?.id !== profile?.id)
        .filter(m => {
          const name = m.profile?.full_name || ''
          return name.toLowerCase().includes(mentionState.query.toLowerCase())
        })
        .slice(0, MAX_DROPDOWN)
    : []

  // Update mention state on text change
  function handleChange(e) {
    const text = e.target.value
    onChange(text)

    if (enableMentions) {
      const cursor = e.target.selectionStart
      const parsed = parseMentionQuery(text, cursor)
      setMentionState(parsed)
      setMentionIndex(0)

      if (parsed.active && textareaRef.current) {
        // Position dropdown below the textarea — simple approach
        const rect = textareaRef.current.getBoundingClientRect()
        setDropdownPos({ top: rect.height + 4, left: 0 })
      }
    }
  }

  // Select a mention from the dropdown
  function selectMention(member) {
    const displayName = member.profile?.full_name
    if (!displayName) return

    const cursor = textareaRef.current?.selectionStart || value.length
    const { newText, newCursorPosition } = insertMention(value, cursor, displayName)
    onChange(newText)
    setMentions(prev => {
      // Deduplicate by user_id
      if (prev.some(m => m.user_id === member.profile.id)) return prev
      return [...prev, { user_id: member.profile.id, display_name: displayName }]
    })
    setMentionState({ active: false, query: '', startIndex: -1 })

    // Restore focus and cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.selectionStart = newCursorPosition
        textareaRef.current.selectionEnd = newCursorPosition
      }
    }, 0)
  }

  // Keyboard navigation in dropdown
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

    // Normal Enter = submit (for chat-style inputs)
    if (e.key === 'Enter' && !e.shiftKey && !mentionState.active) {
      if (singleLine || rows <= 2) {
        e.preventDefault()
        handleSubmit()
      }
    }
  }

  // Submit handler
  function handleSubmit() {
    if (!value.trim() && inlineImages.length === 0) return
    onSubmit?.({
      content: value.trim(),
      mentions,
      inlineImages,
    })
    // Reset internal state
    setMentions([])
    setInlineImages([])
    setMentionState({ active: false, query: '', startIndex: -1 })
  }

  // Image upload logic
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

    // Insert metadata into hub_files
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
      preview, // keep for display during composition
    }])
  }

  function removeImage(index) {
    const img = inlineImages[index]
    // Clean up storage + db
    if (img.file_id) {
      supabase.from('hub_files').delete().eq('id', img.file_id).then(() => {})
      supabase.storage.from('hub-files').remove([img.storage_path]).then(() => {})
    }
    if (img.preview) URL.revokeObjectURL(img.preview)
    setInlineImages(prev => prev.filter((_, i) => i !== index))
  }

  // Paste handler
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

  // Drag and drop
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

  // Close dropdown when clicking outside
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

      {/* Mention autocomplete dropdown */}
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
                e.preventDefault() // prevent textarea blur
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

      {/* Image preview strip */}
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
```

- [ ] **Step 2: Verify it compiles — start the dev server and check for import errors in the browser console**

Run: check browser console at `http://localhost:5173` — no errors expected yet since the component isn't mounted anywhere.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/RichInput.jsx
git commit -m "feat: add RichInput component with mention autocomplete and image paste"
```

---

## Task 4: RichContentRenderer Component

Renders plain text + mentions + inline images as rich content.

**Files:**
- Create: `src/components/ui/RichContentRenderer.jsx`

- [ ] **Step 1: Create the RichContentRenderer component**

```jsx
// src/components/ui/RichContentRenderer.jsx
import { useState, useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { buildMentionSegments } from '../../lib/mentions'

function ImageModal({ src, alt, onClose }) {
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
        <X size={20} />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

export default function RichContentRenderer({ content, mentions = [], inlineImages = [] }) {
  const [signedUrls, setSignedUrls] = useState({})
  const [modalImage, setModalImage] = useState(null)

  // Sign URLs for inline images
  useEffect(() => {
    if (inlineImages.length === 0) return
    let cancelled = false

    async function signAll() {
      const urls = {}
      for (const img of inlineImages) {
        if (signedUrls[img.storage_path]) {
          urls[img.storage_path] = signedUrls[img.storage_path]
          continue
        }
        const { data } = await supabase.storage
          .from('hub-files')
          .createSignedUrl(img.storage_path, 3600)
        if (data?.signedUrl) urls[img.storage_path] = data.signedUrl
      }
      if (!cancelled) setSignedUrls(urls)
    }

    signAll()
    return () => { cancelled = true }
  }, [inlineImages])

  // Build text segments with mention highlighting
  const segments = useMemo(
    () => buildMentionSegments(content || '', mentions),
    [content, mentions]
  )

  return (
    <div>
      {/* Text with mention chips */}
      <p className="whitespace-pre-wrap break-words">
        {segments.map((seg, i) =>
          seg.type === 'mention' ? (
            <span
              key={i}
              className="inline-block bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 font-medium rounded px-1 -mx-0.5"
            >
              {seg.value}
            </span>
          ) : (
            <span key={i}>{seg.value}</span>
          )
        )}
      </p>

      {/* Inline images */}
      {inlineImages.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {inlineImages.map((img, i) => {
            const url = signedUrls[img.storage_path]
            return url ? (
              <img
                key={img.file_id || i}
                src={url}
                alt={img.file_name}
                loading="lazy"
                className="max-w-xs max-h-48 rounded-lg border border-slate-200 dark:border-dark-border cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setModalImage({ src: url, alt: img.file_name })}
                onError={e => { e.target.style.display = 'none' }}
              />
            ) : (
              <div
                key={img.file_id || i}
                className="w-32 h-24 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse"
              />
            )
          })}
        </div>
      )}

      {/* Fullscreen modal */}
      {modalImage && (
        <ImageModal src={modalImage.src} alt={modalImage.alt} onClose={() => setModalImage(null)} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/RichContentRenderer.jsx
git commit -m "feat: add RichContentRenderer with mention chips and inline images"
```

---

## Task 5: Update Data Hooks

Add `mentions` and `inline_images` to Supabase queries and inserts. Add `hub_mentions` cleanup on delete.

**Files:**
- Modify: `src/hooks/useHubChat.js`
- Modify: `src/hooks/useHubMessages.js`
- Modify: `src/hooks/useHubCheckIns.js`

- [ ] **Step 1: Update useHubChat.js — sendMessage signature and delete cleanup**

In `src/hooks/useHubChat.js`, change the `sendMessage` callback to accept an object instead of a plain string, and add `hub_mentions` cleanup to `deleteMessage`:

Replace the `sendMessage` callback (lines 61–70):

```js
  const sendMessage = useCallback(async (content, mentions = [], inlineImages = []) => {
    if (!hubRef.current || !profile?.id || !content.trim()) return false
    const { data, error } = await supabase.from('hub_chat_messages').insert({
      hub_id: hubRef.current,
      author_id: profile.id,
      content: content.trim(),
      mentions,
      inline_images: inlineImages.map(({ preview, ...rest }) => rest),
    }).select().single()
    if (error) { showToast('Failed to send message', 'error'); return false }

    // Insert hub_mentions for each unique mentioned user
    if (data && mentions.length > 0) {
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile.id)
      if (uniqueUsers.length > 0) {
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hubRef.current,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'chat',
            entity_id: data.id,
          }))
        )
      }
    }
    return true
  }, [profile?.id])
```

Replace the `deleteMessage` callback (lines 72–76):

```js
  const deleteMessage = useCallback(async (messageId) => {
    // Clean up mentions
    await supabase.from('hub_mentions').delete().eq('entity_type', 'chat').eq('entity_id', messageId)
    const { error } = await supabase.from('hub_chat_messages').delete().eq('id', messageId)
    if (error) { showToast('Failed to delete message', 'error'); return }
    setMessages(prev => prev.filter(m => m.id !== messageId))
  }, [])
```

- [ ] **Step 2: Update useHubMessages.js — postMessage, replyToMessage, and delete cleanup**

In `src/hooks/useHubMessages.js`, update `postMessage` (lines 47–56):

```js
  const postMessage = useCallback(async (title, content, mentions = [], inlineImages = []) => {
    if (!hubRef.current || !profile?.id) return false
    const { data, error } = await supabase.from('hub_messages').insert({
      hub_id: hubRef.current,
      author_id: profile.id,
      title, content,
      mentions,
      inline_images: inlineImages.map(({ preview, ...rest }) => rest),
    }).select().single()
    if (error) { showToast('Failed to post message', 'error'); return false }

    if (data && mentions.length > 0) {
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile.id)
      if (uniqueUsers.length > 0) {
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hubRef.current,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'message',
            entity_id: data.id,
          }))
        )
      }
    }
    return true
  }, [profile?.id])
```

Update `replyToMessage` (lines 58–67):

```js
  const replyToMessage = useCallback(async (parentId, content, mentions = [], inlineImages = []) => {
    if (!hubRef.current || !profile?.id) return false
    const { data, error } = await supabase.from('hub_messages').insert({
      hub_id: hubRef.current,
      author_id: profile.id,
      parent_id: parentId,
      content,
      mentions,
      inline_images: inlineImages.map(({ preview, ...rest }) => rest),
    }).select().single()
    if (error) { showToast('Failed to post reply', 'error'); return false }

    if (data && mentions.length > 0) {
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile.id)
      if (uniqueUsers.length > 0) {
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hubRef.current,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'message_reply',
            entity_id: data.id,
          }))
        )
      }
    }
    return true
  }, [profile?.id])
```

Update `deleteMessage` (lines 70–73):

```js
  const deleteMessage = useCallback(async (messageId) => {
    await supabase.from('hub_mentions').delete().eq('entity_id', messageId)
    const { error } = await supabase.from('hub_messages').delete().eq('id', messageId)
    if (error) showToast('Failed to delete message', 'error')
  }, [])
```

- [ ] **Step 3: Update useHubCheckIns.js — submitResponse signature**

In `src/hooks/useHubCheckIns.js`, update `submitResponse` (lines 70–80):

```js
  const submitResponse = useCallback(async (promptId, content, mentions = []) => {
    if (!profile?.id || !content.trim()) return false
    const { data, error } = await supabase.from('hub_check_in_responses').upsert({
      prompt_id: promptId,
      author_id: profile.id,
      content: content.trim(),
      mentions,
      response_date: new Date().toISOString().split('T')[0]
    }, { onConflict: 'prompt_id,author_id,response_date' }).select().single()
    if (error) { showToast('Failed to submit response', 'error'); return false }

    if (data && mentions.length > 0) {
      // For upserts, clean old mentions first
      await supabase.from('hub_mentions').delete().eq('entity_type', 'check_in_response').eq('entity_id', data.id)
      const uniqueUsers = [...new Map(mentions.map(m => [m.user_id, m])).values()]
        .filter(m => m.user_id !== profile.id)
      if (uniqueUsers.length > 0) {
        // Need hub_id — get from the prompt
        const prompt = prompts.find(p => p.id === promptId)
        const hId = prompt?.hub_id || hubRef.current
        await supabase.from('hub_mentions').insert(
          uniqueUsers.map(m => ({
            hub_id: hId,
            mentioned_by: profile.id,
            mentioned_user: m.user_id,
            entity_type: 'check_in_response',
            entity_id: data.id,
          }))
        )
      }
    }
    await fetchData()
    return true
  }, [profile?.id, fetchData, prompts])
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useHubChat.js src/hooks/useHubMessages.js src/hooks/useHubCheckIns.js
git commit -m "feat: update hub hooks to persist mentions and inline images"
```

---

## Task 6: Wire RichInput into Campfire Chat

**Files:**
- Modify: `src/components/hub/ChatInput.jsx`
- Modify: `src/components/hub/Campfire.jsx`
- Modify: `src/components/hub/ChatMessage.jsx`

- [ ] **Step 1: Replace ChatInput with RichInput**

Rewrite `src/components/hub/ChatInput.jsx`:

```jsx
import { useState } from 'react'
import { Send } from 'lucide-react'
import RichInput from '../ui/RichInput'

export default function ChatInput({ hubId, onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSubmit({ content, mentions, inlineImages }) {
    if ((!content.trim() && inlineImages.length === 0) || sending) return
    setSending(true)
    await onSend(content, mentions, inlineImages)
    setText('')
    setSending(false)
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <RichInput
          value={text}
          onChange={setText}
          onSubmit={handleSubmit}
          hubId={hubId}
          enableMentions
          enableImages
          placeholder="Type a message..."
          rows={1}
          className="min-h-[38px] max-h-24"
          singleLine
        />
      </div>
      <button
        type="button"
        onClick={() => {
          const textarea = document.querySelector('.form-input')
          // Trigger submit via the RichInput's internal submit
          handleSubmit({ content: text, mentions: [], inlineImages: [] })
        }}
        disabled={!text.trim() || sending}
        className="btn btn-primary px-3 py-2 shrink-0 disabled:opacity-40"
      >
        <Send size={15} />
      </button>
    </div>
  )
}
```

Wait — the Send button needs to trigger RichInput's handleSubmit which has the internal mentions/inlineImages state. Let me fix this. The RichInput's `onSubmit` is called internally on Enter. For the external Send button, we need to expose a submit ref or restructure.

Better approach: keep the Send button inside ChatInput but have RichInput expose its data via a ref. Actually, simplest is to have RichInput expose the mentions/images state upward and let ChatInput own the submit:

Revised `src/components/hub/ChatInput.jsx`:

```jsx
import { useState, useRef } from 'react'
import { Send } from 'lucide-react'
import RichInput from '../ui/RichInput'

export default function ChatInput({ hubId, onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const richInputRef = useRef(null)

  async function handleRichSubmit({ content, mentions, inlineImages }) {
    if ((!content.trim() && inlineImages.length === 0) || sending) return
    setSending(true)
    await onSend(content, mentions, inlineImages)
    setText('')
    setSending(false)
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <RichInput
          ref={richInputRef}
          value={text}
          onChange={setText}
          onSubmit={handleRichSubmit}
          hubId={hubId}
          enableMentions
          enableImages
          placeholder="Type a message..."
          rows={1}
          className="min-h-[38px] max-h-24"
          singleLine
        />
      </div>
      <button
        type="button"
        onClick={() => richInputRef.current?.submit()}
        disabled={!text.trim() || sending}
        className="btn btn-primary px-3 py-2 shrink-0 disabled:opacity-40"
      >
        <Send size={15} />
      </button>
    </div>
  )
}
```

This means RichInput needs to expose a `submit()` method via `useImperativeHandle`. Let me update the RichInput in the plan to support this.

Actually, let me simplify. Instead of a ref-based approach, the simplest pattern is: RichInput handles Enter key submission internally. The external Send button just needs to trigger the same logic. We can do this by having RichInput accept a `submitRef` prop that gets assigned a submit function.

Simplest approach: Add `useImperativeHandle` to RichInput to expose `submit()`. Let me adjust the plan accordingly.

Add to RichInput (Task 3) — I'll note this as a modification step in Task 6 since that's where the need arises.

Let me restructure. The ChatInput rewrite:

```jsx
import { useState, useRef } from 'react'
import { Send } from 'lucide-react'
import RichInput from '../ui/RichInput'

export default function ChatInput({ hubId, onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const submitRef = useRef(null)

  async function handleRichSubmit({ content, mentions, inlineImages }) {
    if ((!content.trim() && inlineImages.length === 0) || sending) return
    setSending(true)
    await onSend(content, mentions, inlineImages)
    setText('')
    setSending(false)
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <RichInput
          value={text}
          onChange={setText}
          onSubmit={handleRichSubmit}
          submitRef={submitRef}
          hubId={hubId}
          enableMentions
          enableImages
          placeholder="Type a message..."
          rows={1}
          className="min-h-[38px] max-h-24"
          singleLine
        />
      </div>
      <button
        type="button"
        onClick={() => submitRef.current?.()}
        disabled={!text.trim() || sending}
        className="btn btn-primary px-3 py-2 shrink-0 disabled:opacity-40"
      >
        <Send size={15} />
      </button>
    </div>
  )
}
```

And in RichInput, add a `submitRef` prop and assign it:

```js
// In the RichInput component, add this prop and effect:
// Props: submitRef
useEffect(() => {
  if (submitRef) submitRef.current = handleSubmit
})
```

This is cleaner than useImperativeHandle. Let me incorporate this into the plan.

OK let me finalize the plan now and write it all out properly.
</thinking>

- [ ] **Step 1: Add submitRef support to RichInput**

In `src/components/ui/RichInput.jsx`, add `submitRef` to the props destructuring:

```jsx
export default function RichInput({
  value,
  onChange,
  onSubmit,
  submitRef,
  hubId,
  // ... rest unchanged
```

Then after the `handleSubmit` function definition, add:

```js
  // Expose submit to parent via ref
  useEffect(() => {
    if (submitRef) submitRef.current = handleSubmit
  })
```

- [ ] **Step 2: Rewrite ChatInput to use RichInput**

Replace the entire contents of `src/components/hub/ChatInput.jsx`:

```jsx
import { useState, useRef } from 'react'
import { Send } from 'lucide-react'
import RichInput from '../ui/RichInput'

export default function ChatInput({ hubId, onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const submitRef = useRef(null)

  async function handleRichSubmit({ content, mentions, inlineImages }) {
    if ((!content.trim() && inlineImages.length === 0) || sending) return
    setSending(true)
    await onSend(content, mentions, inlineImages)
    setText('')
    setSending(false)
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <RichInput
          value={text}
          onChange={setText}
          onSubmit={handleRichSubmit}
          submitRef={submitRef}
          hubId={hubId}
          enableMentions
          enableImages
          placeholder="Type a message..."
          rows={1}
          className="min-h-[38px] max-h-24"
          singleLine
        />
      </div>
      <button
        type="button"
        onClick={() => submitRef.current?.()}
        disabled={!text.trim() || sending}
        className="btn btn-primary px-3 py-2 shrink-0 disabled:opacity-40"
      >
        <Send size={15} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Update Campfire.jsx to pass hubId to ChatInput**

In `src/components/hub/Campfire.jsx`, change the ChatInput usage (line 47):

```jsx
        <ChatInput hubId={hubId} onSend={sendMessage} />
```

- [ ] **Step 4: Update ChatMessage.jsx to use RichContentRenderer**

In `src/components/hub/ChatMessage.jsx`, add the import at the top:

```jsx
import RichContentRenderer from '../ui/RichContentRenderer'
```

Replace the plain text `<p>` (line 22–24):

```jsx
        <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <RichContentRenderer
            content={message.content}
            mentions={message.mentions}
            inlineImages={message.inline_images}
          />
        </div>
```

- [ ] **Step 5: Test in browser**

Open `http://localhost:5173`, navigate to a hub's Campfire. Verify:
1. Textarea renders and typing works
2. Typing `@` shows the member dropdown
3. Selecting a member inserts `@Name` and the dropdown closes
4. Pasting a screenshot shows a thumbnail below the input
5. Sending a message shows the mention as a styled chip
6. Images render inline in the message

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/RichInput.jsx src/components/hub/ChatInput.jsx src/components/hub/Campfire.jsx src/components/hub/ChatMessage.jsx
git commit -m "feat: wire RichInput and RichContentRenderer into Campfire chat"
```

---

## Task 7: Wire RichInput into Message Board

**Files:**
- Modify: `src/components/hub/MessageComposer.jsx`
- Modify: `src/components/hub/MessageBoard.jsx`
- Modify: `src/components/hub/MessageThread.jsx`

- [ ] **Step 1: Update MessageComposer to use RichInput for the body**

Replace the entire contents of `src/components/hub/MessageComposer.jsx`:

```jsx
import { useState, useRef } from 'react'
import RichInput from '../ui/RichInput'

export default function MessageComposer({ hubId, onSubmit, onCancel }) {
  const [title, setTitle]     = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const submitRef = useRef(null)

  async function handleRichSubmit({ content: richContent, mentions, inlineImages }) {
    if (!richContent.trim() || sending) return
    setSending(true)
    const ok = await onSubmit(title.trim() || null, richContent.trim(), mentions, inlineImages)
    if (!ok) setSending(false)
  }

  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3">
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="form-input w-full text-sm font-semibold"
      />
      <RichInput
        value={content}
        onChange={setContent}
        onSubmit={handleRichSubmit}
        submitRef={submitRef}
        hubId={hubId}
        enableMentions
        enableImages
        placeholder="Write your announcement..."
        rows={3}
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => submitRef.current?.()}
          disabled={!content.trim() || sending}
          className="btn btn-primary text-xs disabled:opacity-40"
        >
          {sending ? 'Posting...' : 'Post announcement'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update MessageBoard.jsx to pass hubId**

In `src/components/hub/MessageBoard.jsx`, update the `handlePost` function (lines 16–19) and `MessageComposer` usage (lines 33–36):

Replace `handlePost`:

```js
  async function handlePost(title, content, mentions, inlineImages) {
    const ok = await postMessage(title, content, mentions, inlineImages)
    if (ok) setShowComposer(false)
    return ok
  }
```

Update the `MessageComposer` JSX:

```jsx
        <MessageComposer
          hubId={hubId}
          onSubmit={handlePost}
          onCancel={() => setShowComposer(false)}
        />
```

And update each `MessageThread` to receive `hubId`:

```jsx
          <MessageThread
            key={msg.id}
            message={msg}
            hubId={hubId}
            isOwn={msg.author_id === profile?.id}
            isManager={isManager}
            onReply={replyToMessage}
            onDelete={deleteMessage}
            onTogglePin={togglePin}
            getReplies={getReplies}
          />
```

- [ ] **Step 3: Update MessageThread.jsx — RichInput for replies + RichContentRenderer for display**

Replace the entire contents of `src/components/hub/MessageThread.jsx`:

```jsx
import { useState, useRef } from 'react'
import { Pin, MessageSquare, Trash2 } from 'lucide-react'
import RichInput from '../ui/RichInput'
import RichContentRenderer from '../ui/RichContentRenderer'

export default function MessageThread({ message, hubId, isOwn, isManager, onReply, onDelete, onTogglePin, getReplies }) {
  const [expanded, setExpanded] = useState(false)
  const [replies, setReplies]   = useState([])
  const [replyText, setReplyText] = useState('')
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [sending, setSending] = useState(false)
  const submitRef = useRef(null)

  const time = new Date(message.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  async function handleExpand() {
    if (!expanded) {
      setLoadingReplies(true)
      const data = await getReplies(message.id)
      setReplies(data)
      setLoadingReplies(false)
    }
    setExpanded(!expanded)
  }

  async function handleReply({ content, mentions, inlineImages }) {
    if (!content.trim() || sending) return
    setSending(true)
    await onReply(message.id, content, mentions, inlineImages)
    setReplyText('')
    const data = await getReplies(message.id)
    setReplies(data)
    setSending(false)
  }

  return (
    <div className={`rounded-xl border ${message.pinned ? 'border-amber-300 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5' : 'border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card'} overflow-hidden`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {message.author?.avatar_url ? (
            <img src={message.author.avatar_url} className="w-8 h-8 rounded-full mt-0.5" alt="" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold mt-0.5">
              {message.author?.full_name?.[0] || '?'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{message.author?.full_name}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500">{time}</span>
              {message.pinned && <Pin size={12} className="text-amber-500" />}
            </div>
            {message.title && (
              <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">{message.title}</h4>
            )}
            <div className="text-sm text-slate-700 dark:text-slate-300 mt-1">
              <RichContentRenderer
                content={message.content}
                mentions={message.mentions}
                inlineImages={message.inline_images}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2.5 ml-11">
          <button onClick={handleExpand} className="text-xs text-brand-500 hover:text-brand-600 dark:text-brand-400 font-medium flex items-center gap-1">
            <MessageSquare size={12} />
            {expanded ? 'Hide replies' : 'Replies'}
          </button>
          {(isOwn || isManager) && (
            <button onClick={() => onTogglePin(message.id, message.pinned)} className="text-xs text-slate-400 hover:text-amber-500 flex items-center gap-1">
              <Pin size={12} />
              {message.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {isOwn && (
            <button onClick={() => onDelete(message.id)} className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200/60 dark:border-dark-border px-4 py-3 bg-slate-50/50 dark:bg-dark-bg/50">
          {loadingReplies ? (
            <p className="text-xs text-slate-400">Loading...</p>
          ) : (
            <>
              {replies.length === 0 && (
                <p className="text-xs text-slate-400 mb-2">No replies yet.</p>
              )}
              <div className="space-y-2 mb-3">
                {replies.map(r => (
                  <div key={r.id} className="flex items-start gap-2">
                    {r.author?.avatar_url ? (
                      <img src={r.author.avatar_url} className="w-6 h-6 rounded-full mt-0.5" alt="" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-slate-300 dark:bg-dark-border flex items-center justify-center text-white text-xs font-bold mt-0.5">
                        {r.author?.full_name?.[0] || '?'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{r.author?.full_name}</span>
                        <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        <RichContentRenderer
                          content={r.content}
                          mentions={r.mentions}
                          inlineImages={r.inline_images}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <RichInput
                    value={replyText}
                    onChange={setReplyText}
                    onSubmit={handleReply}
                    submitRef={submitRef}
                    hubId={hubId}
                    enableMentions
                    enableImages
                    placeholder="Write a reply..."
                    className="text-xs py-1.5"
                    singleLine
                  />
                </div>
                <button
                  type="button"
                  onClick={() => submitRef.current?.()}
                  disabled={!replyText.trim() || sending}
                  className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  Reply
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Test in browser**

Navigate to a hub's Message Board. Verify:
1. New announcement composer has @mention and image support
2. Replies support @mention and image paste
3. Posted messages display mention chips and inline images
4. Replies display mention chips and inline images

- [ ] **Step 5: Commit**

```bash
git add src/components/hub/MessageComposer.jsx src/components/hub/MessageBoard.jsx src/components/hub/MessageThread.jsx
git commit -m "feat: wire RichInput and RichContentRenderer into Message Board"
```

---

## Task 8: Wire RichInput into Check-ins

**Files:**
- Modify: `src/components/hub/CheckInResponseForm.jsx`
- Modify: `src/components/hub/CheckInPromptCard.jsx`

- [ ] **Step 1: Update CheckInResponseForm to use RichInput (mentions only)**

Replace the entire contents of `src/components/hub/CheckInResponseForm.jsx`:

```jsx
import { useState, useRef } from 'react'
import RichInput from '../ui/RichInput'

export default function CheckInResponseForm({ hubId, promptId, onSubmit }) {
  const [text, setText]       = useState('')
  const [sending, setSending] = useState(false)
  const submitRef = useRef(null)

  async function handleRichSubmit({ content, mentions }) {
    if (!content.trim() || sending) return
    setSending(true)
    await onSubmit(promptId, content, mentions)
    setText('')
    setSending(false)
  }

  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <RichInput
          value={text}
          onChange={setText}
          onSubmit={handleRichSubmit}
          submitRef={submitRef}
          hubId={hubId}
          enableMentions
          enableImages={false}
          placeholder="Your answer..."
          className="text-xs py-1.5"
          singleLine
        />
      </div>
      <button
        type="button"
        onClick={() => submitRef.current?.()}
        disabled={!text.trim() || sending}
        className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
      >
        {sending ? '...' : 'Submit'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update CheckInPromptCard to pass hubId and use RichContentRenderer**

In `src/components/hub/CheckInPromptCard.jsx`, add the import:

```jsx
import RichContentRenderer from '../ui/RichContentRenderer'
```

Update the component props to include `hubId`:

```jsx
export default function CheckInPromptCard({ hubId, prompt, responses, profileId, isManager, onSubmitResponse, onDelete }) {
```

Update the `CheckInResponseForm` usage (line 45–47) to pass `hubId`:

```jsx
          <CheckInResponseForm hubId={hubId} promptId={prompt.id} onSubmit={onSubmitResponse} />
```

Replace the response content display (line 69) from:

```jsx
                      <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{r.content}</p>
```

to:

```jsx
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        <RichContentRenderer content={r.content} mentions={r.mentions} />
                      </div>
```

- [ ] **Step 3: Update CheckIns.jsx to pass hubId to CheckInPromptCard**

In `src/components/hub/CheckIns.jsx`, update the `CheckInPromptCard` usage (line 67–74):

```jsx
        <CheckInPromptCard
          key={prompt.id}
          hubId={hubId}
          prompt={prompt}
          responses={responses.filter(r => r.prompt_id === prompt.id)}
          profileId={profile?.id}
          isManager={isManager}
          onSubmitResponse={submitResponse}
          onDelete={deletePrompt}
        />
```

- [ ] **Step 4: Test in browser**

Navigate to a hub's Check-ins tab. Verify:
1. Response input has @mention autocomplete
2. No image paste (images disabled)
3. Submitted responses display mention chips
4. Old responses still render correctly as plain text

- [ ] **Step 5: Commit**

```bash
git add src/components/hub/CheckInResponseForm.jsx src/components/hub/CheckInPromptCard.jsx src/components/hub/CheckIns.jsx
git commit -m "feat: wire RichInput into check-in responses (mentions only)"
```

---

## Task 9: Mention Notifications (In-App)

**Files:**
- Create: `src/hooks/useMentionNotifications.js`
- Modify: `src/components/notifications/NotificationBell.jsx`

- [ ] **Step 1: Create useMentionNotifications hook**

```js
// src/hooks/useMentionNotifications.js
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useMentionNotifications() {
  const { profile } = useAuth()
  const [mentions, setMentions] = useState([])
  const [loading, setLoading]   = useState(true)

  const fetchMentions = useCallback(async () => {
    if (!profile?.id) return
    const { data } = await supabase
      .from('hub_mentions')
      .select(`
        id, hub_id, mentioned_by, entity_type, entity_id, seen, created_at,
        mentioner:profiles!hub_mentions_mentioned_by_fkey(full_name, avatar_url),
        hub:hubs!hub_mentions_hub_id_fkey(name)
      `)
      .eq('mentioned_user', profile.id)
      .eq('seen', false)
      .order('created_at', { ascending: false })
      .limit(20)
    setMentions(data || [])
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    fetchMentions()

    const channel = supabase
      .channel('hub-mentions-notif')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_mentions', filter: `mentioned_user=eq.${profile.id}` },
        () => fetchMentions()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.id, fetchMentions])

  const markSeen = useCallback(async (mentionId) => {
    await supabase.from('hub_mentions').update({ seen: true }).eq('id', mentionId)
    setMentions(prev => prev.filter(m => m.id !== mentionId))
  }, [])

  const markAllSeen = useCallback(async () => {
    if (mentions.length === 0) return
    const ids = mentions.map(m => m.id)
    await supabase.from('hub_mentions').update({ seen: true }).in('id', ids)
    setMentions([])
  }, [mentions])

  return { mentions, loading, markSeen, markAllSeen, refetch: fetchMentions }
}
```

- [ ] **Step 2: Integrate into NotificationBell**

In `src/components/notifications/NotificationBell.jsx`:

Add import at the top:

```jsx
import { useMentionNotifications } from '../../hooks/useMentionNotifications'
import { AtSign } from 'lucide-react'
```

Inside the `NotificationBell` component, add the hook call after the existing state declarations (after line 157):

```jsx
  const { mentions: hubMentions, markSeen: markMentionSeen } = useMentionNotifications()
```

Update the `getNotifications` function signature (line 10) to include `hubMentions`:

```js
function getNotifications(myTasks, profile, unsetupUsers, recentComments, hubInvites, hubMentions) {
```

Add this block inside `getNotifications`, before the `// Recent comments` block (after line 27):

```js
  // Hub @mentions
  hubMentions.forEach(m => {
    const moduleLabel = { chat: 'Campfire', message: 'Message Board', message_reply: 'Message Board', check_in_response: 'Check-ins' }[m.entity_type] || 'Hub'
    notifications.push({
      id: `hub-mention-${m.id}`,
      type: 'hub-mention',
      icon: <AtSign size={14} />,
      color: 'text-brand-600 bg-brand-500/15',
      title: `${m.mentioner?.full_name || 'Someone'} mentioned you`,
      body: `in ${m.hub?.name || 'a hub'} — ${moduleLabel}`,
      link: `/hub/${m.hub_id}`,
      mentionId: m.id,
      time: m.created_at,
      priority: 0.2,
    })
  })
```

Update the call to `getNotifications` (line 258):

```jsx
  const allNotifications = getNotifications(myTasks, profile, unsetupUsers, recentComments, hubInvites, hubMentions)
```

Update `handleNotifClick` to mark mentions as seen (after line 288):

```js
  function handleNotifClick(n) {
    dismiss(n.id)
    if (n.mentionId) markMentionSeen(n.mentionId)
    if (n.link) {
      navigate(n.link)
    } else if (n.taskId) {
      onTaskClick?.(n.taskId)
    }
    setIsOpen(false)
  }
```

- [ ] **Step 3: Test in browser**

Have two users open the app. User A mentions User B in a hub Campfire message. Verify:
1. User B sees a notification badge increment
2. Notification says "@UserA mentioned you — in HubName — Campfire"
3. Clicking navigates to the hub
4. Notification is dismissed and mention marked as seen

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useMentionNotifications.js src/components/notifications/NotificationBell.jsx
git commit -m "feat: add in-app mention notifications to NotificationBell"
```

---

## Task 10: Email Notification Edge Function

**Files:**
- Create: `supabase/functions/hub-mention-notify/index.ts`

- [ ] **Step 1: Create the edge function**

```ts
// supabase/functions/hub-mention-notify/index.ts
// Email notification for hub @mentions.
// Triggered by database webhook on hub_mentions INSERT.
// Deploy: npx supabase functions deploy hub-mention-notify
//
// Set up database webhook in Supabase Dashboard:
//   Database → Webhooks → Create:
//   Table: hub_mentions, Events: INSERT → POST to this function URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('ALERT_FROM_EMAIL') || 'alerts@hyprassistants.com'
const APP_URL = Deno.env.get('APP_URL') || 'https://tasks.hyprstaffing.com'

async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) return false

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Hypr Task <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    }),
  })

  if (!res.ok) {
    console.error('Resend error:', res.status, await res.text())
    return false
  }
  return true
}

function emailWrap(title: string, color: string, body: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; max-width: 560px; margin: 0 auto; background: #f8f9fc; padding: 24px;">
      <div style="background: white; border-radius: 16px; border: 1px solid #e2e5ee; overflow: hidden;">
        <div style="background: ${color}; padding: 16px 24px;">
          <h2 style="margin: 0; font-size: 15px; color: white; font-weight: 600;">${title}</h2>
        </div>
        <div style="padding: 24px;">
          ${body}
        </div>
      </div>
      <p style="text-align: center; margin-top: 16px; font-size: 12px; color: #9aa1b3;">
        <a href="${APP_URL}" style="color: #6366f1; text-decoration: none;">Open Hypr Task</a>
      </p>
    </div>`
}

const MODULE_LABELS: Record<string, string> = {
  chat: 'Campfire',
  message: 'Message Board',
  message_reply: 'Message Board',
  check_in_response: 'Check-ins',
}

async function getMessagePreview(entityType: string, entityId: string): Promise<string> {
  let content = ''

  if (entityType === 'chat') {
    const { data } = await supabase
      .from('hub_chat_messages')
      .select('content')
      .eq('id', entityId)
      .single()
    content = data?.content || ''
  } else if (entityType === 'message' || entityType === 'message_reply') {
    const { data } = await supabase
      .from('hub_messages')
      .select('content')
      .eq('id', entityId)
      .single()
    content = data?.content || ''
  } else if (entityType === 'check_in_response') {
    const { data } = await supabase
      .from('hub_check_in_responses')
      .select('content')
      .eq('id', entityId)
      .single()
    content = data?.content || ''
  }

  // Truncate for email preview
  if (content.length > 200) content = content.slice(0, 200) + '...'
  return content
}

Deno.serve(async (req) => {
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500 })
  }

  try {
    const payload = await req.json()
    const { type, record } = payload

    if (type !== 'INSERT' || !record) {
      return new Response(JSON.stringify({ action: 'none', ok: true }), { status: 200 })
    }

    // Skip self-mentions
    if (record.mentioned_by === record.mentioned_user) {
      return new Response(JSON.stringify({ action: 'self_mention_skipped', ok: true }), { status: 200 })
    }

    // Fetch mentioned user's email
    const { data: mentionedUser } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', record.mentioned_user)
      .single()
    if (!mentionedUser?.email) {
      return new Response(JSON.stringify({ action: 'no_email', ok: true }), { status: 200 })
    }

    // Fetch mentioner's name
    const { data: mentioner } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', record.mentioned_by)
      .single()

    // Fetch hub name
    const { data: hub } = await supabase
      .from('hubs')
      .select('name')
      .eq('id', record.hub_id)
      .single()

    const mentionerName = mentioner?.full_name || 'Someone'
    const hubName = hub?.name || 'a hub'
    const moduleLabel = MODULE_LABELS[record.entity_type] || 'Hub'
    const preview = await getMessagePreview(record.entity_type, record.entity_id)

    const html = emailWrap(`You were mentioned in ${hubName}`, '#6366f1',
      `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${mentionedUser.full_name}</strong>,</p>
       <p style="margin: 0 0 16px; color: #374151;"><strong>${mentionerName}</strong> mentioned you in <strong>${hubName}</strong> — ${moduleLabel}:</p>
       <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
         <p style="margin: 0; font-size: 14px; color: #374151; font-style: italic;">"${preview}"</p>
       </div>
       <div style="margin-top: 20px; text-align: center;">
         <a href="${APP_URL}/hub/${record.hub_id}" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">Open Hub</a>
       </div>`)

    await sendEmail([mentionedUser.email], `${mentionerName} mentioned you in ${hubName}`, html)

    return new Response(JSON.stringify({ action: 'mention_email_sent', ok: true }), { status: 200 })
  } catch (err) {
    console.error('Hub mention notify error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/hub-mention-notify/index.ts
git commit -m "feat: add hub-mention-notify edge function for mention emails"
```

- [ ] **Step 3: Document webhook setup**

The webhook must be configured in the Supabase Dashboard after deploying:
- **Table:** `hub_mentions`
- **Events:** INSERT
- **URL:** The deployed edge function URL
- **Deploy command:** `npx supabase functions deploy hub-mention-notify`

---

## Task 11: Run Tests and Final Verification

- [ ] **Step 1: Run the mention utility tests**

Run: `npm run test:run -- src/lib/__tests__/mentions.test.js`
Expected: all 13 tests PASS

- [ ] **Step 2: Run the full test suite to check for regressions**

Run: `npm run test:run`
Expected: all existing tests PASS

- [ ] **Step 3: Full manual verification in browser**

Open `http://localhost:5173` and test each integration:

1. **Campfire chat:** type `@`, see dropdown, select member, send message, verify mention chip renders, verify image paste works
2. **Message Board post:** compose with @mention and pasted image, verify display
3. **Message Board reply:** reply with @mention and pasted image, verify display
4. **Check-in response:** submit with @mention, verify chip renders, verify no image paste option
5. **Notifications:** mention another user, check their NotificationBell shows the mention
6. **Old messages:** verify existing messages (with `mentions: []`) still render as plain text
7. **Image removal:** paste image, click X to remove before sending, verify cleanup
8. **5MB limit:** try pasting a >5MB image, verify toast error

- [ ] **Step 4: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
