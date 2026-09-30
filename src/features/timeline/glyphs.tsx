/**
 * Keyframe glyphs and tiny easing curves.
 *
 * A keyframe glyph shows the interpolation on each side of the key, like After Effects:
 * the left half is the arriving segment, the right half the leaving one.
 * Diamond = linear, round = eased (bezier), square = hold.
 */
import { cn } from '@/lib/cn'
import type { BezierCurve } from '@/lottie/easing'
import { easingPath, type Interp } from './interp'

const HALVES: Record<Interp, [string, string]> = {
  linear: ['M5 0.6 L0.6 5 L5 9.4 Z', 'M5 0.6 L9.4 5 L5 9.4 Z'],
  eased: ['M5 1 A4 4 0 0 0 5 9 Z', 'M5 1 A4 4 0 0 1 5 9 Z'],
  hold: ['M5 1.3 H1.3 V8.7 H5 Z', 'M5 1.3 H8.7 V8.7 H5 Z'],
}

export type GlyphTone = 'normal' | 'selected' | 'summary' | 'summarySelected' | 'muted'

const FILL: Record<GlyphTone, string> = {
  normal: 'fill-fg-muted group-hover/key:fill-fg',
  selected: 'fill-accent',
  summary: 'fill-fg-subtle group-hover/key:fill-fg-muted',
  summarySelected: 'fill-accent',
  muted: 'fill-fg-faint',
}

const STROKE: Record<GlyphTone, string> = {
  normal: 'stroke-surface-1',
  selected: 'stroke-white/90',
  summary: 'stroke-surface-1',
  summarySelected: 'stroke-white/80',
  muted: 'stroke-surface-1',
}

/**
 * A keyframe glyph. The outline is painted under the fill so the two halves meet without a
 * seam while a thin outer ring separates neighbouring keys.
 */
export function KeyGlyph({
  sides = ['linear', 'linear'],
  tone = 'normal',
  size = 11,
  className,
}: {
  sides?: [Interp, Interp]
  tone?: GlyphTone
  size?: number
  className?: string
}) {
  const [left] = HALVES[sides[0]]
  const [, right] = HALVES[sides[1]]
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -1 12 12"
      aria-hidden
      className={cn('shrink-0 overflow-visible', className)}
    >
      <g className={STROKE[tone]} strokeWidth={2} strokeLinejoin="round" fill="none">
        <path d={left} />
        <path d={right} />
      </g>
      <g className={cn('transition-[fill] duration-100', FILL[tone])}>
        <path d={left} />
        <path d={right} />
      </g>
    </svg>
  )
}

/** Tiny easing curve drawn in the middle of a segment when there is room. */
export function EasingGlyph({
  curve,
  className,
}: {
  curve: BezierCurve | null
  className?: string
}) {
  return (
    <svg
      width={18}
      height={12}
      viewBox="-1 -2 18 14"
      aria-hidden
      className={cn('shrink-0 overflow-visible', className)}
    >
      <path
        d={easingPath(curve, 16, 10)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
      />
    </svg>
  )
}
