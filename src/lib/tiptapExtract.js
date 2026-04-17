function walk(node, visitor) {
  if (!node || typeof node !== 'object') return
  visitor(node)
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, visitor)
  }
}

export function extractMentionsFromDoc(doc) {
  if (!doc) return []
  const seen = new Set()
  const out = []
  walk(doc, node => {
    if (node.type === 'mention') {
      const id = node.attrs?.id
      const label = node.attrs?.label ?? ''
      if (id && !seen.has(id)) {
        seen.add(id)
        out.push({ user_id: id, display_name: label })
      }
    }
  })
  return out
}

export function extractImagesFromDoc(doc) {
  if (!doc) return []
  const out = []
  walk(doc, node => {
    if (node.type === 'image') {
      const attrs = node.attrs || {}
      const fileId = attrs['data-file-id']
      if (!fileId) return
      out.push({
        file_id: fileId,
        file_name: attrs['data-file-name'] ?? '',
        mime_type: attrs['data-mime'] ?? '',
        storage_path: attrs['data-storage-path'] ?? null,
      })
    }
  })
  return out
}
