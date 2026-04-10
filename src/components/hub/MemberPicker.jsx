import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { X } from 'lucide-react'

export default function MemberPicker({ existingIds, onSelect, onCancel }) {
  const [search, setSearch]     = useState('')
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    if (!search.trim()) { setResults([]); return }
    const timeout = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
        .not('id', 'in', `(${existingIds.join(',')})`)
        .limit(8)
      setResults(data || [])
      setLoading(false)
    }, 300)
    return () => clearTimeout(timeout)
  }, [search, existingIds])

  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="form-input flex-1 text-xs py-1.5"
          autoFocus
        />
        <button onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-600">
          <X size={16} />
        </button>
      </div>
      {loading && <p className="text-xs text-slate-400 px-1">Searching...</p>}
      {results.length > 0 && (
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="flex items-center gap-2 w-full py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-dark-hover text-left transition-colors"
            >
              {p.avatar_url ? (
                <img src={p.avatar_url} className="w-6 h-6 rounded-full" alt="" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
                  {p.full_name?.[0] || '?'}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{p.full_name}</p>
                <p className="text-xs text-slate-400 truncate">{p.email}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      {search.trim() && !loading && results.length === 0 && (
        <p className="text-xs text-slate-400 px-1">No users found.</p>
      )}
    </div>
  )
}
