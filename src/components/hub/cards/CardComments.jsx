import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import RichInput from '../../ui/RichInput'
import RichContentRenderer from '../../ui/RichContentRenderer'
import { format, parseISO } from 'date-fns'

// Card comments use the polymorphic `comments` table (see migration 069/070).
// `mentioned_ids` is a uuid[] of profile ids — derived from RichInput's
// onSubmit `mentions: [{ user_id, display_name }]` shape.
export default function CardComments({ cardId, hubId }) {
  const { profile } = useAuth()
  const [comments, setComments] = useState([])
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const submitRef = useRef(null)

  const fetchComments = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('id, content, created_at, mentioned_ids, author:profiles!comments_author_id_fkey(id, full_name, avatar_url)')
      .eq('card_id', cardId)
      .order('created_at', { ascending: true })
    if (!error) setComments(data || [])
  }, [cardId])

  useEffect(() => { fetchComments() }, [fetchComments])

  useEffect(() => {
    const ch = supabase.channel(`card-comments-${cardId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `card_id=eq.${cardId}` },
        () => fetchComments()
      ).subscribe()
    return () => supabase.removeChannel(ch)
  }, [cardId, fetchComments])

  async function handleSubmit({ content, mentions }) {
    if (!content.trim() || !profile?.id || posting) return
    setPosting(true)
    const mentionedIds = (mentions || []).map(m => m.user_id).filter(Boolean)
    const { error } = await supabase.from('comments').insert({
      card_id: cardId,
      author_id: profile.id,
      content,
      mentioned_ids: mentionedIds,
    })
    setPosting(false)
    if (!error) { setDraft('') }
  }

  return (
    <div className="space-y-3">
      {comments.map(c => (
        <div key={c.id} className="flex gap-2">
          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden shrink-0">
            {c.author?.avatar_url
              ? <img src={c.author.avatar_url} alt="" className="w-full h-full object-cover" />
              : <span className="block text-[10px] font-bold text-slate-600 leading-7 text-center">{c.author?.full_name?.[0] || '?'}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">{c.author?.full_name}</span>
              <span className="text-xs text-slate-400">{format(parseISO(c.created_at), 'MMM d, h:mm a')}</span>
            </div>
            <div className="text-sm text-slate-700 dark:text-slate-200 mt-0.5">
              <RichContentRenderer content={c.content} />
            </div>
          </div>
        </div>
      ))}
      <div className="pt-2 border-t border-slate-100 dark:border-dark-border">
        <RichInput
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          submitRef={submitRef}
          hubId={hubId}
          enableMentions
          enableImages={false}
          placeholder="Write a comment…"
          rows={2}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => submitRef.current?.()}
            disabled={posting || !draft.trim()}
            className="btn btn-primary text-sm px-4 disabled:opacity-50"
          >
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
