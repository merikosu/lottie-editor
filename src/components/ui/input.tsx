import type { ComponentType, InputHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import type { IconProps } from '@/commands/registry'

import { fieldFrame, fieldSizes, type FieldSize } from './field'

export interface TextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'prefix'
> {
  size?: FieldSize
  icon?: ComponentType<IconProps>
  /** Content rendered after the input (units, buttons). */
  suffix?: ReactNode
  containerClassName?: string
  ref?: Ref<HTMLInputElement>
}

export function TextInput({
  size = 'sm',
  icon: Icon,
  suffix,
  className,
  containerClassName,
  disabled,
  ...props
}: TextInputProps) {
  return (
    <div
      className={cn(fieldFrame, fieldSizes[size], containerClassName)}
      aria-disabled={disabled || undefined}
    >
      {Icon && <Icon size={14} className="ml-1.5 shrink-0 text-fg-subtle" />}
      <input
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        className={cn(
          'h-full w-full min-w-0 bg-transparent px-2 text-inherit outline-none placeholder:text-fg-faint',
          Icon && 'pl-1.5',
          className,
        )}
        {...props}
      />
      {suffix && <div className="flex shrink-0 items-center pr-1.5 text-fg-subtle">{suffix}</div>}
    </div>
  )
}

export interface TextAreaProps extends InputHTMLAttributes<HTMLTextAreaElement> {
  rows?: number
  ref?: Ref<HTMLTextAreaElement>
}

export function TextArea({ className, rows = 3, ...props }: TextAreaProps) {
  return (
    <textarea
      rows={rows}
      spellCheck={false}
      className={cn(
        'w-full resize-y rounded-sm bg-surface-2 px-2 py-1.5 text-sm text-fg shadow-[inset_0_0_0_1px_transparent] transition-shadow outline-none placeholder:text-fg-faint hover:shadow-[inset_0_0_0_1px_var(--le-line-strong)] focus:shadow-[inset_0_0_0_1px_var(--le-accent)]',
        className,
      )}
      {...props}
    />
  )
}
