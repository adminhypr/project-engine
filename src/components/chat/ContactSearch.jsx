import { Search } from 'lucide-react'

export default function ContactSearch({ value, onChange }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search people"
        className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  )
}
