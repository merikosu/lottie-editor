/**
 * Windowing for a list of fixed-height rows inside a scroll container: only rows in view
 * (plus a margin) are rendered. State changes only when the visible range changes.
 */
import { useEffect, useState, type RefObject } from 'react'

export interface RowRange {
  start: number
  /** Exclusive. */
  end: number
}

/** Visible range for a scroll position; pure (exported for tests). */
export function visibleRange(
  scrollTop: number,
  viewport: number,
  count: number,
  rowHeight: number,
  overscan: number,
): RowRange {
  if (count <= 0) return { start: 0, end: 0 }
  const top = Math.max(0, scrollTop)
  // Scrolled past the end (the list just shrank): keep the last rows.
  const first = Math.min(count - 1, Math.floor(top / rowHeight))
  const last = Math.ceil((top + Math.max(0, viewport)) / rowHeight)
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, Math.max(last, first + 1) + overscan),
  }
}

export function useVirtualRows(
  scrollRef: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan = 8,
  /** Offset of the rows from the top of the scroll content (padding). */
  offset = 0,
): RowRange {
  const [range, setRange] = useState<RowRange>(() => ({ start: 0, end: Math.min(count, 40) }))

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const next = visibleRange(el.scrollTop - offset, el.clientHeight, count, rowHeight, overscan)
      setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [scrollRef, count, rowHeight, overscan, offset])

  return range
}

/** Scroll position that brings row `index` into view with the least movement (null: in view). */
export function scrollToReveal(
  index: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  offset = 0,
): number | null {
  const top = offset + index * rowHeight
  const bottom = top + rowHeight
  if (top < scrollTop) return Math.max(0, top - offset)
  if (bottom > scrollTop + viewport) return bottom - viewport + offset
  return null
}
