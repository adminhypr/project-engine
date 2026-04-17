export default function PresenceDot({ online, className = '' }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-dark-card ${
        online ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'
      } ${className}`}
      aria-label={online ? 'Online' : 'Offline'}
    />
  )
}
