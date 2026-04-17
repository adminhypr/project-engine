# Todo-Scoped Rich Editor (Tiptap) — Design

**Status:** Draft for implementation
**Date:** 2026-04-17
**Feature branch:** `basecamp`
**Related:** Basecamp To-dos v2 (spec `2026-04-16-basecamp-todos-redesign-design.md`, migrations 022/023/024)

## Motivation

The current `RichTextField` wraps a plain textarea with a toolbar whose buttons insert markdown syntax (`**bold**`, `_italic_`, `[text](url)`) into the text. Users see the raw syntax in the editor, not formatted text. After the saved content is read back, a regex-based fallback in `RichContentRenderer` now renders the markdown as HTML, but the editor experience remains "markdown in a textarea" — which users expect to be true WYSIWYG.

Goal: ship a WYSIWYG rich editor for the Basecamp-style To-dos module only. Other modules (Campfire chat, message board, check-ins) stay on the existing plain-text `RichInput` for now.

## Scope

### In scope

- New component `src/components/hub/todos/TodoEditor.jsx` (Tiptap-backed WYSIWYG).
- Swap `TodoEditor` into the two todo-specific surfaces:
  - `RichTextField.jsx` (used by `NewListForm`, `NewItemForm`, `TodoItemPage` notes)
  - `TodoItemPage.jsx` comment input (replaces `RichInput` for comments only on that page)
- Extend `RichContentRenderer` with an HTML-content branch that sanitizes with DOMPurify and renders via `dangerouslySetInnerHTML`.
- Unit tests for the content-format detection helper and Tiptap doc extraction helpers.
- Manual verification checklist for the feature.

### Out of scope

- Migrating `Campfire`, `MessageBoard`, `CheckInResponseForm` to Tiptap (separate future effort).
- Data migration of existing plaintext/markdown content — legacy content renders via the existing path.
- Tiptap features beyond bold / italic / bullet list / ordered list / link / inline image / mention.
- Tables, code blocks, collaborative cursors, slash commands, drag-to-reorder blocks.
- Database schema changes.

## Architecture

### Dependencies (new)

- `@tiptap/react` — React bindings and the `useEditor` hook.
- `@tiptap/pm` — ProseMirror peer package.
- `@tiptap/starter-kit` — paragraph, text, bold, italic, bullet list, ordered list, list item, heading, history.
- `@tiptap/extension-link` — link mark with `rel="noopener noreferrer nofollow"` + `target="_blank"` defaults.
- `@tiptap/extension-image` — inline image node.
- `@tiptap/extension-mention` + `@tiptap/suggestion` — `@mention` autocomplete.
- `dompurify` — HTML sanitization on the read side.
- `html-react-parser` — parses the sanitized HTML string into a React tree; lets the renderer intercept `span[data-type="mention"]` and `img[data-file-id]` nodes to replace them with styled React components while passing everything else through.

### New module: `TodoEditor.jsx`

Single component exposing a controlled-HTML editor. Props:

```
<TodoEditor
  value                    // controlled HTML string
  onChange(html)           // fires on every doc change
  onSubmit({ html, mentions, inlineImages })
  submitRef                // parent triggers submit programmatically (existing pattern)
  hubId                    // required for mention member list + image upload bucket scoping
  placeholder
  minRows = 2
  enableSubmitOnEnter = false
  autoFocus = false
/>
```

Internal structure:

1. **Toolbar** — button row bound to Tiptap commands: bold, italic, link (opens small inline prompt for URL), bullet list, ordered list, image (opens file picker), attach (emits an `onAttachFile(file)` callback — parent handles attachment state, same pattern as today).
2. **EditorContent** — the contentEditable canvas.
3. **Mention dropdown** — powered by `@tiptap/suggestion` and `@tiptap/extension-mention`. Styled to match the existing `RichInput` dropdown (avatar / name row, arrow-key nav, Enter to pick, Esc to close). Data source: `useHubMembers(hubId)`.
4. **Image paste/drop handler** — custom ProseMirror plugin (`handlePaste`, `handleDrop`) uploads to `hub-files/<hubId>/inline/<uuid>_<name>`, inserts a row into `hub_files`, then inserts an `<img data-file-id="<uuid>" data-file-name="..." src="blob:...">` node. On save the `blob:` preview is fine; on render we swap `src` for a signed URL using the `file_id` as the lookup key.

### Mention node schema

Tiptap's `Mention` extension renders as:

```html
<span data-type="mention" data-id="<user-uuid>" class="mention">@Display Name</span>
```

We adopt that default. The renderer maps the same class to existing brand-colored mention styling.

### Image node schema

```html
<img data-file-id="<uuid>" data-file-name="..." data-mime="image/png" src="<blob-or-signed-url>" alt="..." />
```

`data-file-id` is the durable pointer; `src` is either a blob preview (during editing) or a signed URL (on render).

## Data flow

### Save

1. Parent component (e.g. `NewItemForm`) holds `html` state, driven by `<TodoEditor value={html} onChange={setHtml} />`.
2. On submit, `TodoEditor` builds:
   - `mentions` — dedupe by `user_id` by walking `editor.getJSON()` and collecting `mention` nodes' `attrs.id` + `attrs.label`.
   - `inlineImages` — walk `editor.getJSON()` for `image` nodes with `data-file-id`; shape matches the existing `{ file_id, storage_path, file_name, mime_type }` payload produced by today's `RichInput`.
3. Calls `onSubmit({ html, mentions, inlineImages })`.
4. Parent hook writes:
   - `notes` / `content` / `description` column = `html`
   - `mentions` jsonb column = extracted array (unchanged DB behavior — drives the existing `hub_mentions` backfill that in turn triggers `hub-mention-notify`)
   - `inline_images` jsonb column = extracted array (unchanged DB behavior)

### Read

In `RichContentRenderer`:

```
if (isHtmlContent(content)) renderHtmlBranch(content)
else renderLegacyBranch(content)  // existing behavior, already supports **md**/_md_/[md](url) fallbacks
```

`isHtmlContent(str)` is a pure function:

```js
const HTML_ROOT_RE = /^\s*<(p|ul|ol|h[1-6]|blockquote|div)\b/i
export const isHtmlContent = s => typeof s === 'string' && HTML_ROOT_RE.test(s)
```

HTML branch:

1. Sanitize with DOMPurify. Allowlist: `p, strong, em, u, s, a, ul, ol, li, blockquote, h1, h2, h3, h4, h5, h6, br, span, img`. Allow attributes: `href, target, rel` on `a`; `class, data-type, data-id` on `span`; `src, alt, data-file-id, data-file-name, data-mime` on `img`.
2. Parse the sanitized string into a React tree via `html-react-parser`, providing a `replace` callback that swaps `span[data-type="mention"]` for the brand mention pill and `img[data-file-id]` for a React image node backed by signed-URL state.
3. For `img[data-file-id]`, the renderer maintains the same async-signed-URL state it already uses for `inlineImages`, keyed by `data-file-id`.
4. `span[data-type="mention"]` gets the existing mention pill styling.
5. `a[href]` renders with `target="_blank" rel="noopener noreferrer nofollow"` enforced.

Legacy branch: unchanged. This is what keeps pre-existing plaintext todos (and everything outside the todos module) rendering correctly.

## Backward compatibility

No migration. Two content formats coexist forever, identified per row by the detection heuristic above.

| Format | Written by | Rendered by |
|---|---|---|
| Plaintext (optionally `**md**` / `_md_` / `[text](url)`) + separate mentions array | Pre-Tiptap todos, Campfire, message board, check-ins | `RichContentRenderer` legacy branch |
| HTML with inline mention spans and image nodes | New `TodoEditor` (todos only) | `RichContentRenderer` HTML branch |

Tiptap always emits `<p>…</p>` as the root, so new content always matches the detection heuristic.

## Error handling

- **Image upload failure:** toast "Image upload failed"; node is not inserted; uploading preview is removed. Matches today's `RichInput` behavior.
- **Editor unmount mid-upload:** the upload promise completes but the `editor.commands.insertContent(...)` call is guarded by `if (editor?.isEditable)`.
- **Oversized image:** 5 MB limit enforced before upload (same constant as `RichInput`); toast on violation.
- **Mention to a non-member:** impossible — the suggestion list is sourced from `useHubMembers(hubId)`. No fallback required.
- **Malicious HTML in legacy content re-rendered in HTML branch:** cannot happen — legacy content fails the HTML detection heuristic and goes to the legacy branch, which never calls `dangerouslySetInnerHTML`.

## Testing

### Unit tests (Vitest, `src/lib/__tests__/`)

- `contentFormat.test.js`
  - `isHtmlContent('')` → false
  - `isHtmlContent('hello')` → false
  - `isHtmlContent('**bold** text')` → false
  - `isHtmlContent('<p>hi</p>')` → true
  - `isHtmlContent('  \n  <ul><li>a</li></ul>')` → true
  - `isHtmlContent('two < three')` → false
  - `isHtmlContent('<script>evil</script>')` → false (no whitelisted root element)
- `tiptapExtract.test.js`
  - `extractMentionsFromDoc(emptyDoc)` → `[]`
  - `extractMentionsFromDoc(docWithOneMention)` → single-element array with `user_id`/`display_name`
  - `extractMentionsFromDoc(docWithDuplicateMentions)` → dedupes by `user_id`
  - `extractMentionsFromDoc(docWithNestedListMention)` → finds the mention
  - `extractImagesFromDoc(docWithoutImages)` → `[]`
  - `extractImagesFromDoc(docWithImage)` → matches `{ file_id, file_name, mime_type, storage_path? }`
  - `extractImagesFromDoc(docWithImageMissingFileId)` → skips it (no orphaned rows)

### Manual verification

- [ ] New list description: clicking **B** / **I** / link / bullet formats the text in place (no visible `**` or `_`).
- [ ] Save list, reload page; description renders identically.
- [ ] New item notes: same; attachment chip still appears *below* the editor (not inside it).
- [ ] `@` opens the mention dropdown; arrow keys navigate; Enter picks; selected mention renders as a styled pill.
- [ ] Mentioned user receives the email notification (existing `hub-mention-notify` flow) and the in-app bell increments.
- [ ] Paste an image into the notes / comment: inline preview appears, persists after save.
- [ ] Existing "Test" list (plaintext) still renders correctly; no literal `**` or `_`; no XSS.
- [ ] Comment input on `TodoItemPage`: Enter submits, Shift+Enter inserts a line break.
- [ ] Dark mode: toolbar, mention dropdown, mention pill, link color all legible.
- [ ] No regressions in `Campfire`, `MessageBoard`, `CheckInResponseForm` — they still use `RichInput` unchanged.

## Files touched (estimate)

- **New**
  - `src/components/hub/todos/TodoEditor.jsx`
  - `src/lib/contentFormat.js` (with `isHtmlContent`)
  - `src/lib/tiptapExtract.js` (with `extractMentionsFromDoc`, `extractImagesFromDoc`)
  - `src/lib/__tests__/contentFormat.test.js`
  - `src/lib/__tests__/tiptapExtract.test.js`
- **Modified**
  - `src/components/hub/todos/RichTextField.jsx` — swap the `RichInput` body for `TodoEditor`; keep the attachment chips.
  - `src/components/hub/todos/TodoItemPage.jsx` — swap the comment input's `RichInput` for `TodoEditor` with `enableSubmitOnEnter`.
  - `src/components/ui/RichContentRenderer.jsx` — add HTML branch, keep legacy branch.
  - `package.json` — add new deps.

## Open questions

None. All decisions locked during brainstorming. Library: Tiptap. Storage: HTML. Scope: todos only. Mention extraction: derive from Tiptap JSON on save. No data migration.
