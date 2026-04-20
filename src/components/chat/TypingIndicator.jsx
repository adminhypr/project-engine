export default function TypingIndicator({ name }) {
  return (
    <div className="px-3 pb-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce" />
      </span>
      <span className="truncate">{name || 'Someone'} is typing…</span>
    </div>
  )
}
