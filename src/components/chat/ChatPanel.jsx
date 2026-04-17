import { X } from 'lucide-react'

export default function ChatPanel({ onClose, children }) {
  return (
    <div className="w-[360px] h-[520px] bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 dark:border-dark-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Chat</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
