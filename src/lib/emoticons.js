// Auto-convert common text emoticons to their emoji equivalents at render
// time. The raw text stays in the DB — this only runs in the renderer so
// we can adjust mappings later without migrations.
//
// Each rule requires the emoticon to be preceded by start-of-string or
// whitespace AND followed by end-of-string, whitespace, or light
// punctuation. This keeps URLs (http://, :3000), emails, and words like
// ":Dark" / "D:\\path" from getting mangled.

const RAW_RULES = [
  // Order matters when tokens share a prefix — put the longer token first so
  // `:'(` wins over `:(`, `:-)` wins over `:)`, etc.
  [":'(",  '😢'],
  ['xD',   '😆'],
  ['XD',   '😆'],
  [':-D',  '😄'],
  [':D',   '😄'],
  [':-)',  '🙂'],
  [':)',   '🙂'],
  [':-(',  '😞'],
  [':(',   '😞'],
  [':-P',  '😛'],
  [':P',   '😛'],
  [':-p',  '😛'],
  [':p',   '😛'],
  [';-)',  '😉'],
  [';)',   '😉'],
  [':-O',  '😮'],
  [':O',   '😮'],
  [':-o',  '😮'],
  [':o',   '😮'],
  [':-|',  '😐'],
  [':|',   '😐'],
  [':-/',  '😕'],
  [':/',   '😕'],
  [':-*',  '😘'],
  [':*',   '😘'],
  [':3',   '😺'],
  ['<3',   '❤️'],
  ['</3',  '💔'],
]

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const COMPILED = RAW_RULES.map(([token, emoji]) => [
  new RegExp(`(^|\\s)${escapeRegex(token)}(?=$|\\s|[,.!?])`, 'g'),
  `$1${emoji}`,
])

export function replaceEmoticons(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  let out = text
  for (const [re, sub] of COMPILED) out = out.replace(re, sub)
  return out
}
