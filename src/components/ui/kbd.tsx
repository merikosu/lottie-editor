import { cn } from '@/lib/cn'
import { formatShortcut, shortcutKeys } from '@/commands/shortcuts'

interface KbdProps {
  shortcut: string
  /** 'plain' for menus/tooltips, 'caps' renders each key as a keycap. */
  variant?: 'plain' | 'caps'
  className?: string
}

/** Displays a keyboard shortcut in the platform's notation (⌘⇧Z / Ctrl+Shift+Z). */
export function Kbd({ shortcut, variant = 'plain', className }: KbdProps) {
  if (variant === 'plain') {
    return (
      <kbd className={cn('font-sans text-xs tracking-wide text-fg-subtle tabular-nums', className)}>
        {formatShortcut(shortcut)}
      </kbd>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {shortcutKeys(shortcut).map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-surface-2 px-1 font-sans text-2xs font-medium text-fg-muted shadow-[inset_0_-1px_0_var(--le-line-strong)]"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}
