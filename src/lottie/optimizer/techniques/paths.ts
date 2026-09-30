/**
 * `paths`: removes bezier vertices that do not shape the path.
 *
 *  - Duplicates: a vertex at the same place as the next one, joined by a segment without
 *    tangents, is a zero-length segment; the two merge (the first vertex keeps its in-tangent,
 *    takes the second's out-tangent).
 *  - Straight runs: a vertex on the straight segment between its neighbours (all four handles
 *    zero, strictly between them) adds nothing; for keyframed paths it must sit at the same
 *    fraction of the segment in every keyframe, so the interpolated frames stay straight too.
 * The first and last vertices are never removed (open and closed paths stay correct without
 * knowing which they are), every keyframe of a path loses the same vertices (players need equal
 * vertex counts), and layers with vertex-driven modifiers (round corners, pucker & bloat, zig
 * zag, offset, twist, merge) are left alone. With a zero tolerance only exact cases are removed;
 * otherwise vertices within the budget of the line count as on it.
 */
import {
  compLayers,
  hasExpression,
  isKeyframeList,
  isObj,
  listComps,
  visitLayerProperties,
  type Json,
} from '../model'
import { maySimplifyPaths } from '../expressions'
import { SpaceScales } from '../scale'
import { toleranceModel } from '../tolerance'
import { throwIfAborted, type TechniqueContext, type TechniqueDetails } from './context'

export const PATHS_SHARE = 0.2

const VERTEX_MODIFIERS = new Set(['rd', 'pb', 'zz', 'op', 'tw', 'mm'])

function hasVertexModifiers(items: unknown): boolean {
  for (const it of Array.isArray(items) ? items : []) {
    if (!isObj(it)) continue
    if (VERTEX_MODIFIERS.has(String(it.ty))) return true
    if (it.ty === 'gr' && hasVertexModifiers(it.it)) return true
  }
  return false
}

type Pt = number[]

interface PathData {
  v: Pt[]
  i: Pt[]
  o: Pt[]
}

const isPointList = (list: unknown[]) =>
  list.every((q) => Array.isArray(q) && typeof q[0] === 'number' && typeof q[1] === 'number')

function asPath(p: unknown): PathData | null {
  if (!isObj(p) || !Array.isArray(p.v) || !Array.isArray(p.i) || !Array.isArray(p.o)) return null
  const n = p.v.length
  if (p.i.length !== n || p.o.length !== n) return null
  if (!isPointList(p.v) || !isPointList(p.i) || !isPointList(p.o)) return null
  return p as unknown as PathData
}

/** Every path value of a property (static path or keyframe values), or null when irregular. */
function pathValues(prop: Json): PathData[] | null {
  const k = prop.k
  if (isKeyframeList(k)) {
    if (k.some((kf) => 'e' in kf)) return null
    const out: PathData[] = []
    for (const kf of k) {
      const s = kf.s
      const p = Array.isArray(s) && s.length === 1 ? asPath(s[0]) : null
      if (!p) return null
      out.push(p)
    }
    return out
  }
  const p = asPath(k)
  return p ? [p] : null
}

const NOISE = 1e-9

const small = (pt: Pt, eps: number) => Math.abs(pt[0]) <= eps && Math.abs(pt[1]) <= eps

/** Plan of the vertices to keep: indices, and for merged duplicates the out-tangent source. */
interface Plan {
  keep: number[]
  /** Kept index → index whose out-tangent it takes (duplicates). */
  outFrom: Map<number, number>
}

function planDuplicates(values: PathData[], n: number, eps: number): Plan {
  const keep: number[] = []
  const outFrom = new Map<number, number>()
  let k = 0
  while (k < n) {
    keep.push(k)
    let j = k
    // Absorb following vertices that coincide with k through a zero-length, handle-free segment.
    while (
      j + 1 < n &&
      values.every((p) => {
        const a = p.v[k]
        const b = p.v[j + 1]
        const tol = eps + NOISE * Math.max(1, Math.abs(a[0]), Math.abs(a[1]))
        return (
          Math.abs(a[0] - b[0]) <= tol &&
          Math.abs(a[1] - b[1]) <= tol &&
          small(p.o[j], tol) &&
          small(p.i[j + 1], tol)
        )
      })
    ) {
      j++
    }
    if (j > k) outFrom.set(k, j)
    k = j + 1
  }
  return { keep, outFrom }
}

/** Removes vertices strictly inside straight runs (same fraction in every keyframe). */
function planCollinear(
  values: PathData[],
  keep: number[],
  eps: number,
  deviation: { max: number },
): number[] {
  if (keep.length < 3) return keep
  const out: number[] = [keep[0]]
  for (let idx = 1; idx < keep.length - 1; idx++) {
    const prev = out[out.length - 1]
    const k = keep[idx]
    const next = keep[idx + 1]
    let lambda0: number | null = null
    let removable = true
    let worst = 0
    for (const p of values) {
      const a = p.v[prev]
      const b = p.v[next]
      const m = p.v[k]
      const scale = Math.max(1, Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]))
      const tol = eps + NOISE * scale
      if (
        !small(p.o[prev], tol) ||
        !small(p.i[k], tol) ||
        !small(p.o[k], tol) ||
        !small(p.i[next], tol)
      ) {
        removable = false
        break
      }
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      const len = Math.sqrt(len2)
      if (!(len > tol)) {
        removable = false
        break
      }
      const lambda = ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / len2
      const dist = Math.abs((m[0] - a[0]) * dy - (m[1] - a[1]) * dx) / len
      if (dist > tol || !(lambda > 0 && lambda < 1)) {
        removable = false
        break
      }
      worst = Math.max(worst, dist)
      if (lambda0 === null) lambda0 = lambda
      else if (Math.abs(lambda - lambda0) * len > tol) {
        removable = false
        break
      }
    }
    if (!removable) out.push(k)
    else deviation.max = Math.max(deviation.max, worst)
  }
  out.push(keep[keep.length - 1])
  return out
}

function applyPlan(p: PathData, keep: number[], outFrom: Map<number, number>): void {
  const v: Pt[] = []
  const i: Pt[] = []
  const o: Pt[] = []
  for (const k of keep) {
    v.push(p.v[k])
    i.push(p.i[k])
    o.push(p.o[outFrom.get(k) ?? k])
  }
  p.v = v
  p.i = i
  p.o = o
}

export interface PathSimplification {
  /** Vertices removed from each path value. */
  removed: number
  /** Largest distance a removed vertex had from the geometry that replaces it. */
  deviation: number
}

/** Simplifies one path property in place. */
export function simplifyPath(prop: Json, eps: number): PathSimplification {
  const none = { removed: 0, deviation: 0 }
  const values = pathValues(prop)
  if (!values || values.length === 0) return none
  const n = values[0].v.length
  if (n < 3 || values.some((p) => p.v.length !== n)) return none
  const dup = planDuplicates(values, n, eps)
  // Merged duplicates take their out-tangent from the last absorbed vertex: straight-run checks
  // must see those tangents, so work on the merged view.
  const merged = values.map((p) => {
    const q: PathData = {
      v: p.v,
      i: p.i,
      o: p.o.map((pt, k) => p.o[dup.outFrom.get(k) ?? k] ?? pt),
    }
    return q
  })
  const deviation = { max: dup.outFrom.size ? eps : 0 }
  const keep = planCollinear(merged, dup.keep, eps, deviation)
  if (keep.length === n) return none
  for (const p of values) applyPlan(p, keep, dup.outFrom)
  return { removed: n - keep.length, deviation: deviation.max }
}

export function paths(tc: TechniqueContext): TechniqueDetails {
  // Expressions can read path points by index (`path.points()`, `createPath`).
  if (!maySimplifyPaths(tc.info.reach)) return { vertices: 0, paths: 0 }
  const exact = !(tc.options.pxTolerance > 0) || !tc.options.pathSimplify
  const scales = new SpaceScales(tc.doc)
  const model = toleranceModel(tc.doc, scales, tc.options.pxTolerance)
  let vertices = 0
  let pathsChanged = 0
  for (const comp of listComps(tc.doc)) {
    throwIfAborted(tc.signal)
    for (const layer of compLayers(comp)) {
      // Text layers can follow a mask path; vertex-driven modifiers depend on the vertices.
      if (layer.ty === 5) continue
      const skipShapes = layer.ty === 4 && hasVertexModifiers(layer.shapes)
      visitLayerProperties(layer, comp, { legacyColors: tc.info.legacyColors }, (v) => {
        if (v.role !== 'path' || hasExpression(v.prop) || typeof v.prop.sid === 'string') return
        if (skipShapes && v.owner.ty === 'sh') return
        const full = model.of(v).abs
        const eps = exact ? 0 : full * PATHS_SHARE
        const r = simplifyPath(v.prop, eps)
        if (r.removed) {
          vertices += r.removed
          pathsChanged++
          if (full > 0)
            tc.spent.set(v.prop, Math.min(1, (tc.spent.get(v.prop) ?? 0) + r.deviation / full))
        }
      })
    }
  }
  return { vertices, paths: pathsChanged }
}
