/**
 * Playback controls of the comparison: play/pause, the scrub track and the current frame. The
 * track marks the frames the visual check rendered (amber where it found a difference). Values
 * are written to the DOM on every frame; React only renders when play/pause flips.
 */
import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { IconButton } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/format'
import type { VisualReport } from '@/lottie/optimizer'
import type { FrameClock, FrameRange } from './clock'

/** Share of differing pixels above which a checked frame is marked (the check's default). */
const MARK_SHARE = 0.001

export function Transport({
  clock,
  range,
  visual,
}: {
  clock: FrameClock
  /** Frames of the animation shown (rendered from props: the clock is updated in an effect). */
  range: FrameRange
  visual?: VisualReport
}) {
  const t = useT()
  const [playing, setPlaying] = useState(clock.playing)
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const frameRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      clock.subscribe((frame, isPlaying) => {
        setPlaying(isPlaying)
        const { ip, fps } = clock.bounds
        const span = Math.max(1, clock.last - ip)
        const share = Math.min(1, Math.max(0, (frame - ip) / span))
        if (thumbRef.current) thumbRef.current.style.left = `${share * 100}%`
        if (fillRef.current) fillRef.current.style.width = `${share * 100}%`
        if (timeRef.current) timeRef.current.textContent = formatTimecode(frame - ip, fps)
        // The nearest whole frame (playback runs between frames; never past the last one).
        const shown = String(Math.min(Math.floor(clock.last), Math.round(frame)))
        if (frameRef.current) frameRef.current.textContent = shown
        if (inputRef.current) inputRef.current.value = shown
      }),
    [clock],
  )

  const seekAt = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    const share = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)))
    const { ip } = clock.bounds
    clock.seek(Math.round(ip + share * (clock.last - ip)))
  }

  const dragging = useRef<number | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = e.pointerId
    clock.pause()
    seekAt(e.clientX)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current === e.pointerId) seekAt(e.clientX)
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current === e.pointerId) dragging.current = null
  }

  const ip = range.ip
  const last = Math.max(ip, range.op - 1)
  const span = Math.max(1, last - ip)
  const marks = visual
    ? visual.frames.map((frame, i) => ({ frame, share: visual.perFrame[i] ?? 0 }))
    : []

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-t border-line bg-surface-1 px-2">
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? t.optimizer.compare.pause : t.optimizer.compare.play}
        shortcut="space"
        onClick={() => clock.toggle()}
        data-testid="opt-play"
      />
      <span ref={timeRef} className="w-14 shrink-0 text-xs text-fg-muted tabular-nums" />
      <div
        ref={trackRef}
        className="group relative h-6 min-w-0 flex-1 cursor-pointer touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="opt-scrub"
      >
        {/* Keyboard and assistive technology use a native slider; the pointer uses the track. */}
        <input
          ref={inputRef}
          type="range"
          min={Math.floor(ip)}
          max={Math.floor(last)}
          step={1}
          defaultValue={Math.floor(clock.frame)}
          onChange={(e) => {
            clock.pause()
            clock.seek(Number(e.target.value))
          }}
          aria-label={t.optimizer.compare.scrub}
          className="peer sr-only"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-line-strong"
        >
          <div ref={fillRef} className="h-full rounded-full bg-fg-faint" />
        </div>
        {marks.map(({ frame, share }) => (
          <span
            key={frame}
            aria-hidden
            className={cn(
              'pointer-events-none absolute bottom-0 w-px -translate-x-1/2',
              share > MARK_SHARE ? 'h-2 bg-warning' : 'h-1 bg-fg-faint/60',
            )}
            style={{ left: `${((frame - ip) / span) * 100}%` }}
          />
        ))}
        <div
          ref={thumbRef}
          aria-hidden
          className="pointer-events-none absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_2px_var(--le-surface-1)] transition-transform duration-100 group-hover:scale-125 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
        />
      </div>
      <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
        <span ref={frameRef} className="text-fg-muted" />
        <span className="px-0.5">/</span>
        {Math.floor(last)}
      </span>
    </div>
  )
}
