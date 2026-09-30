/**
 * Per-property error budgets derived from the geometric tolerance (composition pixels).
 *
 * Every number the optimizer changes gets a budget in its own unit, chosen so that the change
 * moves nothing on screen by more than `pxTolerance`:
 *  - coordinates: divided by the magnification of their space (and the repeater accumulation)
 *  - rotations / skews: through the angular extent of the composition (δ° · π/180 · extent)
 *  - scales: relative, through the same extent
 *  - opacity / colors: fixed perceptual steps that grow with the tolerance
 * The budget is split between the steps that spend it (keyframes, then precision), so the
 * total error stays within the tolerance.
 */
import type { PropertyVisit } from './model'
import { angularExtent, type SpaceScales } from './scale'

export interface PropTolerance {
  /** Largest absolute change of each number, in the property's unit (0 = exact). */
  abs: number
  /** Largest relative change (scale values): the budget is `rel · |value|`. */
  rel: number
}

export const EXACT: PropTolerance = { abs: 0, rel: 0 }

/**
 * A rendered point accumulates the errors of its own geometry and of every transform above it
 * (group, layer, parent, precomposition positions and anchors, rotations, scales). Geometry
 * carries almost all the numbers, transforms very few: geometry gets most of the budget and
 * each transform value a small slice, so that the sum along typical chains stays within the
 * tolerance at a negligible cost in size.
 */
export const GEOMETRY_SHARE = 0.7
export const TRANSFORM_SHARE = 0.1

export interface ToleranceModel {
  of(v: PropertyVisit): PropTolerance
}

const DEG = 180 / Math.PI

/** Builds the budget function for a document and a pixel tolerance. */
export function toleranceModel(
  doc: Record<string, unknown>,
  scales: SpaceScales,
  pxTolerance: number,
): ToleranceModel {
  const extent = angularExtent(doc)
  const px = Math.max(0, pxTolerance)
  return {
    of(v: PropertyVisit): PropTolerance {
      if (px === 0) return EXACT
      const gain = Math.max(1, v.gain)
      switch (v.role) {
        case 'coord':
        case 'path': {
          if (v.orients) return EXACT
          const s = scales.of(v.space)
          const part = v.transform ? TRANSFORM_SHARE : GEOMETRY_SHARE
          const abs = s > 0 ? (px * part) / s / gain : 1
          return { abs: Math.min(1, abs), rel: 0 }
        }
        case 'scale':
          return { abs: 0, rel: (px * TRANSFORM_SHARE) / extent / gain }
        case 'angle':
          return { abs: (((px * TRANSFORM_SHARE) / extent) * DEG) / gain, rel: 0 }
        case 'opacity':
          return { abs: Math.min(0.5, 2 * px), rel: 0 }
        // Colors: half a level (of 255) at 0.05 px, never more than one level.
        case 'color':
          return { abs: Math.min(0.004, 0.04 * px) * (v.legacyColor ? 255 : 1), rel: 0 }
        case 'gradient':
          return { abs: Math.min(0.004, 0.04 * px), rel: 0 }
        case 'percent':
          return { abs: ((px / extent) * 100) / gain, rel: 0 }
        case 'trimOffset':
          return { abs: ((px / extent) * 360) / gain, rel: 0 }
        case 'exact':
          return EXACT
      }
    },
  }
}

/** Part of a budget (`share` in 0..1). */
export function share(t: PropTolerance, part: number): PropTolerance {
  return { abs: t.abs * part, rel: t.rel * part }
}

export function isExact(t: PropTolerance): boolean {
  return t.abs <= 0 && t.rel <= 0
}
