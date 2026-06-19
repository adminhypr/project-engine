// Pure text-insertion helpers for the chat composer formatting toolbar.
// Operate on a textarea's current value + selection range and return the new
// value plus the caret/selection to restore. No DOM access here so they stay
// trivially unit-testable.

export function wrapSelection(text, start, end, marker) {
  const sel = text.slice(start, end);
  const out = text.slice(0, start) + marker + sel + marker + text.slice(end);
  return { text: out, selStart: start + marker.length, selEnd: end + marker.length };
}

export function prefixLines(text, start, end, prefix) {
  const before = text.slice(0, start);
  const region = text.slice(start, end);
  const after = text.slice(end);
  const lines = region.split('\n').map((ln, i) =>
    (typeof prefix === 'function' ? prefix(i) : prefix) + ln);
  const out = before + lines.join('\n') + after;
  return { text: out, selStart: start, selEnd: before.length + lines.join('\n').length };
}
