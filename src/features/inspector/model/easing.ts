/**
 * Easing editor model: which segments a keyframe selection edits, reading their curves,
 * CSS `cubic-bezier()` conversion.
 *
 * Easing lives on segments: keyframe n holds `o`/`i` for the span n → n+1.
 */
import { curveOfKeyframe, type BezierCurve } from '@/lottie/easing'
import { getAt, pathEquals, pathKey, type NodePath } from '@/lottie/path'
import { getKeyframes, hasSpatialTangents, type AnyProperty } from '@/lottie/property'
import type { Animation, Keyframe } from '@/lottie/types'
import type { KeyframeRef } from '@/store/document'
import { roundTo } from '@/lib/math'

/** A segment: the span from keyframe `index` to `index + 1` of the property at `path`. */
export interface SegmentRef {
  path: NodePath
  index: number
}

export interface SegmentSelection {
  segments: SegmentRef[]
  /**
   * True when the selection is a single LAST keyframe: the editor then shows the segment
   * arriving at it (there is no outgoing one).
   */
  incoming: boolean
  /** The selection is exactly one segment picked in the timeline (two adjacent keys). */
  single: boolean
}

function propertyAt(doc: Animation, path: NodePath): AnyProperty | null {
  const prop = getAt<AnyProperty>(doc, path)
  return prop && typeof prop === 'object' && 'k' in prop ? prop : null
}

/** Text documents (`t.d`) hold keyframes too, but they always hold: no easing. */
export function isTextDocumentPath(path: NodePath): boolean {
  const n = path.length
  return n >= 2 && path[n - 1] === 'd' && path[n - 2] === 't'
}

/**
 * Segments edited by the easing editor for a keyframe selection:
 * - the outgoing segment of every selected keyframe that has one;
 * - a segment picked in the timeline (both keys + `property`) → just that segment;
 * - a lone last keyframe → the segment arriving at it.
 */
export function segmentsForSelection(
  doc: Animation,
  keyframes: readonly KeyframeRef[],
  property: NodePath | null,
): SegmentSelection {
  const byProp = new Map<string, { path: NodePath; indices: Set<number> }>()
  for (const ref of keyframes) {
    if (isTextDocumentPath(ref.path)) continue
    const key = pathKey(ref.path)
    const entry = byProp.get(key) ?? { path: ref.path, indices: new Set<number>() }
    entry.indices.add(ref.index)
    byProp.set(key, entry)
  }

  const segments: SegmentRef[] = []
  let single = false
  for (const { path, indices } of byProp.values()) {
    const kfs = getKeyframes(propertyAt(doc, path))
    if (!kfs) continue
    const sorted = [...indices].filter((i) => i >= 0 && i < kfs.length).sort((a, b) => a - b)
    if (
      property &&
      pathEquals(property, path) &&
      byProp.size === 1 &&
      sorted.length === 2 &&
      sorted[1] === sorted[0] + 1
    ) {
      segments.push({ path, index: sorted[0] })
      single = true
      continue
    }
    for (const i of sorted) if (i < kfs.length - 1) segments.push({ path, index: i })
  }

  if (segments.length === 0 && keyframes.length === 1 && !isTextDocumentPath(keyframes[0].path)) {
    const { path, index } = keyframes[0]
    const kfs = getKeyframes(propertyAt(doc, path))
    if (kfs && index === kfs.length - 1 && index > 0) {
      return { segments: [{ path, index: index - 1 }], incoming: true, single: true }
    }
  }
  return { segments, incoming: false, single: single || segments.length === 1 }
}

/** The keyframe that starts a segment (undefined when the segment no longer exists). */
export function segmentKeyframe(doc: Animation, seg: SegmentRef): Keyframe<unknown> | undefined {
  const kfs = getKeyframes(propertyAt(doc, seg.path))
  if (!kfs || seg.index >= kfs.length - 1) return undefined
  return kfs[seg.index]
}

/** Curve of a segment (first dimension); null for hold segments. */
export function segmentCurve(kf: Keyframe<unknown>): BezierCurve | null {
  return curveOfKeyframe(kf)
}

/** True when the segment's handles differ between dimensions (per-axis easing). */
export function isPerAxis(kf: Keyframe<unknown>): boolean {
  const handles = [kf.o?.x, kf.o?.y, kf.i?.x, kf.i?.y]
  return handles.some((h) => Array.isArray(h) && h.some((v) => Math.abs(v - h[0]) > 1e-4))
}

/**
 * True when the segment follows a spatial motion path (`to`/`ti`). lottie-web evaluates such
 * segments with one scalar curve whose value must stay within 0..1.
 */
export function isSpatialSegment(kf: Keyframe<unknown>): boolean {
  return hasSpatialTangents(kf)
}

export function curvesEqual(a: BezierCurve | null, b: BezierCurve | null, epsilon = 1e-3): boolean {
  if (a === null || b === null) return a === b
  return a.every((v, i) => Math.abs(v - b[i]) <= epsilon)
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Clamps a curve to what lottie-web can play: x in 0..1 always, y too for motion paths. */
export function constrainCurve(curve: BezierCurve, spatial: boolean): BezierCurve {
  const y = (v: number) => (spatial ? clamp01(v) : v)
  return [clamp01(curve[0]), y(curve[1]), clamp01(curve[2]), y(curve[3])]
}

/* -------------------------------------------------------------------------- */
/*                                     CSS                                    */
/* -------------------------------------------------------------------------- */

const fmt = (v: number) => String(roundTo(v, 3))

/** `cubic-bezier(0.33, 0, 0.67, 1)` */
export function formatCubicBezier(curve: BezierCurve): string {
  return `cubic-bezier(${curve.map(fmt).join(', ')})`
}

const CSS_KEYWORDS: Record<string, BezierCurve> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

/**
 * Parses easing text: `cubic-bezier(a, b, c, d)`, `a, b, c, d`, `[a, b, c, d]`, the CSS
 * keywords (`ease-in-out`, …) and `steps(1)` / `step-end` (→ 'hold'). Returns null when the
 * text is not an easing or x values fall outside 0..1.
 */
export function parseEasing(text: string): BezierCurve | 'hold' | null {
  const src = text.trim().toLowerCase().replace(/;$/, '')
  if (!src) return null
  if (src in CSS_KEYWORDS) return [...CSS_KEYWORDS[src]] as BezierCurve
  if (/^(step-end|steps\(\s*1\s*(,\s*(end|jump-end))?\s*\)|hold)$/.test(src)) return 'hold'
  const inner = /^cubic-bezier\((.*)\)$/.exec(src)?.[1] ?? /^\[(.*)\]$/.exec(src)?.[1] ?? src
  const parts = inner.split(/[\s,]+/).filter(Boolean)
  if (parts.length !== 4) return null
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n))) return null
  if (nums[0] < 0 || nums[0] > 1 || nums[2] < 0 || nums[2] > 1) return null
  return nums as BezierCurve
}
