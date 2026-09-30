import { Checkbox as RadixCheckbox, Switch as RadixSwitch } from 'radix-ui'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}

export function Switch({ checked, onCheckedChange, disabled, className, ...rest }: SwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        // The focus ring sits outside: inside it would disappear on the accent fill when on.
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-line-strong transition-colors duration-150 focus-visible:outline-offset-2 disabled:opacity-40 data-[state=checked]:bg-accent',
        className,
      )}
      {...rest}
    >
      <RadixSwitch.Thumb className="block size-3 translate-x-0.5 rounded-full bg-white shadow-thumb transition-transform duration-150 data-[state=checked]:translate-x-[14px]" />
    </RadixSwitch.Root>
  )
}

export interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...rest
}: CheckboxProps) {
  return (
    <RadixCheckbox.Root
      checked={checked}
      onCheckedChange={(c) => onCheckedChange(c === true)}
      disabled={disabled}
      className={cn(
        'inline-flex size-3.5 shrink-0 items-center justify-center rounded-xs shadow-[inset_0_0_0_1px_var(--le-line-strong)] transition-colors focus-visible:outline-offset-1 disabled:opacity-40 data-[state=checked]:bg-accent data-[state=checked]:shadow-none data-[state=indeterminate]:bg-accent data-[state=indeterminate]:shadow-none',
        className,
      )}
      {...rest}
    >
      <RadixCheckbox.Indicator className="text-accent-fg">
        {checked === 'indeterminate' ? (
          <Minus size={10} strokeWidth={3} />
        ) : (
          <Check size={10} strokeWidth={3} />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}
