/** Real files sometimes store names as numbers (or other junk): always a trimmed string. */
export function nameText(nm: unknown): string {
  if (typeof nm === 'string') return nm.trim()
  if (typeof nm === 'number' && Number.isFinite(nm)) return String(nm)
  return ''
}
