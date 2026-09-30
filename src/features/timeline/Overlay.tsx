/**
 * Everything drawn above the rows: dimming outside the work area, the playhead (head + line),
 * the snap guide, the selection bracket, the marquee, drag feedback and the scrollbar.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { getKeyframes } from '@/lottie/property'
import { getAt } from '@/lottie/path'
import type { AnyProperty } from '@/lottie/property'
import { useDocument } from '@/store/document'
import { useIntegerFrame, usePlayback } from '@/store/playback'
import { mapForPath } from './actions'
import { useController, useMetrics } from './context'
import { formatFrame, frameToX, HEADER_H, RULER_H } from './geometry'
import { useTimelineView } from './store'

function Dims() {
  const { ip, op, ppf, contentWidth } = useMetrics()
  const workArea = usePlayback((s) => s.workArea)
  const x = (f: number) => frameToX(f, ip, ppf)
  const spans: [number, number][] = [
    [0, x(ip)],
    [x(op), contentWidth],
  ]
  if (workArea) {
    spans.push([x(ip), x(Math.max(ip, workArea.start))])
    spans.push([x(Math.min(op, workArea.end)), x(op)])
  }
  return (
    <>
      {spans
        .filter(([a, b]) => b - a > 0.5)
        .map(([a, b]) => (
          <div
            key={`${a}-${b}`}
            className="absolute bottom-0 bg-canvas/55"
            style={{ left: a, width: b - a, top: HEADER_H }}
          />
        ))}
      {/* Crisp boundary at the animation's out point. */}
      <div
        className="absolute bottom-0 w-px bg-line-strong"
        style={{ left: x(op), top: HEADER_H }}
      />
    </>
  )
}

function PlayheadLabel() {
  const frame = useIntegerFrame()
  return <>{formatFrame(frame)}</>
}

function Playhead() {
  const ctl = useController()
  const scrubbing = useTimelineView((s) => s.scrubbing)
  return (
    <div
      ref={(el) => ctl.attachPlayhead(el)}
      className="absolute top-0 bottom-0 left-0 w-0 will-change-transform"
    >
      <div
        className="absolute bottom-0 left-[-0.5px] w-px bg-accent"
        style={{ top: RULER_H - 6 }}
      />
      {scrubbing ? (
        <div
          className="absolute left-0 flex h-4 min-w-6 -translate-x-1/2 items-center justify-center rounded-sm bg-accent px-1 text-2xs font-semibold text-accent-fg tabular-nums shadow-thumb"
          style={{ top: RULER_H - 17 }}
        >
          <PlayheadLabel />
        </div>
      ) : (
        <svg
          width="11"
          height="12"
          viewBox="0 0 11 12"
          className="pointer-events-auto absolute left-0 -translate-x-1/2 cursor-ew-resize"
          style={{ top: RULER_H - 13 }}
          onPointerDown={(e) => ctl.onRulerPointerDown(e)}
          aria-hidden
        >
          <path
            d="M1.5 0.5 H9.5 A1 1 0 0 1 10.5 1.5 V7 L5.5 11.5 L0.5 7 V1.5 A1 1 0 0 1 1.5 0.5 Z"
            className="fill-accent"
          />
        </svg>
      )}
    </div>
  )
}

function SnapGuide() {
  const { ip, ppf } = useMetrics()
  const frame = useTimelineView((s) => s.snapFrame)
  if (frame === null) return null
  return (
    <div
      className="absolute top-0 bottom-0 w-px -translate-x-1/2 bg-accent/80"
      style={{ left: frameToX(frame, ip, ppf) }}
      aria-hidden
    />
  )
}

/** Time span of the selected keys, in root frames (null with fewer than two distinct times). */
function useSelectionSpan(): [number, number] | null {
  const keyframes = useDocument((s) => s.selection.keyframes)
  const doc = useDocument((s) => s.doc)
  if (!doc || keyframes.length < 2) return null
  let lo = Infinity
  let hi = -Infinity
  for (const ref of keyframes) {
    const kf = getKeyframes(getAt<AnyProperty>(doc, ref.path))?.[ref.index]
    const map = kf ? mapForPath(doc, ref.path) : null
    if (!kf || !map?.linear) continue
    const t = map.toRoot(kf.t)
    lo = Math.min(lo, t)
    hi = Math.max(hi, t)
  }
  return hi - lo > 0.5 ? [lo, hi] : null
}

/**
 * A thin bracket over the selected keys' span. Dragging an end scales their timing around
 * the other end.
 */
function SelectionBracket() {
  const t = useT()
  const ctl = useController()
  const { ip, ppf } = useMetrics()
  const span = useSelectionSpan()
  if (!span) return null
  const a = frameToX(span[0], ip, ppf)
  const b = frameToX(span[1], ip, ppf)
  const handle = (side: 'start' | 'end') => (
    <Tooltip content={t.timeline.rows.scaleHandle} side="top">
      <div
        className="pointer-events-auto absolute top-0 flex h-full w-2.5 cursor-ew-resize items-center justify-center"
        style={{ [side === 'start' ? 'left' : 'right']: -5 }}
        onPointerDown={(e) => ctl.onBracketPointerDown(e, side, span)}
      >
        <span className="h-full w-[3px] rounded-full bg-accent/80 group-hover/bracket:bg-accent" />
      </div>
    </Tooltip>
  )
  // Straddles the border under the marker lane: visible whatever the rows scroll to.
  return (
    <div
      className="group/bracket absolute h-[7px]"
      style={{ left: a, width: b - a, top: HEADER_H - 4 }}
    >
      <div className="absolute inset-x-0 top-[3px] h-px bg-accent/60" />
      {handle('start')}
      {handle('end')}
    </div>
  )
}

function Marquee() {
  const rect = useTimelineView((s) => s.marquee)
  if (!rect) return null
  return (
    <div
      className="pointer-events-none fixed z-30 rounded-[2px] border border-accent/80 bg-accent/10"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    />
  )
}

function Feedback() {
  const feedback = useTimelineView((s) => s.feedback)
  if (!feedback) return null
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md bg-surface-3 px-2 py-1 text-xs whitespace-pre text-fg tabular-nums shadow-popover"
      style={{ left: feedback.x + 14, top: feedback.y - 34 }}
    >
      {feedback.text}
    </div>
  )
}

/** Thin horizontal scrollbar for the tracks (shown only when zoomed in). */
function HScrollbar() {
  const ctl = useController()
  const { viewWidth, contentWidth } = useMetrics()
  const thumb = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const scrollable = contentWidth > viewWidth + 1 && viewWidth > 0
  const thumbWidth = scrollable ? Math.max(28, (viewWidth / contentWidth) * viewWidth) : 0

  useEffect(() => {
    if (!scrollable) return
    const update = () => {
      const max = contentWidth - viewWidth
      const left = max > 0 ? (ctl.scrollX / max) * (viewWidth - thumbWidth) : 0
      if (thumb.current) thumb.current.style.transform = `translateX(${left}px)`
    }
    update()
    return ctl.onScroll(update)
  }, [ctl, scrollable, contentWidth, viewWidth, thumbWidth])

  if (!scrollable) return null
  return (
    <div
      className="pointer-events-auto absolute right-0 bottom-0 left-0 h-2.5"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget || e.button !== 0) return
        // Click on the track pages towards the pointer.
        const rect = e.currentTarget.getBoundingClientRect()
        const at = ((e.clientX - rect.left) / rect.width) * contentWidth - viewWidth / 2
        ctl.setScrollX(at)
      }}
    >
      <div
        ref={thumb}
        className={cn(
          'absolute bottom-[3px] left-0 rounded-full bg-line-strong transition-[height,background-color] duration-100',
          hover ? 'h-1.5 bg-fg-faint' : 'h-1',
        )}
        style={{ width: thumbWidth }}
        onPointerDown={(e) => ctl.onScrollThumbPointerDown(e, viewWidth, thumbWidth)}
      />
    </div>
  )
}

export const Overlay = memo(function Overlay() {
  const { namesWidth, contentWidth, scrollbar } = useMetrics()
  return (
    <>
      <div
        className="pointer-events-none absolute top-0 bottom-0 z-10 overflow-hidden"
        style={{ left: namesWidth, right: scrollbar }}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: contentWidth, transform: 'translateX(var(--sx))' }}
        >
          <Dims />
          <SnapGuide />
          <SelectionBracket />
          <Playhead />
        </div>
        <HScrollbar />
      </div>
      <Marquee />
      <Feedback />
    </>
  )
})
