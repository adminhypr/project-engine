import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { emitMessage } from '../lib/dmEventBus'
import { playMessageSound } from '../lib/notificationSounds'
import { shouldPlaySoundFor, isConvMuted } from '../lib/dmSoundContext'
import { getPrefs } from '../lib/chatPrefs'

// Short plain-text preview for a desktop notification body. Strips obvious
// markdown markers and collapses whitespace, then truncates.
function notificationPreview(content) {
  const text = (content || '')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'Sent a message'
  return text.length > 140 ? `${text.slice(0, 139)}…` : text
}

export function useDmRealtime(profileId) {
  useEffect(() => {
    if (!profileId) return

    const channel = supabase
      .channel(`pe-dm-global-${profileId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages' },
        async (payload) => {
          const { data, error } = await supabase
            .from('dm_messages')
            .select('*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url), reply_to_author:profiles!dm_messages_reply_to_author_id_fkey(id, full_name)')
            .eq('id', payload.new.id)
            .maybeSingle()
          if (error || !data) return
          emitMessage(data.conversation_id, data)

          // Incoming user message only — not my own sends, not system messages
          // (task assignments etc. use the task sound).
          const incoming = data.author_id !== profileId && data.kind !== 'system'
          if (!incoming) return

          const prefs = getPrefs(profileId)

          // Sound — gated on the `sound` pref plus the existing muted /
          // actively-reading (maximised + tab visible) suppression.
          if (prefs.sound !== false && shouldPlaySoundFor(data.conversation_id)) {
            playMessageSound()
          }

          // Desktop notification — only when enabled, permission granted, the
          // tab is backgrounded, and the conversation isn't muted. Best-effort:
          // clicking focuses the window and deep-links to the conversation.
          if (
            prefs.desktopNotifications === true
            && typeof Notification !== 'undefined'
            && Notification.permission === 'granted'
            && typeof document !== 'undefined'
            && document.hidden
            && !isConvMuted(data.conversation_id)
          ) {
            try {
              const senderName = data.author?.full_name || 'New message'
              const n = new Notification(senderName, {
                body: notificationPreview(data.content),
                icon: data.author?.avatar_url || undefined,
                tag: `pe-dm-${data.conversation_id}`,
              })
              n.onclick = () => {
                try {
                  window.focus()
                  window.dispatchEvent(new CustomEvent('pe-chat-open', {
                    detail: { conversationId: data.conversation_id, messageId: data.id },
                  }))
                } catch { /* best-effort focus / navigate */ }
                n.close()
              }
            } catch { /* Notification can throw in some browsers */ }
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [profileId])
}
