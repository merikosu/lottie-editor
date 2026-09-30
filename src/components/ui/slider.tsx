import { Slider as RadixSlider } from 'radix-ui'
import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/id'
import type { ChangeGesture } from './gesture'

export interface SliderProps {
  value: number
  onChange: (value: number, gesture: ChangeGesture) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  className,
  ...rest
}: SliderProps) {
  const key = useRef<string | null>(null)
  return (
    <RadixSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([v]) => {
        if (!key.current) key.current = uid('slider')
        onChange(v, { key: key.current, final: false })
      }}
      onValueCommit={([v]) => {
        onChange(v, { key: key.current ?? uid('slider'), final: true })
        key.current = null
      }}
      className={cn(
        'relative flex h-4 w-full touch-none items-center select-none data-[disabled]:opacity-40',
        className,
      )}
      aria-label={rest['aria-label']}
    >
      <RadixSlider.Track className="relative h-[3px] grow overflow-hidden rounded-full bg-line-strong">
        <RadixSlider.Range className="absolute h-full bg-accent" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={rest['aria-label']}
        className="block size-3 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15),0_1px_3px_rgb(0_0_0/0.4)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-accent"
      />
    </RadixSlider.Root>
  )
}
