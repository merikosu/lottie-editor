/**
 * Icon-only segmented control with tooltips (caps, joins, alignment…), with a mixed state.
 */
import type { ComponentType } from 'react'
import { SegmentedControl } from '@/components/ui'
import type { IconProps } from '@/commands/registry'

export interface IconSegment<V extends string> {
  value: V
  icon: ComponentType<IconProps>
  title: string
}

export function IconSegmented<V extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  /** null = mixed (nothing highlighted). */
  value: V | null
  options: IconSegment<V>[]
  onChange: (value: V) => void
  label: string
  className?: string
}) {
  return (
    <SegmentedControl<V>
      // An empty value matches no segment: the mixed state of a multi-selection.
      value={(value ?? '') as V}
      onValueChange={onChange}
      options={options}
      aria-label={label}
      className={className}
    />
  )
}
