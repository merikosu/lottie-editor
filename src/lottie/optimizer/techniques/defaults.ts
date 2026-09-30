/**
 * `defaults`: removes fields whose value is what every major player assumes when the field is
 * missing (lottie-web 5.13 SVG / canvas / HTML, lottie-ios 4.6, lottie-android 6.7, Skottie,
 * ThorVG — verified in their parsers). Anything not listed is kept, in particular:
 *  - `st`, `ip`, `op`, `ty`, `ind`, `v` (lottie-ios fails to load without them)
 *  - group transform opacity (lottie-web's canvas and expression builds crash without it)
 *  - fill / stroke `o` and `c` (lottie-android skips a fill without them), `lc` / `lj`
 *    (lottie-web defaults them to round, After Effects to butt)
 *  - mask fields, effects, layer styles and text data (parsers are strict or order-sensitive)
 *  - the `a` flag of properties
 * Fields only read by expressions (`ix`, `cix`, `np`, `mn`, shape `ind`) and identity transform
 * values go unless an expression looks items up by index or match name (`content(1)`,
 * `transform("Scale")`, `"ADBE …"`: lottie-web reads those fields and expects every transform
 * property there); effects always keep them (players match effects by `mn`).
 */
import { mayDropIndices } from '../expressions'
import {
  arr,
  compLayers,
  hasExpression,
  isKeyframeList,
  isObj,
  isProperty,
  isPropertyObject,
  listComps,
  type Json,
} from '../model'
import type { TechniqueContext, TechniqueDetails } from './context'

const zeroVector = (v: unknown) =>
  !Array.isArray(v) || v.every((x) => typeof x !== 'number' || x === 0)

/** A static property (no expression, no slot) whose value equals `expected` in every component. */
function staticEquals(prop: unknown, expected: number): boolean {
  if (!isProperty(prop) || hasExpression(prop) || typeof prop.sid === 'string') return false
  const k = prop.k
  if (typeof k === 'number') return k === expected
  if (Array.isArray(k) && k.length > 0 && k.every((x) => typeof x === 'number'))
    return k.every((x) => x === expected)
  return false
}

/** Removes static identity values from a transform; `keepOpacity` for group transforms. */
function stripIdentity(tr: Json, keepOpacity: boolean): number {
  let n = 0
  const drop = (key: string) => {
    delete tr[key]
    n++
  }
  if (staticEquals(tr.a, 0)) drop('a')
  if (isObj(tr.p) && tr.p.s !== true && staticEquals(tr.p, 0)) drop('p')
  if (staticEquals(tr.s, 100)) drop('s')
  // `r` is only the rotation when no 3D rotations are present.
  if (!('rx' in tr) && !('ry' in tr) && !('rz' in tr) && staticEquals(tr.r, 0)) drop('r')
  if (staticEquals(tr.sk, 0)) {
    drop('sk')
    // The skew axis only orients a skew.
    if (
      isProperty(tr.sa) &&
      !hasExpression(tr.sa) &&
      typeof tr.sa.sid !== 'string' &&
      !isKeyframeList(tr.sa.k)
    )
      drop('sa')
  }
  if (!keepOpacity && staticEquals(tr.o, 100)) drop('o')
  return n
}

interface Counter {
  fields: number
}

const HANDLE_AXES = [
  ['o', 'x'],
  ['o', 'y'],
  ['i', 'x'],
  ['i', 'y'],
] as const

/**
 * `{x: [a], y: [b]}` easing handles become `{x: a, y: b}`. Every player reads a one-element
 * array (or an array whose values are all equal) as that value, but lottie-web needs all four
 * handle components to be arrays or all numbers, and on spatial keyframes it only accepts
 * one-element arrays — so all four are converted together, and only in those cases.
 */
function compactHandles(kf: Json, spatial: boolean): number {
  if (!isObj(kf.o) || !isObj(kf.i)) return 0
  const values: number[] = []
  for (const [h, axis] of HANDLE_AXES) {
    const v = (kf[h] as Json)[axis]
    if (!Array.isArray(v) || v.length === 0 || typeof v[0] !== 'number') return 0
    if (spatial ? v.length !== 1 : !v.every((x) => x === v[0])) return 0
    values.push(v[0] as number)
  }
  HANDLE_AXES.forEach(([h, axis], n) => ((kf[h] as Json)[axis] = values[n]))
  return 1
}

/** True when a keyframe's easing is one curve for all dimensions. */
function scalarEasing(kf: Json): boolean {
  for (const [h, axis] of HANDLE_AXES) {
    const handle = kf[h]
    if (!isObj(handle)) continue
    const v = handle[axis]
    if (Array.isArray(v) && !v.every((x) => x === v[0])) return false
  }
  return true
}

/** Keyframe-level defaults: easing of the last keyframe and of holds, `h: 0`, zero tangents. */
function stripKeyframes(prop: Json, keepFirstIn: boolean, c: Counter): void {
  const kfs = prop.k
  if (!isKeyframeList(kfs)) return
  const last = kfs.length - 1
  kfs.forEach((kf, i) => {
    if (kf.h === 0) {
      delete kf.h
      c.fields++
    }
    // Zero spatial tangents describe a straight motion, which players treat exactly like no
    // tangents (lottie-web drops them itself) — unless per-dimension easing is involved
    // (lottie-android then uses one curve for the motion path).
    if (
      Array.isArray(kf.to) &&
      Array.isArray(kf.ti) &&
      zeroVector(kf.to) &&
      zeroVector(kf.ti) &&
      scalarEasing(kf)
    ) {
      delete kf.to
      delete kf.ti
      c.fields += 2
    }
    const spatial = Array.isArray(kf.to) || Array.isArray(kf.ti)
    c.fields += compactHandles(kf, spatial)
    // lottie-web moves along the path of a hold keyframe that has tangents: keep its easing.
    const unused = i === last && kfs.length > 1 ? true : kf.h === 1 && !spatial
    if (!unused) return
    for (const key of ['o', 'i', ...(i === last && kfs.length > 1 ? ['to', 'ti'] : [])]) {
      // Files older than 4.1.9 detect keyframed colors by the first keyframe's `i`.
      if (key === 'i' && i === 0 && keepFirstIn) continue
      if (key in kf) {
        delete kf[key]
        c.fields++
      }
    }
  })
}

const EXPRESSION_KEYS = ['ix', 'cix', 'np', 'mn']

/** Expression-only fields can go: no expression, or none that looks items up by index. */
function indexFree(tc: TechniqueContext): boolean {
  return mayDropIndices(tc.info.reach)
}

function stripShapes(items: unknown, tc: TechniqueContext, c: Counter): void {
  const noExpr = indexFree(tc)
  for (const item of arr(items)) {
    if (!isObj(item)) continue
    if (item.hd === false) {
      delete item.hd
      c.fields++
    }
    if (item.bm === 0) {
      delete item.bm
      c.fields++
    }
    // lottie-web draws a rectangle without `d` counter-clockwise (only 1 and 2 are clockwise):
    // the direction matters for trim paths, so only ellipses and stars lose `d: 1`.
    if (item.d === 1 && (item.ty === 'el' || item.ty === 'sr')) {
      delete item.d
      c.fields++
    }
    if (item.r === 1 && (item.ty === 'fl' || item.ty === 'gf')) {
      delete item.r
      c.fields++
    }
    if (noExpr) {
      for (const key of [...EXPRESSION_KEYS, 'ind']) {
        if (key in item) {
          delete item[key]
          c.fields++
        }
      }
      if (item.ty === 'tr') c.fields += stripIdentity(item, true)
    }
    if (item.ty === 'gr') stripShapes(item.it, tc, c)
  }
}

export function defaults(tc: TechniqueContext): TechniqueDetails {
  const doc = tc.doc
  const c: Counter = { fields: 0 }
  const noExpr = indexFree(tc)
  const dropRoot = (key: string) => {
    delete doc[key]
    c.fields++
  }
  if (doc.ddd === 0) dropRoot('ddd')
  if ('meta' in doc) dropRoot('meta')
  if (Array.isArray(doc.markers) && doc.markers.length === 0) dropRoot('markers')

  for (const comp of listComps(doc)) {
    for (const layer of compLayers(comp)) {
      const drop = (key: string) => {
        delete layer[key]
        c.fields++
      }
      if (layer.ddd === 0) drop('ddd')
      if (layer.hd === false) drop('hd')
      if (layer.ao === 0) drop('ao')
      if (layer.sr === 1) drop('sr')
      // lottie-web's canvas keeps the previous layer's blend mode when `bm` is missing.
      if (layer.bm === 0 && !tc.info.blendModes) drop('bm')
      const masks = arr(layer.masksProperties)
      if ('masksProperties' in layer && masks.length === 0) drop('masksProperties')
      if (layer.hasMask === false && masks.length === 0) drop('hasMask')
      if (Array.isArray(layer.ef) && layer.ef.length === 0) drop('ef')
      if (Array.isArray(layer.sy) && layer.sy.length === 0) drop('sy')
      if (noExpr) {
        if (isObj(layer.ks) && layer.ddd !== 1) c.fields += stripIdentity(layer.ks, false)
        for (const key of ['ix', 'cix', 'np']) if (key in layer) drop(key)
      }
      if (layer.ty === 4) stripShapes(layer.shapes, tc, c)

      // Property and keyframe fields everywhere except effects and text data.
      const keepFirstIn = tc.info.legacyColors
      const visitProps = (root: unknown, colorOwner: boolean) => {
        if (!isObj(root) && !Array.isArray(root)) return
        const stack: unknown[] = [root]
        while (stack.length) {
          const v = stack.pop()
          if (Array.isArray(v)) {
            for (const x of v) if (typeof x === 'object' && x !== null) stack.push(x)
            continue
          }
          if (!isObj(v)) continue
          if (isPropertyObject(v)) {
            if (noExpr && 'ix' in v) {
              delete v.ix
              c.fields++
            }
            stripKeyframes(v, colorOwner && keepFirstIn, c)
            continue
          }
          for (const [key, child] of Object.entries(v)) {
            if (typeof child !== 'object' || child === null) continue
            // Legacy color detection only concerns fill / stroke colors.
            if (key === 'c' && (v.ty === 'fl' || v.ty === 'st') && isProperty(child)) {
              if (noExpr && 'ix' in child) {
                delete child.ix
                c.fields++
              }
              stripKeyframes(child, keepFirstIn, c)
              continue
            }
            stack.push(child)
          }
        }
      }
      visitProps(layer.ks, false)
      visitProps(layer.tm, false)
      visitProps(layer.masksProperties, false)
      if (layer.ty === 4) visitProps(layer.shapes, false)
    }
  }
  return { fields: c.fields }
}
