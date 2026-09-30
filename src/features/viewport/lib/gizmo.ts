/**
 * The transform gizmo of a selected layer or group, in view pixels (pure).
 *
 * The gizmo is the node's content box as drawn on screen: a parallelogram (the box through the
 * node's rotation, scale, skew and parents) with eight handles. Handles are named after their
 * place on the content box (`nw` = its top-left corner), so a flipped or rotated node keeps its
 * names while their screen positions move.
 *
 * What a press grabs, in order:
 *   resize  a handle, or anywhere along an edge (a few pixels inside and outside of it)
 *   rotate  just outside a corner
 *   inside  within the box (a drag moves the selection)
 * Tolerances are screen pixels; inside a small box they shrink so the middle can still be
 * grabbed to move it.
 *
 * A box with no visible thickness (a straight stroke: its geometry has no height, or less than
 * a screen pixel) is a line: handles at its two ends resize its length, the band along it moves
 * it, and it turns from just past its ends. Its thickness is its stroke, which a scale across it
 * would only distort.
 */
import type { Quad } from './geometry'
import type { Point } from './matrix'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type CornerId = 'nw' | 'ne' | 'se' | 'sw'

/** Place of each handle on the content box: u across (0 left, 1 right), v down (0 top, 1 bottom). */
export const HANDLE_UV: Readonly<Record<HandleId, readonly [number, number]>> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
}

export const HANDLE_IDS: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
export const CORNER_IDS: readonly CornerId[] = ['nw', 'ne', 'se', 'sw']

export function isCorner(handle: HandleId): handle is CornerId {
  return handle.length === 2
}

/** Sizes in CSS pixels. */
export const GIZMO = {
  /** Visible handle square, 1px border included. */
  handle: 7,
  /** Edge midpoint handles are hidden when a side of the box is shorter than this. */
  edgeHandlesMin: 28,
  /** Reach of an edge's grab zone outside the box. */
  edgeOutside: 5,
  /** Reach of an edge's grab zone inside the box (less in small boxes). */
  edgeInside: 4,
  /** Across a box thinner than this the edges are grabbed from outside only (it moves). */
  thin: 12,
  /** Radius around a corner where a press outside the box rotates. */
  rotateRadius: 16,
  /** A box thinner than this across (a straight stroke) is a line. */
  line: 1,
} as const

export type GizmoHit =
  { kind: 'resize'; handle: HandleId } | { kind: 'rotate'; corner: CornerId } | { kind: 'inside' }

/** A point of the box given by its place (u, v) on the content box. */
export function quadPoint(q: Quad, u: number, v: number): Point {
  const [o, x, , y] = q
  return {
    x: o.x + u * (x.x - o.x) + v * (y.x - o.x),
    y: o.y + u * (x.y - o.y) + v * (y.y - o.y),
  }
}

export function handlePoint(q: Quad, handle: HandleId): Point {
  const [u, v] = HANDLE_UV[handle]
  return quadPoint(q, u, v)
}

/** Lengths of the box's sides on screen: along its content x axis and y axis. */
export function quadSides(q: Quad): { width: number; height: number } {
  const [o, x, , y] = q
  return { width: Math.hypot(x.x - o.x, x.y - o.y), height: Math.hypot(y.x - o.x, y.y - o.y) }
}

/** Edge midpoint handles are drawn on boxes large enough to tell them from the corners. */
export function showsEdgeHandles(q: Quad): boolean {
  const { width, height } = quadSides(q)
  return width >= GIZMO.edgeHandlesMin && height >= GIZMO.edgeHandlesMin
}

/** Distances on screen between the box's left and right edges, and its top and bottom edges. */
function spans(q: Quad): { across: number; down: number } {
  const [o, x, , y] = q
  const det = Math.abs((x.x - o.x) * (y.y - o.y) - (x.y - o.y) * (y.x - o.x))
  const { width, height } = quadSides(q)
  return { across: height > 0 ? det / height : 0, down: width > 0 ? det / width : 0 }
}

/** A box seen as a line: the middles of its two ends, and the handles there. */
interface Line {
  a: Point
  b: Point
  ends: readonly [HandleId, HandleId]
}

/**
 * The box as a line when it has no visible thickness (less than GIZMO.line across, e.g. the
 * geometry of a straight horizontal stroke has no height): along its content x axis (ends `w`
 * and `e`) or its y axis (`n` and `s`). Null for a box with an area, or a dot.
 */
function lineOf(q: Quad): Line | null {
  const { width, height } = quadSides(q)
  const { across, down } = spans(q)
  // Along x: its length is the distance between the left and right edges (the whole top side
  // when the box has no height), its thickness the distance between the top and bottom edges.
  const lengthX = height > 0 ? across : width
  if (lengthX >= GIZMO.line && down < GIZMO.line)
    return { a: quadPoint(q, 0, 0.5), b: quadPoint(q, 1, 0.5), ends: ['w', 'e'] }
  const lengthY = width > 0 ? down : height
  if (lengthY >= GIZMO.line && across < GIZMO.line)
    return { a: quadPoint(q, 0.5, 0), b: quadPoint(q, 0.5, 1), ends: ['n', 's'] }
  return null
}

/**
 * The handles drawn on a box: corners, plus edge midpoints on large boxes. A thin box (a line,
 * a bar) shows one handle at each end instead of two corners on top of each other: its ends
 * resize its length.
 */
export function gizmoHandleIds(q: Quad): readonly HandleId[] {
  const line = lineOf(q)
  if (line) return line.ends
  const { across, down } = spans(q)
  const thinAcross = across < GIZMO.thin
  const thinDown = down < GIZMO.thin
  if (thinDown && !thinAcross) return ['w', 'e']
  if (thinAcross && !thinDown) return ['n', 's']
  return showsEdgeHandles(q) ? HANDLE_IDS : CORNER_IDS
}

interface Frame {
  /** Place of the point on the content box (0..1 inside). */
  s: number
  t: number
  /** Distance between the box's left and right edges, and between its top and bottom edges. */
  across: number
  down: number
}

/** The point in the box's own frame, or null for a degenerate (flat) box. */
function frameOf(q: Quad, p: Point): Frame | null {
  const [o, x, , y] = q
  const ux = x.x - o.x
  const uy = x.y - o.y
  const vx = y.x - o.x
  const vy = y.y - o.y
  const det = ux * vy - uy * vx
  const lu = Math.hypot(ux, uy)
  const lv = Math.hypot(vx, vy)
  if (!(Math.abs(det) > 1e-6) || lu === 0 || lv === 0) return null
  const dx = p.x - o.x
  const dy = p.y - o.y
  return {
    s: (dx * vy - dy * vx) / det,
    t: (ux * dy - uy * dx) / det,
    across: Math.abs(det) / lv,
    down: Math.abs(det) / lu,
  }
}

/**
 * Which side of the box a point is close to along one axis: -1 the first edge (left/top), 1 the
 * second (right/bottom), 0 neither. `c` is the point's place across the box (0..1 inside) and
 * `size` the distance between the two edges on screen. A thin box (a line, a bar) is grabbed
 * from outside to resize across it: pressing on it moves it.
 */
function nearEdge(c: number, size: number): -1 | 0 | 1 {
  const inward = size < GIZMO.thin ? 0 : Math.min(GIZMO.edgeInside, size / 4)
  const reach = (d: number) => (d < 0 ? -d * size <= GIZMO.edgeOutside : d * size <= inward)
  if (c <= 0.5 && reach(c)) return -1
  if (c > 0.5 && reach(1 - c)) return 1
  return 0
}

const CORNER_BY_SIDES: Readonly<Record<string, CornerId>> = {
  '-1,-1': 'nw',
  '1,-1': 'ne',
  '1,1': 'se',
  '-1,1': 'sw',
}

/**
 * What a press at `p` (view pixels) grabs on the gizmo drawn on `q`, or null when it misses
 * (the canvas under the pointer gets the press).
 */
export function hitGizmo(q: Quad, p: Point): GizmoHit | null {
  const line = lineOf(q)
  if (line) return hitLine(line, p)
  const f = frameOf(q, p)
  if (!f) return null
  const x = nearEdge(f.s, f.across)
  const y = nearEdge(f.t, f.down)
  // Along an edge only within its length; past the ends only the corner zones reach.
  const alongX = f.s >= 0 && f.s <= 1
  const alongY = f.t >= 0 && f.t <= 1
  if (x !== 0 && y !== 0) {
    // The ends of a thin box are one handle each: they resize its length only.
    const thinAcross = f.across < GIZMO.thin
    const thinDown = f.down < GIZMO.thin
    if (thinDown && !thinAcross) return { kind: 'resize', handle: x < 0 ? 'w' : 'e' }
    if (thinAcross && !thinDown) return { kind: 'resize', handle: y < 0 ? 'n' : 's' }
    return { kind: 'resize', handle: CORNER_BY_SIDES[`${x},${y}`] }
  }
  if (x !== 0 && alongY) return { kind: 'resize', handle: x < 0 ? 'w' : 'e' }
  if (y !== 0 && alongX) return { kind: 'resize', handle: y < 0 ? 'n' : 's' }
  if (alongX && alongY) return { kind: 'inside' }
  // Outside: close to a corner rotates.
  let best: CornerId | null = null
  let bestDistance: number = GIZMO.rotateRadius
  for (const corner of CORNER_IDS) {
    const c = handlePoint(q, corner)
    const d = Math.hypot(p.x - c.x, p.y - c.y)
    if (d <= bestDistance) {
      best = corner
      bestDistance = d
    }
  }
  return best ? { kind: 'rotate', corner: best } : null
}

/**
 * What a press grabs on a line: an end (a few pixels either way along it, within the band) to
 * resize its length, the band along it to move it, or just past an end to turn it.
 */
function hitLine(line: Line, p: Point): GizmoHit | null {
  const dx = line.b.x - line.a.x
  const dy = line.b.y - line.a.y
  const length = Math.hypot(dx, dy)
  // Distance from the first end along the line, and from the line across it.
  const along = ((p.x - line.a.x) * dx + (p.y - line.a.y) * dy) / length
  const off = Math.abs((p.x - line.a.x) * dy - (p.y - line.a.y) * dx) / length
  if (off <= GIZMO.edgeOutside) {
    const inward = Math.min(GIZMO.edgeInside, length / 4)
    const nearA = along >= -GIZMO.edgeOutside && along <= inward
    const nearB = along <= length + GIZMO.edgeOutside && along >= length - inward
    // A short line: the closer end.
    if (nearA && (!nearB || along < length / 2)) return { kind: 'resize', handle: line.ends[0] }
    if (nearB) return { kind: 'resize', handle: line.ends[1] }
    if (along >= 0 && along <= length) return { kind: 'inside' }
  }
  // Past an end: a corner of that end turns the line (the cursor only needs the end).
  const da = Math.hypot(p.x - line.a.x, p.y - line.a.y)
  const db = Math.hypot(p.x - line.b.x, p.y - line.b.y)
  if (Math.min(da, db) > GIZMO.rotateRadius) return null
  const [u, v] = HANDLE_UV[da <= db ? line.ends[0] : line.ends[1]]
  const corner = CORNER_IDS.find((c) => {
    const [cu, cv] = HANDLE_UV[c]
    return (u === 0.5 || cu === u) && (v === 0.5 || cv === v)
  })
  return corner ? { kind: 'rotate', corner } : null
}

/** True when `p` is inside the convex quad `q` (edges included), whatever its winding. */
export function pointInQuad(q: Quad, p: Point): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (Math.abs(cross) < 1e-9) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/* -------------------------------------------------------------------------- */
/*                                   Cursors                                  */
/* -------------------------------------------------------------------------- */

function normalize(v: Point): Point {
  const l = Math.hypot(v.x, v.y)
  return l > 0 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }
}

/**
 * Direction on screen in which a handle moves away from the box: the outward normal of its
 * edge, or for a corner the bisector of the two edges' normals (so a wide box still shows a
 * diagonal cursor at its corners). On a line, the ends and their corners point along it.
 */
export function outwardDirection(q: Quad, handle: HandleId): Point {
  const [u, v] = HANDLE_UV[handle]
  const line = lineOf(q)
  if (line) {
    const place = line.ends[0] === 'w' ? u : v
    const along = normalize({ x: line.b.x - line.a.x, y: line.b.y - line.a.y })
    if (place !== 0.5) return place < 0.5 ? { x: -along.x, y: -along.y } : along
    // Across a line (a bar thinned to a line while its side is dragged): its normal.
    return { x: -along.y, y: along.x }
  }
  const [o, x, , y] = q
  const center = quadPoint(q, 0.5, 0.5)
  const U = { x: x.x - o.x, y: x.y - o.y }
  const V = { x: y.x - o.x, y: y.y - o.y }
  // Normal of an edge, oriented away from the center.
  const normal = (edge: Point, at: Point): Point => {
    const n = normalize({ x: -edge.y, y: edge.x })
    const out = (at.x - center.x) * n.x + (at.y - center.y) * n.y
    return out < 0 ? { x: -n.x, y: -n.y } : n
  }
  let d = { x: 0, y: 0 }
  // Left/right edges run along V; top/bottom edges along U.
  if (u !== 0.5) {
    const n = normal(V, quadPoint(q, u, 0.5))
    d = { x: d.x + n.x, y: d.y + n.y }
  }
  if (v !== 0.5) {
    const n = normal(U, quadPoint(q, 0.5, v))
    d = { x: d.x + n.x, y: d.y + n.y }
  }
  return normalize(d)
}

/** Screen angle of a direction in degrees (0 = right, 90 = down). */
function angleOf(d: Point): number {
  return (Math.atan2(d.y, d.x) * 180) / Math.PI
}

export type ResizeCursor = 'ew-resize' | 'nwse-resize' | 'ns-resize' | 'nesw-resize'

/** The standard resize cursor closest to a handle's direction on screen (by octant). */
export function resizeCursor(q: Quad, handle: HandleId): ResizeCursor {
  const a = ((angleOf(outwardDirection(q, handle)) % 180) + 180) % 180
  if (a < 22.5 || a >= 157.5) return 'ew-resize'
  if (a < 67.5) return 'nwse-resize'
  if (a < 112.5) return 'ns-resize'
  return 'nesw-resize'
}

const rotateCursors = new Map<number, string>()

/**
 * The rotate cursor for a corner: a curved double arrow around the corner, turned to follow the
 * box on screen (CSS has no rotate cursor). Cached per 5° step.
 */
export function rotateCursor(q: Quad, corner: CornerId): string {
  const angle = Math.round(angleOf(outwardDirection(q, corner)) / 5) * 5
  const key = ((angle % 360) + 360) % 360
  let cursor = rotateCursors.get(key)
  if (!cursor) {
    cursor = rotateCursorCss(key)
    rotateCursors.set(key, cursor)
  }
  return cursor
}

/**
 * The drawing is for a corner pointing down-right (45°): a 120° arc around the corner with
 * arrowheads along it at both ends, turned by the corner's angle. Black with a white casing,
 * readable on any artwork.
 */
function rotateCursorCss(angle: number): string {
  const arrow =
    'M4.27 14.07A8 8 0 0 0 14.07 4.27' + // the arc, centered on the corner
    'M12.8 6.99L14.07 4.27L16.53 5.99' + // arrowhead at its upper end
    'M5.99 16.53L4.27 14.07L6.99 12.8' // arrowhead at its lower end
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<g transform="rotate(${angle - 45} 12 12)" fill="none" stroke-linecap="round" ` +
    `stroke-linejoin="round"><path d="${arrow}" stroke="#fff" stroke-width="3.5"/>` +
    `<path d="${arrow}" stroke="#000" stroke-width="1.5"/></g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, auto`
}
