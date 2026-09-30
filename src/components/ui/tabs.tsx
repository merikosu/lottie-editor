import { Tabs as RadixTabs } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem<V extends string = string> {
  value: V
  label: ReactNode
  /** Small counter/badge after the label. */
  badge?: ReactNode
}

interface TabsProps<V extends string = string> {
  value: V
  onValueChange: (value: V) => void
  items: TabItem<V>[]
  /** Right-aligned header content (actions). */
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Panel tabs: a 32px header with text tabs (active = bright), content below.
 * Put <TabPanel value="..."> elements as children.
 */
export function Tabs<V extends string = string>({
  value,
  onValueChange,
  items,
  actions,
  children,
  className,
}: TabsProps<V>) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(v) => onValueChange(v as V)}
      className={cn('flex h-full min-h-0 flex-col', className)}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
        <RadixTabs.List className="scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {items.map((item) => (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-subtle transition-colors duration-100 hover:text-fg-muted data-[state=active]:text-fg"
            >
              {item.label}
              {item.badge}
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {children}
    </RadixTabs.Root>
  )
}

/**
 * Content of one tab. It is not a tab stop of its own (Radix makes it one by default): every
 * panel starts with controls, so Tab goes from the tab list straight to them.
 */
export function TabPanel({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  return (
    <RadixTabs.Content
      value={value}
      tabIndex={-1}
      className={cn(
        'min-h-0 flex-1 overflow-hidden outline-none data-[state=inactive]:hidden',
        className,
      )}
    >
      {children}
    </RadixTabs.Content>
  )
}
