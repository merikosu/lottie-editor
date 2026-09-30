/**
 * Test harness for the optimizer: run single techniques, compare every property of two
 * structurally equal documents at every (half) frame, and check structural invariants that
 * players rely on.
 */
import { scanDocument } from '../../../compat'
import { optimizeAnimation } from '../../../optimizer/pipeline'
import { resolveOptions } from '../../../optimizer/presets'
import type { OptimizeOptionsInput, OptimizeResult, TechniqueId } from '../../../optimizer/types'
import { getAt, pathKey } from '../../../path'
import { evaluateArray, evaluatePath, type AnyProperty } from '../../../property'
import type { Animation, ShapePathProperty } from '../../../types'

type J = Record<string, unknown>

const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Runs the pipeline with only `ids` enabled (minify always runs). */
export async function runOnly(
  anim: Animation,
  ids: TechniqueId[],
  patch: Exclude<OptimizeOptionsInput, string> = {},
): Promise<OptimizeResult> {
  const base = resolveOptions({ preset: patch.preset ?? 'balanced', ...patch })
  const techniques = Object.fromEntries(
    Object.keys(base.techniques).map((k) => [k, ids.includes(k as TechniqueId)]),
  )
  return optimizeAnimation(anim, { ...patch, techniques })
}

function flatPath(p: ReturnType<typeof evaluatePath>): number[] {
  if (!p) return []
  const out: number[] = []
  for (const key of ['v', 'i', 'o'] as const)
    for (const pt of p[key] ?? []) out.push(pt[0] ?? 0, pt[1] ?? 0)
  return out
}

export interface PropertyDiff {
  /** Largest absolute difference of any component. */
  max: number
  where: string
  /** Properties compared. */
  properties: number
}

/**
 * Largest difference of any property value between two structurally equal documents, over
 * every half frame of [ip − 2, op + 2] (paths flattened). Properties missing in `b` throw.
 * `skip` filters properties out (e.g. by path key).
 */
export function propertyDiff(
  a: Animation,
  b: Animation,
  skip?: (key: string) => boolean,
): PropertyDiff {
  let worst: PropertyDiff = { max: 0, where: '', properties: 0 }
  for (const ref of scanDocument(a).properties) {
    const key = pathKey(ref.path)
    if (ref.kind === 'text' || skip?.(key)) continue
    const pa = getAt<AnyProperty>(a, ref.path)
    const pb = getAt<AnyProperty>(b, ref.path)
    if (!pa) continue
    if (!pb) throw new Error(`Missing property ${key}`)
    worst.properties++
    for (let f = a.ip - 2; f <= a.op + 2; f += 0.5) {
      const va =
        ref.kind === 'path'
          ? flatPath(evaluatePath(pa as ShapePathProperty, f))
          : evaluateArray(pa, f)
      const vb =
        ref.kind === 'path'
          ? flatPath(evaluatePath(pb as ShapePathProperty, f))
          : evaluateArray(pb, f)
      if (va.length !== vb.length)
        return {
          max: Infinity,
          where: `${key} @${f} (length ${va.length} ≠ ${vb.length})`,
          properties: worst.properties,
        }
      for (let i = 0; i < va.length; i++) {
        const d = Math.abs(va[i] - vb[i])
        if (d > worst.max)
          worst = { max: d, where: `${key}[${i}] @${f}`, properties: worst.properties }
      }
    }
  }
  return worst
}

/**
 * Structural invariants every player relies on. Returns the list of violations (empty = OK):
 * valid JSON round trip, groups end with their transform, parents / matte sources / refIds
 * resolve, unique asset ids, sorted keyframes, easing on every interpolating keyframe, `a` in
 * sync with `k`, fills and strokes keep color and opacity, iOS-required layer fields.
 */
export function structureProblems(anim: Animation): string[] {
  const problems: string[] = []
  const doc = anim as unknown as J
  const text = JSON.stringify(anim)
  if (JSON.stringify(JSON.parse(text)) !== text)
    problems.push('JSON round trip changed the document')
  const ids = new Set<string>()
  const assets = Array.isArray(doc.assets) ? (doc.assets as J[]) : []
  for (const a of assets) {
    if (typeof a.id !== 'string') continue
    if (ids.has(a.id)) problems.push(`duplicate asset id ${a.id}`)
    ids.add(a.id)
  }
  const comps: [string, J[]][] = [['root', (doc.layers as J[]) ?? []]]
  for (const a of assets) if (Array.isArray(a.layers)) comps.push([String(a.id), a.layers as J[]])
  for (const [name, layers] of comps) {
    const inds = new Set(layers.map((l) => l.ind))
    layers.forEach((l, i) => {
      const at = `${name}/layers/${i}`
      for (const key of ['ty', 'ip', 'op', 'st'] as const)
        if (typeof l[key] !== 'number') problems.push(`${at}: missing ${key}`)
      if (typeof l.parent === 'number' && !inds.has(l.parent))
        problems.push(`${at}: parent ${l.parent} missing`)
      if (typeof l.tp === 'number' && !inds.has(l.tp))
        problems.push(`${at}: matte source ${l.tp} missing`)
      if (
        typeof l.tt === 'number' &&
        l.tt > 0 &&
        typeof l.tp !== 'number' &&
        !(i > 0 && layers[i - 1].td)
      )
        problems.push(`${at}: matte source above missing`)
      if (typeof l.refId === 'string' && !ids.has(l.refId))
        problems.push(`${at}: refId ${l.refId} missing`)
      if (l.ty === 4) checkShapes(l.shapes, `${at}/shapes`, problems)
    })
  }
  for (const ref of scanDocument(anim).properties) {
    if (ref.kind === 'text') continue
    const prop = ref.prop
    const k = prop.k
    const keyframed = Array.isArray(k) && k.length > 0 && isObj(k[0]) && typeof k[0].t === 'number'
    const at = pathKey(ref.path)
    if (prop.a === 1 && !keyframed) problems.push(`${at}: a:1 on a static value`)
    if (prop.a === 0 && keyframed) problems.push(`${at}: a:0 on keyframes`)
    if (!keyframed) continue
    const kfs = k as J[]
    if (kfs.length < 2) problems.push(`${at}: single keyframe`)
    kfs.forEach((kf, i) => {
      if (i > 0 && (kf.t as number) < (kfs[i - 1].t as number))
        problems.push(`${at}: keyframes out of order`)
      if (i < kfs.length - 1 && kf.h !== 1 && (!isObj(kf.o) || !isObj(kf.i)))
        problems.push(`${at}[${i}]: missing easing`)
    })
  }
  return problems
}

function checkShapes(items: unknown, at: string, problems: string[]): void {
  if (!Array.isArray(items)) return
  items.forEach((it, i) => {
    if (!isObj(it)) return
    const here = `${at}/${i}`
    if (it.ty === 'gr') {
      const children = Array.isArray(it.it) ? (it.it as J[]) : []
      const last = children[children.length - 1]
      if (!last || last.ty !== 'tr') problems.push(`${here}: group does not end with its transform`)
      else if (!isObj(last.o)) problems.push(`${here}: group transform without opacity`)
      checkShapes(children, `${here}/it`, problems)
    }
    if ((it.ty === 'fl' || it.ty === 'st') && (!isObj(it.c) || !isObj(it.o)))
      problems.push(`${here}: style without color or opacity`)
    if (it.ty === 'rc' && !isObj(it.r)) problems.push(`${here}: rectangle without roundness`)
  })
}
