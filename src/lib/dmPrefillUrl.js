const KEY_TO_PARAM = {
  assigneeId: 'assignee',
  teamId:     'team',
  title:      'title',
  urgency:    'urgency',
  dueDate:    'due',
  notes:      'notes',
}

export function buildPrefillUrl(fields) {
  const params = new URLSearchParams()
  for (const [key, param] of Object.entries(KEY_TO_PARAM)) {
    const val = fields?.[key]
    if (val == null || val === '') continue
    params.append(param, val)
  }
  const qs = params.toString()
  return qs ? `/assign?${qs}` : '/assign'
}

export function parsePrefillParams(urlSearchParams) {
  const out = {}
  for (const [key, param] of Object.entries(KEY_TO_PARAM)) {
    const val = urlSearchParams.get(param)
    if (val !== null) out[key] = val
  }
  return out
}
