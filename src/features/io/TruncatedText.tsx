import { useRef, useState } from 'react'
import { Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * Single-line text that shows its full value in a tooltip only when it is cut off. Overflow is
 * measured when the pointer arrives, so nothing is observed while the text is off-screen.
 */
export function TruncatedText({
  text,
  className,
  side = 'bottom',
}: {
  text: string
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  const measure = () => {
    const inner = wrapRef.current?.firstElementChild as HTMLElement | null | undefined
    setOverflowing(!!inner && inner.scrollWidth > inner.clientWidth + 1)
  }

  return (
    <span ref={wrapRef} className="flex min-w-0" onPointerEnter={measure}>
      <Tooltip content={text} side={side} disabled={!overflowing}>
        <span className={cn('min-w-0 truncate', className)}>{text}</span>
      </Tooltip>
    </span>
  )
}
