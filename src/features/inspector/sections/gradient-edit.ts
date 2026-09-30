/**
 * Document edits on gradient stops that must touch every keyframe.
 */
import type { ChangeGesture } from '@/components/ui'
import { normalizeLegacyKeyframes } from '@/lottie/keyframes'
import { getAt, type NodePath } from '@/lottie/path'
import { getKeyframes } from '@/lottie/property'
import type { GradientColors } from '@/lottie/types'
import { updateDoc } from '@/store/document'
import {
  matchOpacityStructure,
  parseStops,
  reverseStops,
  serializeStops,
  type GradientStops,
} from '../model/gradient'
import { gestureOptions, writeValue } from '../edit'

/** Applies `edit` to the stops of every keyframe (or the static value) of a gradient item. */
export function editAllStops(
  label: string,
  path: NodePath,
  edit: (stops: GradientStops) => GradientStops,
  delta: number,
  gesture?: ChangeGesture,
) {
  updateDoc(
    label,
    (draft) => {
      const g = getAt<GradientColors>(draft, [...path, 'g'])
      if (!g?.k) return
      normalizeLegacyKeyframes(g.k)
      const kfs = getKeyframes<number[]>(g.k)
      if (kfs) {
        for (const kf of kfs)
          if (Array.isArray(kf.s)) kf.s = serializeStops(edit(parseStops(kf.s, g.p)))
      } else if (Array.isArray(g.k.k)) {
        g.k.k = serializeStops(edit(parseStops(g.k.k as number[], g.p)))
      }
      g.p = Math.max(0, g.p + delta)
    },
    gestureOptions(gesture),
  )
}

/**
 * Writes `next` at `frame` (auto-keying) after giving every keyframe the opacity stops `next`
 * added, so an animated gradient keeps one structure (keyframes interpolate index by index).
 * One undo step per gesture.
 */
export function writeStopsWithStructure(
  label: string,
  path: NodePath,
  frame: number,
  next: GradientStops,
  gesture?: ChangeGesture,
) {
  updateDoc(
    label,
    (draft) => {
      const g = getAt<GradientColors>(draft, [...path, 'g'])
      if (!g?.k) return
      normalizeLegacyKeyframes(g.k)
      for (const kf of getKeyframes<number[]>(g.k) ?? []) {
        if (Array.isArray(kf.s))
          kf.s = serializeStops(matchOpacityStructure(parseStops(kf.s, g.p), next))
      }
      writeValue(g.k, frame, serializeStops(next))
    },
    gestureOptions(gesture),
  )
}

/** Mirrors a gradient item's stops on every keyframe. */
export function reverseGradient(label: string, path: NodePath): void {
  editAllStops(label, path, reverseStops, 0)
}
