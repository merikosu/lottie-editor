import { Check, ChevronDown } from 'lucide-react'
import { Select as RadixSelect } from 'radix-ui'
import { useState, type ComponentType, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { IconProps } from '@/commands/registry'
import { fieldFrame, fieldSizes, type FieldSize } from './field'

export interface SelectOption<V extends string = string> {
  value: V
  label: ReactNode
  icon?: ComponentType<IconProps>
  disabled?: boolean
  /** Secondary text shown right-aligned in the list. */
  hint?: ReactNode
}

export interface SelectProps<V extends string = string> {
  value: V | undefined
  onValueChange: (value: V) => void
  options: SelectOption<V>[]
  placeholder?: string
  size?: FieldSize
  disabled?: boolean
  className?: string
  contentClassName?: string
  'aria-label'?: string
}

export function Select<V extends string = string>({
  value,
  onValueChange,
  options,
  placeholder,
  size = 'sm',
  disabled,
  className,
  contentClassName,
  ...rest
}: SelectProps<V>) {
  const current = options.find((o) => o.value === value)
  const Icon = current?.icon
  // Radix renders every item into a hidden fragment while closed (to label the value); with
  // long lists (e.g. 800 layers as parent candidates) that is costly, so items mount on open.
  const [open, setOpen] = useState(false)
  return (
    <RadixSelect.Root
      value={value}
      onValueChange={(v) => onValueChange(v as V)}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
    >
      <RadixSelect.Trigger
        aria-label={rest['aria-label']}
        className={cn(
          fieldFrame,
          fieldSizes[size],
          'w-full justify-between gap-1 px-2 text-left outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[placeholder]:text-fg-faint data-[state=open]:shadow-[inset_0_0_0_1px_var(--le-accent)]',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {Icon && <Icon size={14} className="shrink-0 text-fg-muted" />}
          <span className="truncate">
            <RadixSelect.Value placeholder={placeholder}>{current?.label}</RadixSelect.Value>
          </span>
        </span>
        <RadixSelect.Icon>
          <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      {open && (
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            collisionPadding={8}
            className={cn(
              'z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] animate-pop-in overflow-hidden rounded-lg bg-surface-3 p-1 shadow-popover',
              contentClassName,
            )}
          >
            <RadixSelect.Viewport>
              {options.map((o) => {
                const OptIcon = o.icon
                return (
                  <RadixSelect.Item
                    key={o.value}
                    value={o.value}
                    disabled={o.disabled}
                    className="relative flex h-[26px] cursor-default items-center gap-2 rounded-md pr-2 pl-6 text-sm text-fg outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-fg"
                  >
                    <RadixSelect.ItemIndicator className="absolute left-1.5 inline-flex">
                      <Check size={12} />
                    </RadixSelect.ItemIndicator>
                    {OptIcon && <OptIcon size={14} className="shrink-0 opacity-80" />}
                    <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                    {o.hint && <span className="ml-auto pl-4 text-xs opacity-60">{o.hint}</span>}
                  </RadixSelect.Item>
                )
              })}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      )}
    </RadixSelect.Root>
  )
}
