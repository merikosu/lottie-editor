import type { ReactNode } from 'react'

/** Renders `text` with the characters at `positions` (ascending indices) emphasized. */
export function Highlight({ text, positions }: { text: string; positions: readonly number[] }) {
  if (!positions.length) return <>{text}</>
  const marked = new Set(positions)
  const parts: ReactNode[] = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    // Close a run where the matched state changes (or at the end).
    if (i < text.length && marked.has(i) === marked.has(start)) continue
    const chunk = text.slice(start, i)
    parts.push(
      marked.has(start) ? (
        <mark key={start} className="bg-transparent font-semibold text-inherit">
          {chunk}
        </mark>
      ) : (
        chunk
      ),
    )
    start = i
  }
  return <>{parts}</>
}
