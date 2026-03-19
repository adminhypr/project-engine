export function generateTaskId() {
  return 'T-' + Date.now().toString(36).toUpperCase().slice(-6)
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

export function daysBetween(a, b) {
  return Math.round(Math.abs(new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24))
}

export function exportToCSV(data, filename) {
  if (!data.length) return
  const Papa = window.Papa
  if (!Papa) {
    const keys    = Object.keys(data[0])
    const csvRows = [keys.join(',')]
    data.forEach(row => {
      csvRows.push(keys.map(k => JSON.stringify(row[k] ?? '')).join(','))
    })
    downloadFile(csvRows.join('\n'), filename, 'text/csv')
    return
  }
  const csv = Papa.unparse(data)
  downloadFile(csv, filename, 'text/csv')
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
