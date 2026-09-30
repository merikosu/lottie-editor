/**
 * Snapping a dragged selection (pure): its left/center/right and top/middle/bottom lines stick
 * to the edges and centers of the artboard and of the other objects on it when they come within
 * a few screen pixels, the way design tools align objects.
 */
import type { Point, Rect } from './geometry'

/** A line to snap to: its position on one axis and the extent it covers on the other. */
export interface SnapLine {
  at: number
  from: number
  to: number
}

export interface SnapLines {
  /** Vertical lines (x positions; extents along y), document coordinates. */
  x: readonly SnapLine[]
  /** Horizontal lines (y positions; extents along x), document coordinates. */
  y: readonly SnapLine[]
}

/** A guide to draw: the line snapped to, spanning its targets and the dragged selection. */
export type SnapGuide = SnapLine

export interface SnapResult {
  /** The drag offset after snapping. */
  offset: Point
  guides: { x: SnapGuide | null; y: SnapGuide | null }
}

/** Lines closer than this are the same line (their guides merge). */
const SAME = 1e-3

/** Edges and center lines of an artboard of `w` × `h`. */
export function artboardLines(w: number, h: number): SnapLines {
  return {
    x: [0, w / 2, w].map((at) => ({ at, from: 0, to: h })),
    y: [0, h / 2, h].map((at) => ({ at, from: 0, to: w })),
  }
}

/** Edges and center lines of objects (their bounds). */
export function rectLines(rects: readonly Rect[]): SnapLines {
  const x: SnapLine[] = []
  const y: SnapLine[] = []
  for (const r of rects) {
    for (const at of [r.x, r.x + r.width / 2, r.x + r.width])
      x.push({ at, from: r.y, to: r.y + r.height })
    for (const at of [r.y, r.y + r.height / 2, r.y + r.height])
      y.push({ at, from: r.x, to: r.x + r.width })
  }
  return { x, y }
}

export function mergeLines(...sets: readonly SnapLines[]): SnapLines {
  return { x: sets.flatMap((s) => s.x), y: sets.flatMap((s) => s.y) }
}

/** The nearest line within `threshold` of any of `values`, as the correction to apply. */
function nearest(values: readonly number[], lines: readonly SnapLine[], threshold: number) {
  let best: { delta: number; at: number } | null = null
  for (const line of lines) {
    for (const v of values) {
      const delta = line.at - v
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, at: line.at }
      }
    }
  }
  return best
}

/** Guide at `at`: every line there (several objects may share it) and the dragged extent. */
function guide(lines: readonly SnapLine[], at: number, from: number, to: number): SnapGuide {
  let lo = from
  let hi = to
  for (const line of lines) {
    if (Math.abs(line.at - at) > SAME) continue
    lo = Math.min(lo, line.from)
    hi = Math.max(hi, line.to)
  }
  return { at, from: lo, to: hi }
}

/**
 * Snaps a drag: `bounds` is the dragged selection when the drag started, `offset` the raw drag
 * offset, `threshold` the snapping distance in document units. `lock` keeps an axis fixed
 * (Shift-constrained drags): it neither snaps nor moves.
 */
export function snapOffset(
  bounds: Rect,
  offset: Point,
  lines: SnapLines,
  threshold: number,
  lock: 'x' | 'y' | null = null,
): SnapResult {
  const xs = [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width].map(
    (v) => v + offset.x,
  )
  const ys = [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height].map(
    (v) => v + offset.y,
  )
  const sx = lock === 'x' ? null : nearest(xs, lines.x, threshold)
  const sy = lock === 'y' ? null : nearest(ys, lines.y, threshold)
  const moved = { x: offset.x + (sx?.delta ?? 0), y: offset.y + (sy?.delta ?? 0) }
  const top = bounds.y + moved.y
  const left = bounds.x + moved.x
  return {
    offset: moved,
    guides: {
      x: sx ? guide(lines.x, sx.at, top, top + bounds.height) : null,
      y: sy ? guide(lines.y, sy.at, left, left + bounds.width) : null,
    },
  }
}
