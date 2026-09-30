import { Tooltip as RadixTooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from './kbd'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={250}>
      {children}
    </RadixTooltip.Provider>
  )
}

interface TooltipProps {
  content: ReactNode
  shortcut?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** Disable the tooltip (renders children only). */
  disabled?: boolean
  children: ReactNode
  className?: string
}

/**
 * How the user last interacted. Focus that follows a pointer action (a menu item chosen with
 * the mouse hands focus back to its trigger) must not pop the trigger's tooltip, even when the
 * browser counts that focus as :focus-visible.
 */
let lastInput: 'keyboard' | 'pointer' = 'keyboard'
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => (lastInput = 'pointer'), true)
  window.addEventListener('keydown', () => (lastInput = 'keyboard'), true)
}

/** Compact tooltip with an optional shortcut hint. The child must accept a ref. */
export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  align = 'center',
  disabled,
  children,
  className,
}: TooltipProps) {
  if (disabled || (!content && !shortcut)) return <>{children}</>
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger
        asChild
        onFocus={(e) => {
          // Only keyboard focus opens the tooltip (hover opens it anyway); preventing default
          // makes Radix skip its own open-on-focus handler.
          const keyboard =
            lastInput === 'keyboard' && (e.currentTarget as Element).matches(':focus-visible')
          if (!keyboard) e.preventDefault()
        }}
      >
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 flex max-w-72 animate-fade-in items-center gap-2 rounded-md bg-surface-3 px-2 py-1 text-xs text-fg shadow-popover',
            className,
          )}
        >
          <span>{content}</span>
          {shortcut && <Kbd shortcut={shortcut} />}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
