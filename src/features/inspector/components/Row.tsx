/**
 * Inspector rows. Node views use a label column (`--insp-label`, set by the panel per
 * language) with a 16px gutter on the left for the keyframe button, so every label in the
 * panel starts at the same x whether or not the property is animatable.
 */
import { Tooltip as RadixTooltip } from 'radix-ui'
import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Truncated label that shows its full text (plus an optional hint) in a tooltip when needed. */
export function RowLabel({
  label,
  hint,
  className,
}: {
  label: string
  hint?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const onOpenChange = (next: boolean) => {
    if (next && !hint) {
      const el = ref.current
      if (!el || el.scrollWidth <= el.clientWidth + 1) return
    }
    setOpen(next)
  }
  return (
    <RadixTooltip.Root open={open} onOpenChange={onOpenChange}>
      <RadixTooltip.Trigger asChild>
        <span ref={ref} className={cn('min-w-0 flex-1 truncate text-xs text-fg-muted', className)}>
          {label}
        </span>
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="left"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 flex max-w-72 animate-fade-in flex-col gap-0.5 rounded-md bg-surface-3 px-2 py-1 text-xs text-fg shadow-popover"
        >
          <span>{label}</span>
          {hint && <span className="text-fg-muted">{hint}</span>}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

interface InspectorRowProps {
  label: string
  hint?: string
  /** Content of the 16px gutter (keyframe button); an empty spacer when omitted. */
  leading?: ReactNode
  /** Small element after the label (badges, toggles). */
  badge?: ReactNode
  children: ReactNode
  className?: string
  /** Align the label with the first line of tall controls (text areas, editors). */
  alignTop?: boolean
}

/** Label + controls row of the node views. */
export function InspectorRow({
  label,
  hint,
  leading,
  badge,
  children,
  className,
  alignTop,
}: InspectorRowProps) {
  return (
    <div
      className={cn(
        'grid min-h-6 grid-cols-[var(--insp-label)_minmax(0,1fr)] gap-2',
        alignTop ? 'items-start' : 'items-center',
        className,
      )}
    >
      <div className={cn('flex h-6 min-w-0 items-center gap-1')}>
        {leading ?? <span className="w-4 shrink-0" aria-hidden />}
        <RowLabel label={label} hint={hint} />
        {badge}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

/** Two equal columns for the value area (single numbers take the first one). */
export function ValueGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid w-full min-w-0 grid-cols-2 gap-1.5', className)}>{children}</div>
}

/** Small secondary line inside a section (notes, hints, warnings). */
export function Note({
  children,
  tone = 'muted',
  icon,
  className,
  action,
}: {
  children: ReactNode
  tone?: 'muted' | 'warning' | 'danger'
  icon?: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 text-xs',
        tone === 'muted' && 'text-fg-subtle',
        tone === 'warning' && 'text-warning',
        tone === 'danger' && 'text-danger',
        className,
      )}
    >
      {icon && <span className="mt-px flex h-4 shrink-0 items-center">{icon}</span>}
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
      {action}
    </div>
  )
}

/** Sub-heading inside a section (e.g. "Mask 1", "Dashes"). */
export function SubHeader({
  children,
  actions,
  className,
}: {
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex h-6 min-w-0 items-center gap-1 pt-1', className)}>
      <div className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{children}</div>
      {actions && <div className="-mr-1 flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  )
}

/** Section title followed by a quiet count ("Masks 2"), as in the Colors section. */
export function CountTitle({ title, count }: { title: ReactNode; count: number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      {title}
      {count > 0 && <span className="font-normal text-fg-subtle tabular-nums">{count}</span>}
    </span>
  )
}
