import { useAuth } from '../../hooks/useAuth'
import { useProfiles } from '../../hooks/useTasks'
import { ChevronDown } from 'lucide-react'

const STORAGE_KEY = 'pe-hub-team'

export function getStoredTeamId() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

export function HubTeamSelector({ teamId, setTeamId, teams }) {
  if (!teams || teams.length <= 1) return null

  function handleChange(e) {
    const id = e.target.value
    setTeamId(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch {}
  }

  return (
    <div className="relative">
      <select
        value={teamId || ''}
        onChange={handleChange}
        className="form-input pr-8 text-sm font-medium appearance-none cursor-pointer"
      >
        {teams.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  )
}
