import { useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useHubTodoSubscribers } from '../../../hooks/useHubTodoSubscribers'
import { useHubMembers } from '../../../hooks/useHubMembers'
import { Users, Plus, Check } from 'lucide-react'

export default function TodoSubscribers({ itemId, hubId }) {
  const { profile } = useAuth()
  const { subscribers, isSubscribed, subscribe, unsubscribe } = useHubTodoSubscribers(itemId)
  const { members } = useHubMembers(hubId)
  const [showPicker, setShowPicker] = useState(false)

  const subIds = new Set(subscribers.map(s => s.profile_id))

  async function toggleMember(mId) {
    if (subIds.has(mId)) await unsubscribe(mId)
    else await subscribe(mId)
  }

  return (
    <div className="border-t border-slate-100 dark:border-dark-border pt-5">
      <div className="flex items-center gap-2 mb-3">
        <Users size={14} className="text-slate-400" />
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Subscribers</h4>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        {subscribers.length === 0
          ? 'No one will be notified about new comments.'
          : `${subscribers.length} ${subscribers.length === 1 ? 'person' : 'people'} will be notified when someone comments.`}
      </p>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        {subscribers.map(s => {
          const p = s.profile
          if (!p) return null
          return p.avatar_url ? (
            <img key={p.id} src={p.avatar_url} title={p.full_name} alt="" className="w-7 h-7 rounded-full ring-2 ring-white dark:ring-dark-card" />
          ) : (
            <div key={p.id} title={p.full_name} className="w-7 h-7 rounded-full bg-brand-500 ring-2 ring-white dark:ring-dark-card flex items-center justify-center text-white text-[10px] font-bold">
              {p.full_name?.[0] || '?'}
            </div>
          )
        })}
        <button
          onClick={() => setShowPicker(v => !v)}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-dark-hover"
        >
          <Plus size={11} />
          Add/remove people
        </button>
      </div>

      {showPicker && (
        <div className="mb-4 p-2 rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card max-h-60 overflow-y-auto space-y-0.5">
          {members.map(m => {
            const p = m.profile || m
            if (!p?.id) return null
            const selected = subIds.has(p.id)
            return (
              <button
                key={p.id}
                onClick={() => toggleMember(p.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm hover:bg-slate-50 dark:hover:bg-dark-hover ${selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}
              >
                {p.avatar_url ? (
                  <img src={p.avatar_url} className="w-6 h-6 rounded-full" alt="" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-[10px] font-bold">
                    {p.full_name?.[0] || '?'}
                  </div>
                )}
                <span className="flex-1 text-slate-700 dark:text-slate-300 truncate">{p.full_name}</span>
                {selected && <Check size={14} className="text-brand-500 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-dark-border">
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {isSubscribed ? "You're subscribed" : "You're not subscribed"}
        </span>
        {isSubscribed ? (
          <button onClick={() => unsubscribe()} className="btn btn-ghost text-xs px-2 py-1">Unsubscribe me</button>
        ) : (
          <button onClick={() => subscribe()} className="btn btn-secondary text-xs px-2 py-1">Subscribe me</button>
        )}
      </div>
    </div>
  )
}
