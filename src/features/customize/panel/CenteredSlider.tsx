import { Slider as RadixSlider } from 'radix-ui'
import { useRef } from 'react'
import type { ChangeGesture } from '@/components/ui'
import { uid } from '@/lib/id'
import { cn } from '@/lib/cn'

/**
 * Slider for a signed value around zero (e.g. a hue shift): the fill grows from the center tick
 * towards the thumb. Reports gestures like the design-system Slider (one key per drag).
 */
export function CenteredSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  'aria-label': ariaLabel,
}: {
  value: number
  onChange: (value: number, gesture: ChangeGesture) => void
  min: number
  max: number
  step?: number
  className?: string
  'aria-label'?: string
}) {
  const key = useRef<string | null>(null)
  const span = max - min
  const pos = ((value - min) / span) * 100
  const center = ((0 - min) / span) * 100
  return (
    <RadixSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => {
        key.current ??= uid('slider')
        onChange(v, { key: key.current, final: false })
      }}
      onValueCommit={([v]) => {
        onChange(v, { key: key.current ?? uid('slider'), final: true })
        key.current = null
      }}
      aria-label={ariaLabel}
      className={cn('relative flex h-4 w-full touch-none items-center select-none', className)}
    >
      <RadixSlider.Track className="relative h-[3px] grow rounded-full bg-line-strong">
        <span
          className="absolute inset-y-0 rounded-full bg-accent"
          style={{ left: `${Math.min(pos, center)}%`, width: `${Math.abs(pos - center)}%` }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-fg-faint"
          style={{ left: `${center}%` }}
        />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={ariaLabel}
        className="block size-3 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15),0_1px_3px_rgb(0_0_0/0.4)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-accent"
      />
    </RadixSlider.Root>
  )
}
