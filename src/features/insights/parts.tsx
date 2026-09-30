/**
 * Small visual building blocks shared by the Issues panel and the status bar readouts:
 * severity and support-level icons, and truncated text that explains itself in a tooltip.
 */
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip as RadixTooltip } from 'radix-ui'
import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { Level } from '@/lottie/compat'
import type { Severity } from '@/lottie/validate'
import { LEVEL_TEXT, SEVERITY_TEXT } from './tones'

const SEVERITY_ICONS: Record<Severity, LucideIcon> = {
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
}

export function SeverityIcon({
  severity,
  size = 14,
  className,
}: {
  severity: Severity
  size?: number
  className?: string
}) {
  const Icon = SEVERITY_ICONS[severity]
  return (
    <Icon size={size} aria-hidden className={cn('shrink-0', SEVERITY_TEXT[severity], className)} />
  )
}

const LEVEL_ICONS: Record<Level, LucideIcon> = {
  y: CircleCheck,
  x: CircleX,
  n: TriangleAlert,
  p: Info,
  '?': CircleHelp,
}

export function LevelIcon({
  level,
  size = 12,
  className,
}: {
  level: Level
  size?: number
  className?: string
}) {
  const Icon = LEVEL_ICONS[level]
  return <Icon size={size} aria-hidden className={cn('shrink-0', LEVEL_TEXT[level], className)} />
}

/**
 * Single-line text that shows its full content in a tooltip, only when it is actually cut off
 * (checked when the tooltip is about to open, so rows don't measure while rendering).
 */
export function TruncatedText({
  children,
  tooltip,
  className,
  side = 'left',
}: {
  children: ReactNode
  /** Tooltip text (defaults to the children). */
  tooltip?: ReactNode
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={(next) => {
        const el = ref.current
        setOpen(next && !!el && el.scrollWidth > el.clientWidth + 1)
      }}
    >
      <RadixTooltip.Trigger asChild>
        <span ref={ref} className={cn('min-w-0 truncate', className)}>
          {children}
        </span>
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-72 animate-fade-in rounded-md bg-surface-3 px-2 py-1 text-xs text-fg shadow-popover"
        >
          {tooltip ?? children}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
