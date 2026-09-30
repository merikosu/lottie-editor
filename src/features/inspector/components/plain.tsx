/**
 * Non-animatable inspector rows (selects, switches, segmented controls, plain numbers).
 * They share the node-view grid so labels line up with animatable rows.
 */
import type { ReactNode } from 'react'
import {
  SegmentedControl,
  Select,
  Switch,
  type ChangeGesture,
  type SegmentOption,
  type SelectOption,
} from '@/components/ui'
import { NumberField } from './number-field'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { InspectorRow, ValueGrid } from './Row'

interface RowBase {
  label: string
  hint?: string
  disabled?: boolean
  className?: string
}

export function SelectRow<V extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
  className,
}: RowBase & {
  /** null = mixed (multi-selection). */
  value: V | null | undefined
  options: SelectOption<V>[]
  onChange: (value: V) => void
}) {
  const t = useT()
  return (
    <InspectorRow label={label} hint={hint} className={className}>
      <Select<V>
        value={value ?? undefined}
        onValueChange={onChange}
        options={options}
        placeholder={value === null ? t.common.mixed : undefined}
        disabled={disabled}
        aria-label={label}
        className="data-[disabled]:opacity-50"
      />
    </InspectorRow>
  )
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  className,
  extra,
}: RowBase & {
  /** null = mixed. */
  checked: boolean | null
  onChange: (checked: boolean) => void
  extra?: ReactNode
}) {
  const t = useT()
  return (
    <InspectorRow label={label} hint={hint} className={className}>
      <Switch
        checked={checked === true}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
      {checked === null && <span className="text-xs text-fg-subtle">{t.common.mixed}</span>}
      {extra}
    </InspectorRow>
  )
}

export function SegmentRow<V extends string>({
  label,
  hint,
  value,
  options,
  onChange,
  className,
}: RowBase & {
  value: V | null
  options: SegmentOption<V>[]
  onChange: (value: V) => void
}) {
  return (
    <InspectorRow label={label} hint={hint} className={className}>
      <SegmentedControl<V>
        value={(value ?? '') as V}
        onValueChange={onChange}
        options={options}
        fill
        aria-label={label}
        className="w-full"
      />
    </InspectorRow>
  )
}

export function NumberRow({
  label,
  hint,
  value,
  onChange,
  unit,
  precision = 0,
  step = 1,
  min,
  max,
  disabled,
  wide,
  className,
  after,
}: RowBase & {
  value: number | null
  onChange: (value: number, gesture: ChangeGesture) => void
  unit?: string
  precision?: number
  step?: number
  min?: number
  max?: number
  wide?: boolean
  /** Content placed in the second column (when not wide). */
  after?: ReactNode
}) {
  return (
    <InspectorRow label={label} hint={hint} className={className}>
      <ValueGrid>
        <NumberField
          className={cn(wide && 'col-span-2')}
          value={value}
          onChange={onChange}
          suffix={unit}
          precision={precision}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          aria-label={label}
        />
        {!wide && after}
      </ValueGrid>
    </InspectorRow>
  )
}

/** Two numbers on one row (e.g. width/height, in/out). */
export function NumberPairRow({
  label,
  hint,
  values,
  labels,
  onChange,
  unit,
  precision = 0,
  step = 1,
  min,
  max,
  disabled,
  className,
  badge,
  labelHints,
}: RowBase & {
  values: [number | null, number | null]
  labels: [string, string]
  /** Full names shown as tooltips on the short labels. */
  labelHints?: [string, string]
  onChange: (index: 0 | 1, value: number, gesture: ChangeGesture) => void
  unit?: string
  precision?: number
  step?: number
  min?: [number | undefined, number | undefined]
  max?: [number | undefined, number | undefined]
  badge?: ReactNode
}) {
  return (
    <InspectorRow label={label} hint={hint} className={className} badge={badge}>
      <ValueGrid>
        {([0, 1] as const).map((i) => (
          <NumberField
            key={i}
            label={labels[i]}
            labelTooltip={labelHints?.[i] ?? labels[i]}
            value={values[i]}
            onChange={(v, g) => onChange(i, v, g)}
            suffix={unit}
            precision={precision}
            step={step}
            min={min?.[i]}
            max={max?.[i]}
            disabled={disabled}
          />
        ))}
      </ValueGrid>
    </InspectorRow>
  )
}
