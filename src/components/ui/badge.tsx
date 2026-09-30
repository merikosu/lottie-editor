import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-hover text-fg-muted',
  accent: 'bg-accent-subtle text-accent-text',
  danger: 'bg-danger-subtle text-danger',
  warning: 'bg-warning-subtle text-warning',
  success: 'bg-success-subtle text-success',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-1 text-2xs font-semibold tabular-nums',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
