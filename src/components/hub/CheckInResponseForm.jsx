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
