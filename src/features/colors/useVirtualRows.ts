/**
 * Minimal windowing for lists with a few fixed row heights: only rows near the viewport are
 * rendered, so palettes with thousands of colors or usages stay responsive.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react'

export interface VirtualRows {
  /** First and last (inclusive) rendered row. */
  start: number
  end: number
  /** Top offset of every row, plus the total height as the last entry. */
  offsets: number[]
  total: number
}

function firstRowBelow(offsets: number[], y: number): number {
  let lo = 0
  let hi = offsets.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return Math.max(0, lo)
}

export function useVirtualRows(
  heights: readonly number[],
  scrollRef: RefObject<HTMLElement | null>,
  overscanPx = 240,
): VirtualRows {
  const [viewport, setViewport] = useState({ top: 0, height: 800 })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let frame = 0
    const measure = () => {
      frame = 0
      setViewport((v) =>
        v.top === el.scrollTop && v.height === el.clientHeight
          ? v
          : { top: el.scrollTop, height: el.clientHeight },
      )
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(onScroll)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scrollRef])

  const offsets = useMemo(() => {
    const out = [0]
    for (const h of heights) out.push(out[out.length - 1] + h)
    return out
  }, [heights])

  const total = offsets[offsets.length - 1]
  if (heights.length === 0) return { start: 0, end: -1, offsets, total }
  const start = firstRowBelow(offsets, viewport.top - overscanPx)
  const end = Math.min(
    heights.length - 1,
    firstRowBelow(offsets, viewport.top + viewport.height + overscanPx),
  )
  return { start, end, offsets, total }
}
