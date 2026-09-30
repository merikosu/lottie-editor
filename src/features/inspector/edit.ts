/**
 * Document edits issued by the inspector. Every function is ONE undo step; continuous
 * gestures pass their `ChangeGesture`, so a scrub or a picker drag is one step even with
 * pauses (in-progress updates stay open until the gesture's final update).
 */
import type { Draft } from 'immer'
import type { ChangeGesture } from '@/components/ui'
import {
  findKeyframeAt,
  insertKeyframe,
  makeAnimated,
  makeStatic,
  normalizeLegacyKeyframes,
  removeKeyframes,
  setValueAtFrame,
} from '@/lottie/keyframes'
import { getAt, setAt, type NodePath } from '@/lottie/path'
import {
  evaluateArray,
  getKeyframes,
  hasExpression,
  isAnimated,
  type AnyProperty,
} from '@/lottie/property'
import type { Animation } from '@/lottie/types'
import { updateDoc, type UpdateOptions } from '@/store/document'

/** History options of a control's gesture (one undo step per gesture; none for one-off edits). */
export function gestureOptions(
  gesture?: ChangeGesture,
): Pick<UpdateOptions, 'coalesceKey' | 'final'> {
  return gesture ? { coalesceKey: gesture.key, final: gesture.final } : {}
}

/** A property edited by a field, with the time it is edited at. */
export interface PropTarget {
  /** JSON path of the property (e.g. ['layers', 0, 'ks', 'o']). */
  path: NodePath
  /** Playhead in the property's composition time. */
  frame: number
  /** Local time → root frame, for keyframe navigation (null when it cannot be mapped). */
  toRoot?: (t: number) => number | null
  /** Creates the property when the document does not have it (optional fields). */
  create?: () => AnyProperty
}

export type Value = number | number[]

export type KeyStatus = 'static' | 'animated' | 'key'

/** Property at a path inside a draft or document (null when missing or not a property). */
export function propertyAt(root: unknown, path: NodePath): AnyProperty | null {
  const prop = getAt<AnyProperty>(root, path)
  return prop !== null && typeof prop === 'object' && 'k' in prop ? prop : null
}

function resolve(draft: Draft<Animation>, target: PropTarget): AnyProperty | null {
  const existing = propertyAt(draft, target.path)
  if (existing) {
    normalizeLegacyKeyframes(existing)
    return existing
  }
  if (!target.create) return null
  setAt(draft, target.path, target.create())
  return propertyAt(draft, target.path)
}

/** Runs `fn` on every target property in one undo step. Missing properties are created when possible. */
export function editProperties(
  label: string,
  targets: readonly PropTarget[],
  fn: (prop: AnyProperty, target: PropTarget, index: number) => void,
  gesture?: ChangeGesture,
): boolean {
  return updateDoc(
    label,
    (draft) => {
      targets.forEach((target, index) => {
        const prop = resolve(draft, target)
        if (prop) fn(prop, target, index)
      })
    },
    gestureOptions(gesture),
  )
}

/**
 * Writes a value at the target's frame (auto-keying animated properties). Static scalars
 * stored as one-element arrays keep that form.
 */
export function writeValue(prop: AnyProperty, frame: number, value: Value): void {
  if (typeof value === 'number' && !isAnimated(prop) && Array.isArray(prop.k)) {
    setValueAtFrame(prop, frame, [value])
    return
  }
  setValueAtFrame(prop, frame, value)
}

/** Evaluated value of a (possibly missing) property, falling back to `fallback`. */
export function readValue(
  prop: AnyProperty | null | undefined,
  frame: number,
  fallback: number[],
): number[] {
  if (!prop) return fallback
  const v = evaluateArray(prop, frame)
  return v.length > 0 && v.every(Number.isFinite) ? v : fallback
}

/* -------------------------------------------------------------------------- */
/*                                 Key status                                 */
/* -------------------------------------------------------------------------- */

/** Key status of the targets: key only when every one has a key at its frame. */
export function keyStatus(
  props: readonly (AnyProperty | null | undefined)[],
  targets: readonly PropTarget[],
): KeyStatus {
  let animated = 0
  let keyed = 0
  props.forEach((prop, i) => {
    if (!prop || !isAnimated(prop)) return
    animated++
    if (findKeyframeAt(prop, targets[i].frame) >= 0) keyed++
  })
  if (animated === 0) return 'static'
  return keyed === props.length ? 'key' : 'animated'
}

/** First expression among the properties, if any. */
export function firstExpression(props: readonly (AnyProperty | null | undefined)[]): string | null {
  for (const p of props) if (p && hasExpression(p)) return p.x ?? null
  return null
}

/** Root frames of the neighbouring keyframes of the first animated target. */
export function neighbourKeys(
  props: readonly (AnyProperty | null | undefined)[],
  targets: readonly PropTarget[],
): { prev: number | null; next: number | null } {
  const i = props.findIndex((p) => !!p && isAnimated(p))
  if (i < 0) return { prev: null, next: null }
  const target = targets[i]
  const times = (getKeyframes(props[i]) ?? []).map((k) => k.t)
  const toRoot = target.toRoot ?? ((t: number) => t)
  const eps = 1e-3
  let prev: number | null = null
  let next: number | null = null
  for (const t of times) {
    if (t < target.frame - eps) prev = t
    else if (t > target.frame + eps && next === null) next = t
  }
  const map = (t: number | null) => {
    if (t === null) return null
    const root = toRoot(t)
    return root === null ? null : Math.round(root * 1000) / 1000
  }
  return { prev: map(prev), next: map(next) }
}

/* -------------------------------------------------------------------------- */
/*                               Key operations                               */
/* -------------------------------------------------------------------------- */

/**
 * The key button: static → start animating (first key at the playhead); animated → add a
 * key at the playhead; key → remove the keys at the playhead.
 */
export function toggleKeys(
  label: string,
  targets: readonly PropTarget[],
  status: KeyStatus,
  discrete = false,
): boolean {
  return editProperties(label, targets, (prop, target) => {
    if (status === 'key') {
      const index = findKeyframeAt(prop, target.frame)
      if (index >= 0) removeKeyframes(prop, [index])
    } else if (isAnimated(prop)) {
      insertKeyframe(prop, target.frame)
    } else {
      makeAnimated(prop, target.frame)
    }
    if (discrete) holdKeyframes(prop)
  })
}

/**
 * Makes every keyframe a hold keyframe. Discrete values (checkboxes, menus, layer pickers)
 * animate in steps in After Effects; interpolated, players would read in-between values
 * (a menu at 1.5) and disagree on when a checkbox flips.
 */
export function holdKeyframes(prop: AnyProperty): void {
  for (const kf of getKeyframes(prop) ?? []) if (kf.h !== 1) kf.h = 1
}

/** Removes all keyframes, keeping the value at the playhead. */
export function removeAnimation(label: string, targets: readonly PropTarget[]): boolean {
  // Never create missing properties just to make them static.
  const existing = targets.map((t) => ({ path: t.path, frame: t.frame, toRoot: t.toRoot }))
  return editProperties(label, existing, (prop, target) => makeStatic(prop, target.frame))
}
