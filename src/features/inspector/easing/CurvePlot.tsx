/**
 * Cubic-bezier curve editor: grid, linear reference, the curve and two draggable handles.
 * y may overshoot 0..1 (the view grows to show it after a drag); x is always 0..1.
 * Hold Shift while dragging to snap to 0.05. Keyboard users edit the same values through
 * the x1/y1/x2/y2 fields next to the plot.
 */
import { useRef, useState, type PointerEvent } from 'react'
import type { ChangeGesture } from '@/components/ui'
import type { BezierCurve } from '@/lottie/easing'
import { cn } from '@/lib/cn'
import { formatDecimal } from '@/lib/format'
import { uid } from '@/lib/id'
import { clamp, roundTo } from '@/lib/math'
import { useElementWidth } from '../hooks'
import { curveRange } from './geometry'

const HEIGHT = 156
const PAD_X = 12
const PAD_Y = 12
/** Pointer distance (px) within which a click on the plot grabs the nearest handle. */
const GRAB_RADIUS = 28

type Handle = 0 | 1

interface CurvePlotProps {
  curve: BezierCurve
  hold: boolean
  /** Motion-path segments: y stays within 0..1. */
  spatial: boolean
  onChange: (curve: BezierCurve, gesture: ChangeGesture) => void
  labels: { curve: string; out: string; in: string }
}

export function CurvePlot({ curve, hold, spatial, onChange, labels }: CurvePlotProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [dragging, setDragging] = useState<{ handle: Handle; range: [number, number] } | null>(null)
  const [hovered, setHovered] = useState<Handle | null>(null)
  const dragKey = useRef('')

  const [lo, hi] = dragging?.range ?? curveRange(curve)
  const plotW = Math.max(1, width - PAD_X * 2)
  const plotH = HEIGHT - PAD_Y * 2
  const X = (x: number) => PAD_X + x * plotW
  const Y = (y: number) => PAD_Y + ((hi - y) / (hi - lo)) * plotH

  const [x1, y1, x2, y2] = curve
  const handles: [number, number][] = [
    [x1, y1],
    [x2, y2],
  ]

  const constrainY = (y: number) => (spatial ? clamp(y, 0, 1) : clamp(y, -5, 6))

  const update = (handle: Handle, x: number, y: number, gesture: ChangeGesture, snap = false) => {
    const step = snap ? 0.05 : 0.001
    const nx = roundTo(clamp(Math.round(x / step) * step, 0, 1), 3)
    const ny = roundTo(constrainY(Math.round(y / step) * step), 3)
    const next: BezierCurve = handle === 0 ? [nx, ny, x2, y2] : [x1, y1, nx, ny]
    if (next.every((v, i) => v === curve[i])) return
    onChange(next, gesture)
  }

  const toCurve = (e: PointerEvent<SVGSVGElement>, range: [number, number]) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    return {
      x: (px - PAD_X) / plotW,
      y: range[1] - ((py - PAD_Y) / plotH) * (range[1] - range[0]),
      px,
      py,
    }
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (hold || e.button !== 0) return
    const { px, py } = toCurve(e, [lo, hi])
    let handle: Handle | null = null
    let best = GRAB_RADIUS
    handles.forEach(([hx, hy], i) => {
      const d = Math.hypot(X(hx) - px, Y(hy) - py)
      if (d <= best) {
        best = d
        handle = i as Handle
      }
    })
    if (handle === null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragKey.current = uid('ease')
    setDragging({ handle, range: [lo, hi] })
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const { x, y } = toCurve(e, dragging.range)
    update(dragging.handle, x, y, { key: dragKey.current, final: false }, e.shiftKey)
  }

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const { x, y } = toCurve(e, dragging.range)
    update(dragging.handle, x, y, { key: dragKey.current, final: true }, e.shiftKey)
    setDragging(null)
  }

  const gridLines = [0.25, 0.5, 0.75]
  const curvePath = hold
    ? `M${X(0)} ${Y(0)}H${X(1)}V${Y(1)}`
    : `M${X(0)} ${Y(0)}C${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)} ${X(1)} ${Y(1)}`

  return (
    <div ref={ref} className="relative h-[156px] w-full overflow-hidden rounded-md bg-surface-2">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          aria-label={labels.curve}
          className={cn(
            'absolute inset-0 block touch-none select-none',
            dragging && 'cursor-grabbing',
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* The 0..1 box: everything outside it is overshoot. */}
          <rect x={X(0)} y={Y(1)} width={plotW} height={Y(0) - Y(1)} className="fill-hover" />
          {gridLines.map((g) => (
            <g key={g} className="stroke-line" strokeWidth={1}>
              <line x1={X(g)} x2={X(g)} y1={Y(1)} y2={Y(0)} />
              <line x1={X(0)} x2={X(1)} y1={Y(g)} y2={Y(g)} />
            </g>
          ))}
          <line x1={X(0)} x2={X(1)} y1={Y(0)} y2={Y(0)} className="stroke-line-strong" />
          <line x1={X(0)} x2={X(1)} y1={Y(1)} y2={Y(1)} className="stroke-line-strong" />
          <line
            x1={X(0)}
            y1={Y(0)}
            x2={X(1)}
            y2={Y(1)}
            className="stroke-fg-faint"
            strokeDasharray="2 4"
            strokeLinecap="round"
          />
          {!hold && (
            <g className="stroke-fg-subtle" strokeWidth={1}>
              <line x1={X(0)} y1={Y(0)} x2={X(x1)} y2={Y(y1)} />
              <line x1={X(1)} y1={Y(1)} x2={X(x2)} y2={Y(y2)} />
            </g>
          )}
          <path
            d={curvePath}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={X(0)} cy={Y(0)} r={2.5} className="fill-fg-muted" />
          <circle cx={X(1)} cy={Y(1)} r={2.5} className="fill-fg-muted" />
          {!hold &&
            handles.map(([hx, hy], i) => {
              const active = dragging?.handle === i || (!dragging && hovered === i)
              return (
                <g key={i}>
                  {active && <circle cx={X(hx)} cy={Y(hy)} r={9} className="fill-accent-subtle" />}
                  <circle
                    cx={X(hx)}
                    cy={Y(hy)}
                    r={5}
                    strokeWidth={1.5}
                    onPointerEnter={() => setHovered(i as Handle)}
                    onPointerLeave={() => setHovered(null)}
                    className={cn(
                      'cursor-grab stroke-accent transition-[fill] duration-100',
                      active ? 'fill-accent' : 'fill-surface-1',
                    )}
                  >
                    <title>{`${i === 0 ? labels.out : labels.in}: ${formatDecimal(hx, 3)}; ${formatDecimal(hy, 3)}`}</title>
                  </circle>
                </g>
              )
            })}
        </svg>
      )}
    </div>
  )
}
