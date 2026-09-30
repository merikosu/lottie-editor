/**
 * Styled Radix menus. The same item components work in DropdownMenu and ContextMenu
 * (pass `kind`), so menus look identical everywhere.
 */
import { Check, ChevronRight } from 'lucide-react'
import {
  ContextMenu as RadixContextMenu,
  DropdownMenu as RadixDropdown,
  Menubar as RadixMenubar,
} from 'radix-ui'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { IconProps } from '@/commands/registry'
import { Kbd } from './kbd'

export const menuContentClass =
  'z-50 min-w-[200px] max-h-[var(--radix-dropdown-menu-content-available-height,80vh)] overflow-y-auto animate-pop-in rounded-lg bg-surface-3 p-1 text-sm text-fg shadow-popover outline-none'

export const menuItemClass =
  'group relative flex h-[26px] cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-fg'

const iconClass = 'shrink-0 text-fg-muted group-data-[highlighted]:text-accent-fg'

/* ------------------------------- Dropdown menu ------------------------------ */

export const DropdownMenu = RadixDropdown.Root
export const DropdownMenuTrigger = RadixDropdown.Trigger

export function DropdownMenuContent({
  children,
  className,
  align = 'start',
  side = 'bottom',
  sideOffset = 4,
  onCloseAutoFocus,
}: {
  children: ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  /** e.g. `e.preventDefault()` to keep focus in a field opened from the menu. */
  onCloseAutoFocus?: (e: Event) => void
}) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        align={align}
        side={side}
        sideOffset={sideOffset}
        onCloseAutoFocus={onCloseAutoFocus}
        collisionPadding={8}
        className={cn(menuContentClass, className)}
      >
        {children}
      </RadixDropdown.Content>
    </RadixDropdown.Portal>
  )
}

/* -------------------------------- Context menu ------------------------------ */

export const ContextMenu = RadixContextMenu.Root
export const ContextMenuTrigger = RadixContextMenu.Trigger

export function ContextMenuContent({
  children,
  className,
  onCloseAutoFocus,
}: {
  children: ReactNode
  className?: string
  /** e.g. `e.preventDefault()` to keep focus in a field opened from the menu. */
  onCloseAutoFocus?: (e: Event) => void
}) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content
        collisionPadding={8}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(menuContentClass, className)}
      >
        {children}
      </RadixContextMenu.Content>
    </RadixContextMenu.Portal>
  )
}

/* ---------------------------------- Menubar --------------------------------- */

export const Menubar = RadixMenubar.Root
export const MenubarMenu = RadixMenubar.Menu

export function MenubarTrigger({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <RadixMenubar.Trigger
      className={cn(
        'inline-flex h-7 items-center rounded-md px-2 text-sm text-fg-muted outline-none select-none hover:bg-hover hover:text-fg data-[highlighted]:bg-hover data-[highlighted]:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg',
        className,
      )}
    >
      {children}
    </RadixMenubar.Trigger>
  )
}

export function MenubarContent({
  children,
  className,
  onCloseAutoFocus,
}: {
  children: ReactNode
  className?: string
  /** `e.preventDefault()` keeps Radix from focusing the menubar trigger after closing. */
  onCloseAutoFocus?: (e: Event) => void
}) {
  return (
    <RadixMenubar.Portal>
      <RadixMenubar.Content
        align="start"
        sideOffset={4}
        collisionPadding={8}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(menuContentClass, 'min-w-[240px]', className)}
      >
        {children}
      </RadixMenubar.Content>
    </RadixMenubar.Portal>
  )
}

/* ------------------------------- Shared items ------------------------------- */

export type MenuKind = 'dropdown' | 'context' | 'menubar'
type Kind = MenuKind

// The three Radix menu families share the same item API; the casts pick one family's types.
const parts = (kind: Kind) =>
  (kind === 'context'
    ? RadixContextMenu
    : kind === 'menubar'
      ? RadixMenubar
      : RadixDropdown) as typeof RadixDropdown

export interface MenuItemProps {
  kind?: Kind
  icon?: ComponentType<IconProps>
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  onSelect?: (e: Event) => void
  children: ReactNode
  className?: string
}

export function MenuItem({
  kind = 'dropdown',
  icon: Icon,
  shortcut,
  disabled,
  danger,
  onSelect,
  children,
  className,
}: MenuItemProps) {
  const P = parts(kind)
  return (
    <P.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        menuItemClass,
        danger && 'text-danger data-[highlighted]:bg-danger data-[highlighted]:text-white',
        className,
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {Icon && (
          <Icon
            size={14}
            className={cn(iconClass, danger && 'text-danger group-data-[highlighted]:text-white')}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && (
        <Kbd shortcut={shortcut} className="pl-4 group-data-[highlighted]:text-accent-fg/80" />
      )}
    </P.Item>
  )
}

export interface MenuCheckboxItemProps extends Omit<MenuItemProps, 'icon' | 'danger'> {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function MenuCheckboxItem({
  kind = 'dropdown',
  checked,
  onCheckedChange,
  shortcut,
  disabled,
  children,
  onSelect,
}: MenuCheckboxItemProps) {
  const P = parts(kind)
  return (
    <P.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      onSelect={onSelect}
      className={menuItemClass}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        <P.ItemIndicator>
          <Check size={13} />
        </P.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && (
        <Kbd shortcut={shortcut} className="pl-4 group-data-[highlighted]:text-accent-fg/80" />
      )}
    </P.CheckboxItem>
  )
}

export function MenuRadioGroup({
  kind = 'dropdown',
  value,
  onValueChange,
  children,
}: {
  kind?: Kind
  value: string
  onValueChange: (v: string) => void
  children: ReactNode
}) {
  const P = parts(kind)
  return (
    <P.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </P.RadioGroup>
  )
}

export function MenuRadioItem({
  kind = 'dropdown',
  value,
  children,
  disabled,
}: {
  kind?: Kind
  value: string
  children: ReactNode
  disabled?: boolean
}) {
  const P = parts(kind)
  return (
    <P.RadioItem value={value} disabled={disabled} className={menuItemClass}>
      <span className="flex w-4 shrink-0 items-center justify-center">
        <P.ItemIndicator>
          <span className="block size-1.5 rounded-full bg-current" />
        </P.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </P.RadioItem>
  )
}

export function MenuSeparator({ kind = 'dropdown' }: { kind?: Kind }) {
  const P = parts(kind)
  return <P.Separator className="mx-1 my-1 h-px bg-line-strong" />
}

export function MenuLabel({ kind = 'dropdown', children }: { kind?: Kind; children: ReactNode }) {
  const P = parts(kind)
  return (
    <P.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-fg-subtle">{children}</P.Label>
  )
}

export function MenuSub({
  kind = 'dropdown',
  label,
  icon: Icon,
  disabled,
  children,
}: {
  kind?: Kind
  label: ReactNode
  icon?: ComponentType<IconProps>
  disabled?: boolean
  children: ReactNode
}) {
  const P = parts(kind)
  return (
    <P.Sub>
      <P.SubTrigger
        disabled={disabled}
        className={cn(
          menuItemClass,
          'data-[state=open]:bg-hover data-[state=open]:data-[highlighted]:bg-accent',
        )}
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          {Icon && <Icon size={14} className={iconClass} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={12} className="shrink-0 opacity-60" />
      </P.SubTrigger>
      <P.Portal>
        <P.SubContent
          sideOffset={4}
          alignOffset={-4}
          collisionPadding={8}
          className={menuContentClass}
        >
          {children}
        </P.SubContent>
      </P.Portal>
    </P.Sub>
  )
}
