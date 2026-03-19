import { exportToCSV } from '../../lib/helpers'
import { Download } from 'lucide-react'

export default function ExportBtn({ data, filename }) {
  return (
    <div className="flex justify-end mb-3">
      <button
        onClick={() => exportToCSV(data, filename)}
        className="btn-secondary text-xs py-1.5 px-3"
      >
        <Download size={13} /> Export CSV
      </button>
    </div>
  )
}
