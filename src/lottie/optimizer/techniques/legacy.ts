/**
 * `legacy`: converts pre-5.5 keyframes to the modern format.
 *
 * Old Bodymovin files store every segment's end value twice: in the keyframe's `e` and in the
 * next keyframe's `s` (for shape keyframes that is a whole bezier path). Players take the next
 * `s` when it exists (lottie-web, Skottie, ThorVG, lottie-ios) and fall back to `e` only for a
 * last keyframe without a value, so `e` is moved there and dropped everywhere else. `n` (easing
 * names) is unused except as a cache key for identical curves, and dropped.
 */
import { compLayers, forEachPropertyDeep, isKeyframeList, listComps } from '../model'
import type { TechniqueContext, TechniqueDetails } from './context'

export function legacy(tc: TechniqueContext): TechniqueDetails {
  let endValues = 0
  let easingNames = 0
  for (const comp of listComps(tc.doc)) {
    for (const layer of compLayers(comp)) {
      forEachPropertyDeep(layer, (prop, text) => {
        if (text || !isKeyframeList(prop.k)) return
        const kfs = prop.k
        for (let i = 0; i < kfs.length; i++) {
          const kf = kfs[i]
          if ('n' in kf) {
            delete kf.n
            easingNames++
          }
          if (!('e' in kf)) continue
          const next = kfs[i + 1]
          if (next && next.s === undefined && kf.e !== undefined) next.s = kf.e
          // A last keyframe's own `e` is never read (the value after it is its `s`).
          if (next || kf.s !== undefined) {
            delete kf.e
            endValues++
          }
        }
      })
    }
  }
  return { endValues, easingNames }
}
