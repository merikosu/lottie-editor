/**
 * Toasts of the io feature. Only failures, long operations and restores are announced
 * (routine actions stay silent).
 */
import type { ReactNode } from 'react'
import { toast } from '@/components/ui'
import type { Message } from './messages'

function description(lines: string[]): ReactNode | undefined {
  if (!lines.length) return undefined
  if (lines.length === 1) return lines[0]
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  )
}

/** Same message → same toast id: repeating a failing action updates the toast instead of stacking copies. */
function idOf(message: Message): string {
  return `io:${message.title}\n${message.lines.join('\n')}`
}

/** A failure the user should know about. */
export function notifyError(message: Message): void {
  toast.error(message.title, {
    id: idOf(message),
    description: description(message.lines),
    duration: 9000,
  })
}

/** Something worked, with caveats (repairs, missing images). */
export function notifyWarning(message: Message): void {
  toast.warning(message.title, {
    id: idOf(message),
    description: description(message.lines),
    duration: 10_000,
  })
}

export interface ToastAction {
  label: string
  onClick: () => void
}

/** Neutral news with an optional action (restores, files added to Recent). */
export function notifyInfo(title: string, lines: string[] = [], action?: ToastAction): void {
  toast(title, { description: description(lines), duration: 8000, action })
}
