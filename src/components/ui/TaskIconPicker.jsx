import {
  FileText, Phone, Mail, Users, Code, Palette, Camera, Megaphone,
  DollarSign, BarChart2, Briefcase, Wrench, Truck, BookOpen,
  Globe, Shield, Heart, Zap, Target, Flag, Star, Lightbulb,
  Headphones, Package, Search, Send, Clock, CalendarCheck
} from 'lucide-react'

export const TASK_ICONS = {
  FileText, Phone, Mail, Users, Code, Palette, Camera, Megaphone,
  DollarSign, BarChart2, Briefcase, Wrench, Truck, BookOpen,
  Globe, Shield, Heart, Zap, Target, Flag, Star, Lightbulb,
  Headphones, Package, Search, Send, Clock, CalendarCheck
}

export const ICON_LABELS = {
  FileText: 'Document',
  Phone: 'Call',
  Mail: 'Email',
  Users: 'Meeting',
  Code: 'Dev',
  Palette: 'Design',
  Camera: 'Media',
  Megaphone: 'Marketing',
  DollarSign: 'Finance',
  BarChart2: 'Report',
  Briefcase: 'Business',
  Wrench: 'Maintenance',
  Truck: 'Delivery',
  BookOpen: 'Research',
  Globe: 'Web',
  Shield: 'Security',
  Heart: 'HR',
  Zap: 'Urgent',
  Target: 'Goal',
  Flag: 'Milestone',
  Star: 'Review',
  Lightbulb: 'Idea',
  Headphones: 'Support',
  Package: 'Product',
  Search: 'Audit',
  Send: 'Outreach',
  Clock: 'Deadline',
  CalendarCheck: 'Scheduled',
}

export function TaskIcon({ name, size = 18, className = '' }) {
  const Icon = TASK_ICONS[name]
  if (!Icon) return null
  return <Icon size={size} className={className} />
}

export default function TaskIconPicker({ value, onChange }) {
  const icons = Object.entries(TASK_ICONS)

  return (
    <div>
      <div className="grid grid-cols-7 sm:grid-cols-14 gap-1">
        {icons.map(([name, Icon]) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(value === name ? '' : name)}
            title={ICON_LABELS[name] || name}
            className={`p-2 rounded-lg transition-all duration-100 flex items-center justify-center
              ${value === name
                ? 'bg-brand-500 text-white shadow-sm scale-110'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-dark-hover'
              }`}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      {value && (
        <p className="text-xs text-brand-500 mt-1.5">{ICON_LABELS[value] || value}</p>
      )}
    </div>
  )
}
