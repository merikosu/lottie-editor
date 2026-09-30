import type { ComponentType, ReactNode } from 'react'
import type { IconProps } from '@/commands/registry'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from '@/components/ui'

export interface PresetOption {
  value: string
  label: ReactNode
  /** Secondary text on the right (ratio, unit…). */
  hint?: ReactNode
}

interface PresetMenuProps {
  /** Tooltip / accessible name of the trigger. */
  label: string
  icon: ComponentType<IconProps>
  options: PresetOption[]
  /** Currently matching preset (shows a radio mark). */
  value?: string
  onSelect: (value: string) => void
  /** Extra actions under a separator (no radio mark). */
  actions?: PresetOption[]
  heading?: string
  disabled?: boolean
  align?: 'start' | 'end'
  testId?: string
}

function ItemBody({ option }: { option: PresetOption }) {
  return (
    <span className="flex w-full items-center justify-between gap-6">
      <span className="truncate tabular-nums">{option.label}</span>
      {option.hint && (
        <span className="shrink-0 text-xs text-fg-subtle tabular-nums group-data-[highlighted]:text-accent-fg/80">
          {option.hint}
        </span>
      )}
    </span>
  )
}

/** Small dropdown of preset values next to a field. */
export function PresetMenu({
  label,
  icon,
  options,
  value,
  onSelect,
  actions,
  heading,
  disabled,
  align = 'end',
  testId,
}: PresetMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <IconButton icon={icon} label={label} disabled={disabled} data-testid={testId} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[180px]">
        {heading && <MenuLabel>{heading}</MenuLabel>}
        <MenuRadioGroup value={value ?? ''} onValueChange={onSelect}>
          {options.map((o) => (
            <MenuRadioItem key={o.value} value={o.value}>
              <ItemBody option={o} />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {actions && actions.length > 0 && (
          <>
            <MenuSeparator />
            {actions.map((o) => (
              <MenuItem key={o.value} onSelect={() => onSelect(o.value)}>
                <ItemBody option={o} />
              </MenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
