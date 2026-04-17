import ContactRow from './ContactRow'

function Section({ title, rows, presence, onOpen }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="mb-2">
      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {rows.map(row => (
        <ContactRow
          key={row.profile.id}
          row={row}
          online={presence.get(row.profile.id)?.online || false}
          onClick={onOpen}
        />
      ))}
    </div>
  )
}

export default function ContactList({ sections, presence, onOpen }) {
  const empty =
    sections.recent.length === 0 &&
    sections.teammates.length === 0 &&
    sections.company.length === 0

  if (empty) {
    return (
      <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        No people to show.
      </div>
    )
  }

  return (
    <div className="py-1">
      <Section title="Recent"    rows={sections.recent}    presence={presence} onOpen={onOpen} />
      <Section title="Teammates" rows={sections.teammates} presence={presence} onOpen={onOpen} />
      <Section title="Company"   rows={sections.company}   presence={presence} onOpen={onOpen} />
    </div>
  )
}
