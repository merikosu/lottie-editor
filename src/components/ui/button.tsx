import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes, ComponentType, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import type { IconProps } from '@/commands/registry'
import { Tooltip } from './tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const base =
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,color,box-shadow] duration-100 disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0'

// Filled buttons draw the focus ring outside: the accent outline would vanish on an accent fill.
const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover active:brightness-95 focus-visible:outline-offset-2',
  secondary:
    'bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--le-line-strong)] hover:bg-surface-3 active:bg-pressed',
  subtle: 'bg-hover text-fg hover:bg-pressed',
  ghost: 'text-fg-muted hover:bg-hover hover:text-fg active:bg-pressed',
  danger:
    'bg-danger text-white hover:brightness-110 active:brightness-95 focus-visible:outline-offset-2',
}

const sizes: Record<ButtonSize, string> = {
  xs: 'h-5 rounded-sm px-1.5 text-xs',
  sm: 'h-6 rounded-md px-2 text-sm',
  md: 'h-7 rounded-md px-2.5 text-sm',
  lg: 'h-8 rounded-md px-3 text-base',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ComponentType<IconProps>
  /** Render the child element instead of a <button> (Radix Slot). */
  asChild?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  asChild,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      type={asChild ? undefined : type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {Icon && <Icon size={size === 'xs' ? 12 : 14} />}
      {asChild
        ? children
        : children !== undefined &&
          children !== null && <span className="truncate">{children as ReactNode}</span>}
    </Comp>
  )
}

export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const iconSizes: Record<IconButtonSize, { box: string; icon: number }> = {
  xs: { box: 'size-5 rounded-sm', icon: 12 },
  sm: { box: 'size-6 rounded-md', icon: 14 },
  md: { box: 'size-7 rounded-md', icon: 16 },
  lg: { box: 'size-8 rounded-md', icon: 16 },
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ComponentType<IconProps>
  /** Accessible label; also shown as the tooltip. */
  label: string
  shortcut?: string
  size?: IconButtonSize
  /** Toggle-on state (e.g. loop enabled). */
  active?: boolean
  variant?: 'ghost' | 'secondary' | 'primary'
  tooltip?: boolean
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({
  icon: Icon,
  label,
  shortcut,
  size = 'sm',
  active,
  variant = 'ghost',
  tooltip = true,
  tooltipSide = 'bottom',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  const s = iconSizes[size]
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-active={active ? '' : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-[background-color,color] duration-100 select-none disabled:pointer-events-none disabled:opacity-35',
        s.box,
        variant === 'ghost' && 'text-fg-muted hover:bg-hover hover:text-fg active:bg-pressed',
        variant === 'secondary' &&
          'bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--le-line-strong)] hover:bg-surface-3',
        variant === 'primary' &&
          'bg-accent text-accent-fg hover:bg-accent-hover focus-visible:outline-offset-2',
        active && 'bg-accent-subtle text-accent-text hover:bg-accent-subtle hover:text-accent-text',
        className,
      )}
      {...props}
    >
      <Icon size={s.icon} />
    </button>
  )
  return tooltip ? (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}
