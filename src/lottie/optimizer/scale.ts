/**
 * How much the transforms above a coordinate space can magnify it on screen.
 *
 * The optimizer expresses its geometric tolerance in composition pixels; a coordinate inside
 * a layer scaled to 400 % (or inside a precomposition shown at 400 %) must keep four times the
 * precision. `SpaceScales.of(space)` returns an upper bound of that magnification over the whole
 * animation: the product, along the chain of transforms (groups, layer, parents, precomp
 * instances), of each transform's largest scale factor over time (skew included).
 */
import { evaluateArray } from '../property'
import {
  arr,
  compLayers,
  hasExpression,
  isKeyframeList,
  isObj,
  listComps,
  num,
  type Comp,
  type Json,
  type Space,
} from './model'

/** Largest absolute value per dimension a property takes (keyframes and in-between samples). */
export function maxAbs(prop: unknown, dims: number, fallback: number): number[] {
  const out = Array.from({ length: dims }, () => 0)
  if (!isObj(prop)) return out.map(() => Math.abs(fallback))
  const k = prop.k
  const take = (v: readonly unknown[]) => {
    for (let d = 0; d < dims; d++) {
      const x =
        typeof v[d] === 'number'
          ? (v[d] as number)
          : typeof v[0] === 'number'
            ? (v[0] as number)
            : fallback
      if (Number.isFinite(x)) out[d] = Math.max(out[d], Math.abs(x))
    }
  }
  if (typeof k === 'number') take([k])
  else if (Array.isArray(k) && typeof k[0] === 'number') take(k)
  else if (isKeyframeList(k)) {
    for (let i = 0; i < k.length; i++) {
      const kf = k[i]
      for (const key of ['s', 'e'] as const) {
        const s = kf[key]
        if (Array.isArray(s)) take(s)
        else if (typeof s === 'number') take([s])
      }
      // Easing may overshoot between keyframes: sample the segment.
      const next = k[i + 1]
      if (next && typeof kf.t === 'number' && typeof next.t === 'number' && next.t > kf.t) {
        for (let j = 1; j < 8; j++)
          take(evaluateArray(prop as never, kf.t + ((next.t - kf.t) * j) / 8))
      }
    }
  } else return out.map(() => Math.abs(fallback))
  return out
}

const MAX_SKEW = (85 * Math.PI) / 180

/**
 * Upper bound of the largest singular value of a transform over time: max |scale| times the
 * norm of the skew matrix. Transforms driven by expressions get a generous margin.
 */
export function transformGain(tr: unknown): number {
  if (!isObj(tr)) return 1
  const [sx, sy] = maxAbs(tr.s, 2, 100)
  let gain = Math.max(sx, sy) / 100
  const skew = maxAbs(tr.sk, 1, 0)[0]
  if (skew > 0) {
    const t = Math.tan(Math.min(MAX_SKEW, (skew * Math.PI) / 180))
    gain *= (Math.abs(t) + Math.sqrt(t * t + 4)) / 2
  }
  if ((isObj(tr.s) && hasExpression(tr.s)) || (isObj(tr.sk) && hasExpression(tr.sk)))
    gain = Math.max(gain, 1) * 4
  return Number.isFinite(gain) ? gain : 1e6
}

/** Magnification of a repeater: copy n is scaled n times by the repeater's scale. */
function repeaterGain(rp: Json): number {
  const tr = isObj(rp.tr) ? rp.tr : null
  if (!tr) return 1
  const copies = Math.max(1, Math.min(1000, Math.ceil(maxAbs(rp.c, 1, 1)[0])))
  const offset = Math.min(1000, maxAbs(rp.o, 1, 0)[0])
  const g = transformGain(tr)
  // Copies are placed at offset + k steps: the largest accumulated power of the gain.
  const steps = copies + Math.ceil(offset)
  return g > 1 ? Math.min(1e6, g ** steps) : 1
}

export class SpaceScales {
  private readonly layerContent = new WeakMap<Json, number>()
  private readonly layerOuter = new WeakMap<Json, number>()
  private readonly compScale = new Map<string | null, number>()
  private readonly groupScale = new WeakMap<Json, Map<Space, number>>()
  private readonly instances = new Map<string, { layer: Json; comp: Comp }[]>()
  private readonly visiting = new Set<string | null>()

  constructor(doc: Json) {
    for (const comp of listComps(doc)) {
      for (const layer of compLayers(comp)) {
        if (layer.ty === 0 && typeof layer.refId === 'string') {
          const list = this.instances.get(layer.refId) ?? []
          list.push({ layer, comp })
          this.instances.set(layer.refId, list)
        }
      }
    }
  }

  /** Magnification of a coordinate space relative to root composition pixels. */
  of(space: Space): number {
    switch (space.kind) {
      case 'layerOuter':
        return this.outer(space.layer, space.comp)
      case 'layerContent':
        return this.content(space.layer, space.comp)
      case 'group': {
        let cache = this.groupScale.get(space.group)
        if (!cache) {
          cache = new Map()
          this.groupScale.set(space.group, cache)
        }
        const hit = cache.get(space.parent)
        if (hit !== undefined) return hit
        const tr = arr(space.group.it).findLast((c) => isObj(c) && c.ty === 'tr')
        const v = this.of(space.parent) * transformGain(tr)
        cache.set(space.parent, v)
        return v
      }
      case 'repeat':
        return this.of(space.parent) * repeaterGain(space.repeater)
    }
  }

  /** Scale of the composition's own space: the largest of its instances (root = 1). */
  comp(comp: Comp): number {
    const hit = this.compScale.get(comp.id)
    if (hit !== undefined) return hit
    if (comp.id === null) return 1
    // Precomposition cycles: treat the recursive part as unscaled.
    if (this.visiting.has(comp.id)) return 1
    this.visiting.add(comp.id)
    let max = 0
    for (const inst of this.instances.get(comp.id) ?? [])
      max = Math.max(max, this.content(inst.layer, inst.comp))
    this.visiting.delete(comp.id)
    // Unused compositions are never displayed: any precision works, keep 1.
    const v = max > 0 ? max : 1
    this.compScale.set(comp.id, v)
    return v
  }

  private outer(layer: Json, comp: Comp): number {
    const hit = this.layerOuter.get(layer)
    if (hit !== undefined) return hit
    let v = this.comp(comp)
    // Parents pass their transform (not opacity).
    const layers = compLayers(comp)
    const seen = new Set<Json>([layer])
    let parentInd = num(layer.parent)
    while (parentInd !== undefined) {
      const parent = layers.find((l) => l.ind === parentInd)
      if (!parent || seen.has(parent)) break
      seen.add(parent)
      v *= transformGain(parent.ks) * (parent.ddd === 1 ? 2 : 1)
      parentInd = num(parent.parent)
    }
    this.layerOuter.set(layer, v)
    return v
  }

  private content(layer: Json, comp: Comp): number {
    const hit = this.layerContent.get(layer)
    if (hit !== undefined) return hit
    // 3D layers can be magnified by perspective: be conservative.
    const v = this.outer(layer, comp) * transformGain(layer.ks) * (layer.ddd === 1 ? 2 : 1)
    this.layerContent.set(layer, v)
    return v
  }
}

/**
 * Distance (composition pixels) used to bound the effect of angular and relative errors: a
 * rotation error of δ radians moves visible points by at most `extent · δ`. Visible points lie
 * in the composition rectangle; anchors may sit outside it, hence the margin.
 */
export function angularExtent(doc: Json): number {
  const w = num(doc.w) ?? 512
  const h = num(doc.h) ?? 512
  return 4 * Math.hypot(Math.max(1, w), Math.max(1, h))
}
