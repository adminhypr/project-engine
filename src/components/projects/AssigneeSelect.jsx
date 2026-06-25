// Compact assignee picker over a project's members. Used by the promote modals
// (Bug / Feature Request) and the Add-Feature flows so the creator can hand the
// new task to a teammate instead of it always defaulting to themselves. Plain
// <select> of member names — defaults are seeded by the caller (usually the
// current user). Members come from useProjectMembers (shape: { profile_id,
// profile: { id, full_name } }).
export default function AssigneeSelect({ members = [], value, onChange, className = '' }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className={`form-input ${className}`}
    >
      {members.length === 0 && <option value="">No members</option>}
      {members.map(m => (
        <option key={m.profile_id} value={m.profile_id}>
          {m.profile?.full_name || 'Unknown'}
        </option>
      ))}
    </select>
  )
}
