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
