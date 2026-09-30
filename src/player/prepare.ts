/**
 * Prepares a document for lottie-web (the "render copy").
 *
 * - lottie-web mutates the data it receives (and throws on frozen objects), so every load
 *   gets a fresh JSON deep clone. JSON (not structuredClone) also breaks shared references,
 *   which lottie-web would otherwise convert twice.
 * - Many plausible-but-imperfect files break lottie-web silently; the copy is normalized
 *   (see research notes "render-copy normalization"). The document itself is never changed.
 * - For hit-testing, layers and shape groups are tagged with a CSS class encoding their JSON
 *   path; the SVG renderer writes `cl` into the element's class attribute.
 */
import type { NodePath } from '@/lottie/path'
import { isKeyframe, isPropertyLike, type AnyProperty } from '@/lottie/property'
import { walkJson } from '@/lottie/traverse'
import type { Animation, ImageAsset, Keyframe, Layer, Mask, ShapeItem } from '@/lottie/types'
import { isImageAsset } from '@/lottie/types'

export const NODE_CLASS_PREFIX = 'le-n_'

/** ['assets', 1, 'layers', 2] → "le-n_assets_1_layers_2" */
export function nodeClassName(path: NodePath): string {
  return NODE_CLASS_PREFIX + path.join('_')
}

/** Inverse of nodeClassName; returns null for foreign classes. */
export function pathFromNodeClass(className: string): NodePath | null {
  if (!className.startsWith(NODE_CLASS_PREFIX)) return null
  return className
    .slice(NODE_CLASS_PREFIX.length)
    .split('_')
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s))
}

/** Finds the tagged node paths on an element and its ancestors (innermost first). */
export function nodePathsFromElement(el: Element | null, root: Element): NodePath[] {
  const paths: NodePath[] = []
  let node: Element | null = el
  while (node && node !== root) {
    const cls = node.getAttribute('class')
    if (cls) {
      for (const c of cls.split(/\s+/)) {
        const p = pathFromNodeClass(c)
        if (p) paths.push(p)
      }
    }
    node = node.parentElement
  }
  return paths
}

/* -------------------------------------------------------------------------- */
/*                                   Tagging                                  */
/* -------------------------------------------------------------------------- */

function addClass(target: { cl?: string }, cls: string) {
  target.cl = target.cl ? `${target.cl} ${cls}` : cls
}

function tagShapes(items: ShapeItem[] | undefined, base: (string | number)[]) {
  if (!Array.isArray(items)) return
  items.forEach((item, i) => {
    const path = [...base, i]
    if (item.ty === 'gr') {
      addClass(item, nodeClassName(path))
      tagShapes(item.it, [...path, 'it'])
    }
  })
}

function tagLayers(layers: Layer[] | undefined, base: (string | number)[]) {
  if (!Array.isArray(layers)) return
  layers.forEach((layer, i) => {
    const path = [...base, i]
    addClass(layer, nodeClassName(path))
    if (layer.ty === 4) tagShapes(layer.shapes, [...path, 'shapes'])
  })
}

/* -------------------------------------------------------------------------- */
/*                                   Images                                   */
/* -------------------------------------------------------------------------- */

/** True when an image asset can be loaded by the browser as-is. */
export function isImageResolvable(asset: ImageAsset): boolean {
  const src = `${asset.u ?? ''}${asset.p ?? ''}`
  return asset.e === 1 || /^(data:|blob:|https?:)/i.test(asset.p ?? '') || /^https?:/i.test(src)
}

function placeholderImage(w: number, h: number): string {
  const s = Math.max(8, Math.min(w, h) / 6)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><pattern id="p" width="${s * 2}" height="${s * 2}" patternUnits="userSpaceOnUse"><rect width="${s * 2}" height="${s * 2}" fill="#c9ccd2"/><rect width="${s}" height="${s}" fill="#dfe1e5"/><rect x="${s}" y="${s}" width="${s}" height="${s}" fill="#dfe1e5"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="#9aa0aa" stroke-dasharray="6 4"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/* -------------------------------------------------------------------------- */
/*                                Normalization                               */
/* -------------------------------------------------------------------------- */

const MODIFIERS = new Set(['tm', 'rp', 'rd', 'mm', 'op', 'pb', 'tw', 'zz'])

const identityTransform = () => ({
  ty: 'tr' as const,
  a: { a: 0 as const, k: [0, 0] },
  p: { a: 0 as const, k: [0, 0] },
  s: { a: 0 as const, k: [100, 100] },
  r: { a: 0 as const, k: 0 },
  o: { a: 0 as const, k: 100 },
  sk: { a: 0 as const, k: 0 },
  sa: { a: 0 as const, k: 0 },
  nm: 'Transform',
})

function normalizeShapes(items: ShapeItem[] | undefined): ShapeItem[] | undefined {
  if (!Array.isArray(items)) return items
  // lottie-web ignores `hd` on groups and modifiers: drop them so the preview matches intent.
  const kept = items.filter((it) => !(it.hd && (it.ty === 'gr' || MODIFIERS.has(it.ty))))
  for (const item of kept) {
    // Real files may lack "required" fields: treat the item loosely here.
    const loose = item as unknown as Record<string, unknown>
    switch (item.ty) {
      case 'gr': {
        item.it = normalizeShapes(item.it) ?? []
        const trIndex = item.it.findIndex((c) => c.ty === 'tr')
        if (trIndex === -1) item.it.push(identityTransform())
        else if (trIndex !== item.it.length - 1) item.it.push(...item.it.splice(trIndex, 1))
        break
      }
      case 'rc':
        loose.r ??= { a: 0, k: 0 }
        break
      case 'fl':
        loose.o ??= { a: 0, k: 100 }
        loose.c ??= { a: 0, k: [0, 0, 0, 1] }
        break
      case 'st':
        loose.o ??= { a: 0, k: 100 }
        loose.c ??= { a: 0, k: [0, 0, 0, 1] }
        loose.w ??= { a: 0, k: 1 }
        break
    }
  }
  return kept
}

function normalizeMasks(layer: Layer) {
  const masks = layer.masksProperties
  if (!Array.isArray(masks) || masks.length === 0) {
    if (layer.hasMask) layer.hasMask = false
    return
  }
  layer.masksProperties = masks.filter((m): m is Mask => !!m && !!m.pt)
  for (const m of layer.masksProperties) {
    m.mode ??= 'a'
    m.o ??= { a: 0, k: 100 }
    m.x ??= { a: 0, k: 0 }
    m.inv ??= false
  }
  layer.hasMask = layer.masksProperties.length > 0
}

function normalizeLayers(layers: Layer[] | undefined) {
  if (!Array.isArray(layers)) return
  for (const layer of layers) {
    // 3D cameras abort the whole SVG/canvas render: keep them as null layers (parenting survives).
    if ((layer.ty as number) === 13) (layer as { ty: number }).ty = 3
    normalizeMasks(layer)
    if (layer.ty === 4) layer.shapes = normalizeShapes(layer.shapes) ?? []
    if (layer.ty === 5) {
      for (const kf of layer.t?.d?.k ?? []) {
        if (kf?.s && typeof kf.s.t === 'string') kf.s.t = kf.s.t.replace(/\r\n|\n/g, '\r')
      }
    }
  }
}

function toArrayHandle(v: number | number[] | undefined, length: number): number[] {
  const arr = Array.isArray(v) ? v : [v ?? 0]
  return Array.from({ length }, (_, i) => arr[i] ?? arr[0] ?? 0)
}

const firstComponent = (v: number | number[]) => (Array.isArray(v) ? (v[0] ?? 0) : v)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function normalizeKeyframe(kf: Keyframe<unknown>) {
  if ((kf.h as unknown) === true) kf.h = 1
  if (kf.h !== undefined && kf.h !== 1) delete kf.h
  delete kf.n
  if (kf.s !== undefined && !Array.isArray(kf.s) && typeof kf.s === 'number') kf.s = [kf.s]
  if (kf.e !== undefined && !Array.isArray(kf.e) && typeof kf.e === 'number') kf.e = [kf.e]
  const spatial = Array.isArray(kf.to)
  if (kf.h === 1) {
    delete kf.to
    delete kf.ti
  }
  if (!kf.o || !kf.i) return
  const handles = [kf.o.x, kf.o.y, kf.i.x, kf.i.y]
  if (spatial && kf.h !== 1) {
    // Spatial segments use ONE scalar curve; undershoot makes lottie-web jump to the end.
    kf.o = { x: firstComponent(kf.o.x), y: clamp01(firstComponent(kf.o.y)) }
    kf.i = { x: firstComponent(kf.i.x), y: clamp01(firstComponent(kf.i.y)) }
  } else if (handles.some(Array.isArray)) {
    // Mixing arrays and scalars yields NaN in lottie-web: make all four arrays.
    const length = Math.max(...handles.map((h) => (Array.isArray(h) ? h.length : 1)))
    kf.o = { x: toArrayHandle(kf.o.x, length), y: toArrayHandle(kf.o.y, length) }
    kf.i = { x: toArrayHandle(kf.i.x, length), y: toArrayHandle(kf.i.y, length) }
  }
}

function normalizeProperty(prop: AnyProperty) {
  const k = prop.k
  if (Array.isArray(k) && k.length > 0 && isKeyframe(k[0])) {
    const kfs = k as Keyframe<unknown>[]
    kfs.forEach(normalizeKeyframe)
    if (kfs.length === 1) {
      // A single keyframe crashes lottie-web: render it as a static value.
      const s = kfs[0].s ?? kfs[0].e
      const value = Array.isArray(s) && s.length === 1 ? s[0] : s
      prop.k = value ?? 0
      prop.a = 0
    } else {
      prop.a = 1
    }
  } else {
    prop.a = 0
  }
}

function normalizePropertiesIn(root: unknown, base: (string | number)[]) {
  walkJson(root, base, (value, path) => {
    if (path.length > base.length && isPropertyLike(value)) {
      // Text documents are always keyframed (hold-only) and handled by lottie separately.
      const n = path.length
      if (!(path[n - 1] === 'd' && path[n - 2] === 't')) normalizeProperty(value)
      return false
    }
  })
}

function normalizeProperties(data: Animation) {
  normalizePropertiesIn(data.layers, ['layers'])
  data.assets?.forEach((asset, i) => {
    if ('layers' in asset) normalizePropertiesIn(asset.layers, ['assets', i, 'layers'])
  })
}

/* -------------------------------------------------------------------------- */
/*                                   Public                                   */
/* -------------------------------------------------------------------------- */

export interface PrepareOptions {
  /** Tag layers and shape groups with path classes for hit-testing (SVG renderer only). */
  tagNodes?: boolean
  /** Replace images that cannot be loaded (external relative paths) with a visible placeholder. */
  imagePlaceholders?: boolean
  /** Apply the lottie-web robustness normalization (default true). */
  normalize?: boolean
  /**
   * Preview-only solo: layers (paths) to keep visible. Other layers in the same composition are
   * hidden in the render copy (they still work as parents, as in lottie-web).
   */
  solo?: NodePath[]
}

function applySolo(data: Animation, solo: NodePath[]) {
  // Group solo layer indices by composition path ("layers" or "assets/i/layers").
  const byComp = new Map<string, Set<number>>()
  for (const p of solo) {
    const n = p.length
    if (n < 2 || p[n - 2] !== 'layers' || typeof p[n - 1] !== 'number') continue
    const key = p.slice(0, -1).join('/')
    if (!byComp.has(key)) byComp.set(key, new Set())
    byComp.get(key)!.add(p[n - 1] as number)
  }
  const hideOthers = (layers: Layer[] | undefined, key: string) => {
    const keep = byComp.get(key)
    if (!keep || !layers) return
    layers.forEach((layer, i) => {
      if (!keep.has(i)) layer.hd = true
    })
  }
  hideOthers(data.layers, 'layers')
  data.assets?.forEach((asset, i) => {
    if ('layers' in asset) hideOthers(asset.layers, `assets/${i}/layers`)
  })
}

export function prepareAnimationData(doc: Animation, opts: PrepareOptions = {}): Animation {
  const data = JSON.parse(JSON.stringify(doc)) as Animation
  if (opts.imagePlaceholders !== false) {
    for (const asset of data.assets ?? []) {
      if (isImageAsset(asset) && !isImageResolvable(asset)) {
        asset.p = placeholderImage(asset.w ?? 100, asset.h ?? 100)
        asset.u = ''
        asset.e = 1
      }
    }
  }
  // Tag before normalization removes anything, so classes keep the document's paths.
  if (opts.tagNodes) {
    tagLayers(data.layers, ['layers'])
    data.assets?.forEach((asset, index) => {
      if ('layers' in asset && Array.isArray(asset.layers))
        tagLayers(asset.layers, ['assets', index, 'layers'])
    })
  }
  if (opts.solo?.length) applySolo(data, opts.solo)
  if (opts.normalize !== false) {
    normalizeLayers(data.layers)
    for (const asset of data.assets ?? []) if ('layers' in asset) normalizeLayers(asset.layers)
    normalizeProperties(data)
  }
  return data
}
