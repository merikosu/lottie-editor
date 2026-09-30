import { useRef, useState } from 'react'
import { Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * One-line label with a tooltip: `hint` when given, otherwise the full text but only when it is
 * cut off. Overflow is measured when the pointer arrives (nothing is observed off-screen).
 */
export function TruncatedLabel({
  text,
  hint,
  className,
}: {
  text: string
  hint?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const measure = () => {
    const el = ref.current
    setOverflowing(!!el && el.scrollWidth > el.clientWidth + 1)
  }
  const content = hint ?? (overflowing ? text : null)
  return (
    <Tooltip content={content} side="right" disabled={!content}>
      <span ref={ref} onPointerEnter={measure} className={cn('min-w-0 flex-1 truncate', className)}>
        {text}
      </span>
    </Tooltip>
  )
}
