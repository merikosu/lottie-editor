/**
 * Layout building blocks for panels and the inspector.
 */
import { ChevronRight } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { IconProps } from '@/commands/registry'
import { toggleSection, usePrefs } from '@/store/prefs'
import { Tooltip } from './tooltip'

/** 32px panel header with a title and right-aligned actions. */
export function PanelHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3',
        className,
      )}
    >
      <div className="min-w-0 truncate text-xs font-semibold text-fg">{title}</div>
      {actions && <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  )
}

interface SectionProps {
  /** Unique id used to remember the collapsed state. */
  id: string
  title: ReactNode
  /** Buttons shown on the right of the header (e.g. "+" to add). */
  actions?: ReactNode
  children: ReactNode
  /** Start collapsed (until the user toggles it). */
  defaultCollapsed?: boolean
  /** Disable collapsing. */
  static?: boolean
  className?: string
  contentClassName?: string
}

/** Collapsible inspector section separated by hairlines. */
export function Section({
  id,
  title,
  actions,
  children,
  defaultCollapsed = false,
  static: isStatic,
  className,
  contentClassName,
}: SectionProps) {
  const stored = usePrefs((s) => s.collapsedSections[id])
  const collapsed = !isStatic && (stored ?? defaultCollapsed)
  return (
    <section className={cn('border-b border-line', className)}>
      <div className="flex h-8 items-center gap-1 pr-1.5 pl-2">
        {isStatic ? (
          <div className="flex min-w-0 flex-1 items-center pl-1 text-xs font-semibold text-fg">
            {title}
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => toggleSection(id, !collapsed)}
            className="group flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md text-left text-xs font-semibold text-fg"
          >
            <ChevronRight
              size={12}
              className={cn(
                'shrink-0 text-fg-subtle transition-transform duration-150 group-hover:text-fg-muted',
                !collapsed && 'rotate-90',
              )}
            />
            <span className="truncate">{title}</span>
          </button>
        )}
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {!collapsed && (
        <div className={cn('flex flex-col gap-1.5 px-3 pb-3', contentClassName)}>{children}</div>
      )}
    </section>
  )
}

interface FieldRowProps {
  label: ReactNode
  /** Full description shown as tooltip on the label. */
  hint?: string
  children: ReactNode
  /** Controls placed before the label (e.g. keyframe toggles). */
  leading?: ReactNode
  className?: string
  labelClassName?: string
}

/** Label + control row with a fixed label column (inspector layout). */
export function FieldRow({
  label,
  hint,
  children,
  leading,
  className,
  labelClassName,
}: FieldRowProps) {
  const labelNode = (
    <span className={cn('min-w-0 truncate text-xs text-fg-muted', labelClassName)}>{label}</span>
  )
  return (
    <div
      className={cn('grid min-h-6 grid-cols-[84px_minmax(0,1fr)] items-center gap-2', className)}
    >
      <div className="flex min-w-0 items-center gap-1">
        {leading}
        {hint ? (
          <Tooltip content={hint} side="left">
            {labelNode}
          </Tooltip>
        ) : (
          labelNode
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

interface EmptyStateProps {
  icon?: ComponentType<IconProps>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

/** Quiet, centered placeholder for empty panels. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-32 flex-col items-center justify-center gap-1.5 px-6 py-8 text-center',
        className,
      )}
    >
      {Icon && <Icon size={20} className="mb-1 text-fg-faint" />}
      <div className="text-sm font-medium text-fg-muted">{title}</div>
      {description && <div className="max-w-60 text-xs text-fg-subtle">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Thin horizontal divider. */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px shrink-0 bg-line', className)} />
}
