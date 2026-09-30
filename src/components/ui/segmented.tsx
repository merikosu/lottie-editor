import { ToggleGroup } from 'radix-ui'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { IconProps } from '@/commands/registry'
import { Tooltip } from './tooltip'

export interface SegmentOption<V extends string = string> {
  value: V
  label?: ReactNode
  icon?: ComponentType<IconProps>
  /** Tooltip (required for icon-only segments). */
  title?: string
  disabled?: boolean
}

export interface SegmentedControlProps<V extends string = string> {
  value: V
  onValueChange: (value: V) => void
  options: SegmentOption<V>[]
  size?: 'sm' | 'md'
  className?: string
  /** Stretch segments to fill the width. */
  fill?: boolean
  'aria-label'?: string
}

export function SegmentedControl<V extends string = string>({
  value,
  onValueChange,
  options,
  size = 'sm',
  className,
  fill,
  ...rest
}: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as V)}
      aria-label={rest['aria-label']}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-md bg-surface-2 p-0.5',
        size === 'sm' ? 'h-6' : 'h-7',
        fill && 'flex w-full',
        className,
      )}
    >
      {options.map((o) => {
        const Icon = o.icon
        const item = (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            aria-label={o.title ?? (typeof o.label === 'string' ? o.label : o.value)}
            className={cn(
              'inline-flex h-full min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-medium text-fg-subtle transition-colors duration-100 hover:text-fg disabled:opacity-40',
              // Active look keyed on aria-checked: a Tooltip trigger around the item overwrites data-state.
              'aria-checked:bg-surface-1 aria-checked:text-fg aria-checked:shadow-thumb dark:aria-checked:bg-surface-3',
              'aria-pressed:bg-surface-1 aria-pressed:text-fg aria-pressed:shadow-thumb dark:aria-pressed:bg-surface-3',
              Icon && !o.label && 'aspect-square px-0',
              fill && 'flex-1',
            )}
          >
            {Icon && <Icon size={14} />}
            {o.label && <span className="truncate">{o.label}</span>}
          </ToggleGroup.Item>
        )
        return o.title && !o.label ? (
          <Tooltip key={o.value} content={o.title}>
            {item}
          </Tooltip>
        ) : (
          item
        )
      })}
    </ToggleGroup.Root>
  )
}
