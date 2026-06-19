# Chat Preferences — Spec

**Date:** 2026-06-19 · Branch `complete-redesign` · No DB changes (localStorage per profile).

A Preferences panel (opened from the WorkspaceHeader "Preferences" item) that lets a user customize chat. All prefs persist in `localStorage` per profile and apply to BOTH `/chat` and the floating widget.

## Store

`src/lib/chatPrefs.js` — module-level store (mirrors `dmSoundContext`/`dmEventBus` pattern, NOT a React context, so both the page and the widget read it without provider restructuring):
- Key: `pe-chat-prefs-{profileId}`.
- API: `getPrefs(profileId)`, `setPref(profileId, key, value)`, `subscribe(cb)`, `DEFAULTS`, `SIDEBAR_THEMES`.
- `useChatPrefs(profileId)` hook (in the same file or `src/hooks/useChatPrefs.js`): returns `[prefs, setPref]`, re-renders on `subscribe`. Tolerates missing profileId + corrupt JSON.

### Keys + defaults
```
theme:                'system' | 'light' | 'dark'      // default 'system' — delegates to existing useTheme
sidebarTheme:         'default'|'aubergine'|'ocean'|'forest'|'sunset'  // default 'default'
density:              'comfortable' | 'compact'         // default 'comfortable'
timeFormat:           '12h' | '24h'                     // default '12h'
toolbarDefault:       boolean                           // default false (composer toolbar hidden)
sendOnEnter:          boolean                           // default true (Enter sends; false => Cmd/Ctrl+Enter sends)
sound:                boolean                           // default true (new-message ping)
desktopNotifications: boolean                           // default false (browser Notification)
dmListShowAll:        boolean                           // default false (recent only; true => show everyone)
```

### Sidebar theme presets (CSS variables)
Each preset supplies `--chat-sidebar` (channel sidebar bg), `--chat-sidebar-2` (rail bg, slightly darker), `--chat-accent` (active item / send btn / your-reaction). Applied by setting these vars on the `.slack-chat` root element (and the widget root) whenever `sidebarTheme` changes.
```
default:   sidebar #1a1d24  rail #15171d  accent #4f46e5  (indigo — current)
aubergine: sidebar #3f0e40  rail #350d36  accent #611f69  (Slack maroon — matches their real workspace)
ocean:     sidebar #0b2540  rail #07203b  accent #2563eb
forest:    sidebar #14302a  rail #0f2620  accent #15803d
sunset:    sidebar #3a1a12  rail #2e140d  accent #c2410c
```

## Wiring (effects)

- **theme** → existing `useTheme` (extend to support 'system' = clear override / follow `prefers-color-scheme`). Panel control delegates to useTheme; store mirrors the choice.
- **sidebarTheme** → set the 3 CSS vars on the chat root + widget root. Sidebar/rail/active-item/send-button/your-reaction styles read `var(--chat-sidebar)` / `var(--chat-sidebar-2)` / `var(--chat-accent)` (via Tailwind arbitrary values `bg-[var(--chat-accent)]` etc.) instead of the static `slack-*`/`brand-*` tokens at those specific spots. Keep static tokens as the CSS-var fallbacks.
- **density** → `MessageRow`: comfortable = current paddings + 36px avatar; compact = tighter vertical padding (~py-0.5), smaller/aligned, follow-up rows tighter. Thread it via the prefs hook (MessageRow reads `useChatPrefs`), no prop drilling required.
- **timeFormat** → the timestamp formatters (`formatTime`/lead-time) honor 12h/24h. Centralize in one helper the message components call.
- **toolbarDefault** → `ChatComposer` initial `showToolbar` from pref.
- **sendOnEnter** → `ChatComposer` keydown: true → Enter sends, Shift+Enter newline; false → Enter newline, Cmd/Ctrl+Enter sends.
- **sound** → gate the ping in `useDmRealtime`/`dmSoundContext` on `sound !== false`.
- **desktopNotifications** → when true + permission granted + document hidden, `useDmRealtime` fires a `new Notification(...)` for incoming messages (request permission on enable). Frontend-only.
- **dmListShowAll** → `ChannelSidebar` default for `includeAllPeople` when query empty (true shows everyone). Search still surfaces all regardless.

## Panel UI

`src/components/chat/slack/PreferencesModal.jsx` — uses existing `ModalWrapper`. Two sections (Appearance, Behavior) with labeled rows: segmented controls for enums (theme/density/timeFormat/sendOnEnter), a swatch row for sidebarTheme (5 color tiles, selected ring), toggles for booleans. Reads/writes via `useChatPrefs`. Opened from `WorkspaceHeader` "Preferences" → ChatPage holds `prefsOpen` state.

## Tests
`src/lib/__tests__/chatPrefs.test.js` — defaults, set/get round-trip, per-profile scoping, corrupt JSON tolerance, subscribe fires. `timeFormat` helper test (12h vs 24h). Keep full suite green.
