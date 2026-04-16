export const TODO_LIST_COLORS = {
  blue:   'bg-brand-500',
  green:  'bg-green-500',
  red:    'bg-red-500',
  yellow: 'bg-yellow-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
  gray:   'bg-slate-400',
}

export const todoColorKeys = ['blue','green','red','yellow','purple','orange','gray']

export function todoColorClass(key) {
  return TODO_LIST_COLORS[key] || TODO_LIST_COLORS.blue
}
