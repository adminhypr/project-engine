import { MessageCircle } from 'lucide-react'

export default function ChatLauncher({ totalUnread, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-14 h-14 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-elevated flex items-center justify-center transition-colors"
      aria-label="Open chat"
    >
      <MessageCircle className="w-6 h-6" />
      {totalUnread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-semibold flex items-center justify-center">
          {totalUnread > 99 ? '99+' : totalUnread}
        </span>
      )}
    </button>
  )
}
