/**
 * Time mapping between compositions (mirrors lottie-web):
 *  - A layer is visible while ip <= compFrame < op (ip/op are in the containing comp's time).
 *  - Keyframe times of a layer's properties are in the containing composition's time.
 *  - A precomp layer renders its composition at
 *      inner = tm ? tm(compFrame) * fr : (compFrame - st) / sr
 */
import { evaluateScalar } from './property'
import type { Animation, PrecompLayer } from './types'

/** Frame inside a precomp's composition for a frame of the composition containing the layer. */
export function precompInnerFrame(layer: PrecompLayer, outerFrame: number, fps: number): number {
  if (layer.tm) {
    // Time remap is expressed in seconds.
    return evaluateScalar(layer.tm, outerFrame) * fps
  }
  const sr = layer.sr && layer.sr !== 0 ? layer.sr : 1
  return (outerFrame - (layer.st ?? 0)) / sr
}

/**
 * Inverse mapping (precomp inner time → outer time). Returns null when the layer uses
 * time remapping, which is not generally invertible.
 */
export function precompOuterFrame(layer: PrecompLayer, innerFrame: number): number | null {
  if (layer.tm) return null
  const sr = layer.sr && layer.sr !== 0 ? layer.sr : 1
  return innerFrame * sr + (layer.st ?? 0)
}

/** Total number of frames of the animation (op - ip). */
export function frameCount(anim: Pick<Animation, 'ip' | 'op'>): number {
  return Math.max(0, anim.op - anim.ip)
}

/** Duration in seconds. */
export function durationSeconds(anim: Pick<Animation, 'ip' | 'op' | 'fr'>): number {
  return anim.fr > 0 ? frameCount(anim) / anim.fr : 0
}

/** Last displayable integer frame (op is exclusive). */
export function lastFrame(anim: Pick<Animation, 'ip' | 'op'>): number {
  return Math.max(anim.ip, Math.ceil(anim.op) - 1)
}

/** Clamps a frame to the displayable range [ip, op - 1]. */
export function clampFrame(anim: Pick<Animation, 'ip' | 'op'>, frame: number): number {
  return Math.min(Math.max(frame, anim.ip), lastFrame(anim))
}
