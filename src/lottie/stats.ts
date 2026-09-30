/**
 * Document statistics and size analysis.
 *
 *  - `computeStats`: counts (layers by kind, shape items, keyframes, masks, mattes, effects,
 *    expressions, assets…) and the notable features used, for the document summary.
 *  - `measureJson` / `measureDocument`: minified JSON size and its gzip size (what a server
 *    sends), with the part taken by embedded images.
 *  - `inspectDataUri`: decoded size, pixel size and transparency of embedded images, read from
 *    the file header without decoding the image.
 *  - `compositionActivity`: the frames during which each composition is actually on screen,
 *    used to find layers that are never visible.
 *
 * Everything here is pure and runs in Node (unit tests) and in workers.
 */
import { gzipSync } from 'fflate'
import {
  arr,
  isObj,
  num,
  scanDocument,
  type CompRef,
  type DocumentScan,
  type Json,
  type LayerRef,
} from './compat'
import { layerKind, type LayerKind } from './layers'
import { pathKey, type NodePath } from './path'
import { isAnimated } from './property'
import type { Animation, Layer } from './types'

/* -------------------------------------------------------------------------- */
/*                                    Sizes                                   */
/* -------------------------------------------------------------------------- */

export interface SizeInfo {
  /** Minified JSON, in bytes (UTF-8). */
  raw: number
  /** Gzip (level 9) of the minified JSON: roughly what a web server sends. */
  gzip: number
  /** Bytes of the JSON taken by embedded image data URIs. */
  images: number
  /** Number of embedded images. */
  imageCount: number
}

const encoder = new TextEncoder()

/** UTF-8 byte length of a string. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      // Surrogate pair: one 4-byte code point.
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** Gzip size (level 9) of UTF-8 text or bytes. */
export function gzipSize(data: string | Uint8Array): number {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  return gzipSync(bytes, { level: 9, mtime: 0 }).length
}

/** Embedded image data URIs of the document (image assets only). */
function embeddedImageUris(anim: Animation): string[] {
  const out: string[] = []
  for (const a of arr((anim as unknown as Json).assets)) {
    if (isObj(a) && !Array.isArray(a.layers) && typeof a.p === 'string' && /^data:/i.test(a.p))
      out.push(a.p)
  }
  return out
}

/**
 * Sizes of a serialized document. `json` must be `JSON.stringify(anim)` (minified); pass
 * `gzip: false` to skip compression when only the raw size is needed.
 */
export function measureJson(
  json: string,
  anim: Animation,
  opts: { gzip?: boolean } = {},
): SizeInfo {
  const bytes = encoder.encode(json)
  const uris = embeddedImageUris(anim)
  return {
    raw: bytes.length,
    gzip: opts.gzip === false ? 0 : gzipSync(bytes, { level: 9, mtime: 0 }).length,
    // Data URIs are ASCII and JSON.stringify writes them unescaped.
    images: uris.reduce((sum, uri) => sum + uri.length, 0),
    imageCount: uris.length,
  }
}

/** Sizes of a document (serializes it minified). */
export function measureDocument(anim: Animation, opts: { gzip?: boolean } = {}): SizeInfo {
  return measureJson(JSON.stringify(anim), anim, opts)
}

/* -------------------------------------------------------------------------- */
/*                               Embedded images                              */
/* -------------------------------------------------------------------------- */

export interface DataUriImage {
  /** Lower-cased media type ("image/png"). */
  mime: string
  /** Decoded payload size in bytes. */
  bytes: number
  /** Pixel size read from the file header (PNG, JPEG, WebP, GIF). */
  width?: number
  height?: number
  /** The image may contain transparency (false only when the format or header rules it out). */
  alpha: boolean
}

const B64: Record<string, number> = {}
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  .split('')
  .forEach((c, i) => (B64[c] = i))
B64['-'] = 62
B64._ = 63

/** Decodes up to `maxBytes` bytes of base64 text starting at `offset`. */
function decodeBase64(text: string, offset: number, maxBytes: number): Uint8Array {
  const out = new Uint8Array(Math.min(maxBytes, Math.ceil(((text.length - offset) * 3) / 4)))
  let n = 0
  let buffer = 0
  let bits = 0
  for (let i = offset; i < text.length && n < out.length; i++) {
    const v = B64[text[i]]
    if (v === undefined) {
      if (text[i] === '=') break
      continue
    }
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (buffer >> bits) & 0xff
    }
  }
  return out.subarray(0, n)
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1]
}

function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])
}

function ascii(b: Uint8Array, i: number, n: number): string {
  let s = ''
  for (let k = 0; k < n && i + k < b.length; k++) s += String.fromCharCode(b[i + k])
  return s
}

/** Pixel size and transparency from the first bytes of an image file. */
export function imageHeaderInfo(
  b: Uint8Array,
): { width: number; height: number; alpha: boolean } | null {
  // PNG: IHDR is the first chunk.
  if (b.length >= 26 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    const colorType = b[25]
    let alpha = colorType === 4 || colorType === 6
    if (!alpha) {
      // Palette or truecolor images can still carry a tRNS chunk before the image data.
      let pos = 8
      while (pos + 8 <= b.length) {
        const type = ascii(b, pos + 4, 4)
        if (type === 'tRNS') alpha = true
        if (type === 'IDAT' || type === 'IEND' || alpha) break
        pos += 12 + u32be(b, pos)
      }
    }
    return { width: u32be(b, 16), height: u32be(b, 20), alpha }
  }
  // JPEG: scan markers for a start-of-frame segment.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let pos = 2
    while (pos + 9 < b.length) {
      if (b[pos] !== 0xff) return null
      const marker = b[pos + 1]
      if (marker === 0xff) {
        pos++
        continue
      }
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { height: u16be(b, pos + 5), width: u16be(b, pos + 7), alpha: false }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        pos += 2
        continue
      }
      pos += 2 + u16be(b, pos + 2)
    }
    return null
  }
  // WebP: RIFF container with a VP8 / VP8L / VP8X chunk.
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4)
    if (chunk === 'VP8 ') {
      return {
        width: (b[26] | (b[27] << 8)) & 0x3fff,
        height: (b[28] | (b[29] << 8)) & 0x3fff,
        alpha: false,
      }
    }
    if (chunk === 'VP8L') {
      const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]]
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        alpha: ((b3 >> 4) & 1) === 1,
      }
    }
    if (chunk === 'VP8X') {
      return {
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
        alpha: (b[20] & 0x10) !== 0,
      }
    }
    return null
  }
  // GIF: logical screen size; transparency is possible.
  if (b.length >= 10 && ascii(b, 0, 4) === 'GIF8') {
    return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), alpha: true }
  }
  return null
}

/** Decoded size, pixel size and transparency of an image data URI (null if not a data URI). */
export function inspectDataUri(uri: string): DataUriImage | null {
  if (!/^data:/i.test(uri)) return null
  const comma = uri.indexOf(',')
  if (comma < 0) return null
  const header = uri
    .slice(5, comma)
    .split(';')
    .map((p) => p.trim().toLowerCase())
  const mime = header[0] || 'text/plain'
  const base64 = header.includes('base64')
  if (!base64) {
    // Percent-encoded payloads (usually SVG): approximate the decoded size.
    const payload = uri.slice(comma + 1)
    const escapes = (payload.match(/%[0-9a-f]{2}/gi) ?? []).length
    return { mime, bytes: payload.length - escapes * 2, alpha: true }
  }
  let end = uri.length
  while (
    end > comma + 1 &&
    (uri[end - 1] === '=' || uri[end - 1] === '\n' || uri[end - 1] === '\r')
  )
    end--
  const bytes = Math.floor(((end - comma - 1) * 3) / 4)
  // Headers are near the start; JPEG may put EXIF data first, hence the generous prefix.
  const head = decodeBase64(uri, comma + 1, 256 * 1024)
  const info = imageHeaderInfo(head)
  if (!info) return { mime, bytes, alpha: mime !== 'image/jpeg' && mime !== 'image/jpg' }
  return { mime, bytes, width: info.width, height: info.height, alpha: info.alpha }
}

/* -------------------------------------------------------------------------- */
/*                              Time / visibility                             */
/* -------------------------------------------------------------------------- */

/** Half-open frame interval [start, end). */
export interface Interval {
  start: number
  end: number
}

const EVERYTHING: Interval = { start: -Infinity, end: Infinity }

/** Sorted, merged union of intervals. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end)
    else out.push({ ...i })
  }
  return out
}

function intersect(a: readonly Interval[], from: number, to: number): Interval[] {
  const out: Interval[] = []
  for (const i of a) {
    const start = Math.max(i.start, from)
    const end = Math.min(i.end, to)
    if (end > start) out.push({ start, end })
  }
  return out
}

function sameIntervals(a: readonly Interval[], b: readonly Interval[]): boolean {
  return a.length === b.length && a.every((x, i) => x.start === b[i].start && x.end === b[i].end)
}

const activityCache = new WeakMap<object, Map<CompRef, Interval[]>>()

/**
 * Frames (in each composition's own time) during which the composition is on screen:
 * the root plays [ip, op); a precomposition is shown through its instances, each mapping its
 * visible range to inner time as (t − st) / sr (lottie-web). Time-remapped instances and
 * recursive precompositions count as always active. Unreachable compositions get no interval.
 */
export function compositionActivity(anim: Animation): Map<CompRef, Interval[]> {
  const cached = activityCache.get(anim)
  if (cached) return cached
  const activity = computeActivity(anim, scanDocument(anim))
  activityCache.set(anim, activity)
  return activity
}

/** Uncached `compositionActivity` for a given scan (of an object that may be mutated later). */
export function computeActivity(anim: Animation, scan: DocumentScan): Map<CompRef, Interval[]> {
  const activity = new Map<CompRef, Interval[]>()
  for (const comp of scan.comps) activity.set(comp, [])
  const root = scan.comps[0]
  const ip = num(anim.ip) ?? 0
  const op = num(anim.op) ?? ip
  activity.set(root, mergeIntervals([{ start: ip, end: op }]))

  const queue: CompRef[] = [root]
  // Each composition is revisited when one of its instances gains visible frames; the
  // interval sets only grow, and runaway recursion (precomp loops) is capped.
  const visits = new Map<CompRef, number>()
  while (queue.length) {
    const comp = queue.shift()!
    const count = (visits.get(comp) ?? 0) + 1
    visits.set(comp, count)
    const own = activity.get(comp) ?? []
    for (const { layer } of comp.layers) {
      if (layer.ty !== 0 || typeof layer.refId !== 'string') continue
      const child = scan.compById.get(layer.refId)
      if (!child) continue
      const lip = num(layer.ip) ?? -Infinity
      const lop = num(layer.op) ?? Infinity
      const visible = intersect(own, lip, lop)
      if (visible.length === 0) continue
      let inner: Interval[]
      if (isObj(layer.tm) || count > 8) {
        inner = [EVERYTHING]
      } else {
        const st = num(layer.st) ?? 0
        const sr = num(layer.sr) || 1
        inner = visible.map((i) => {
          const a = (i.start - st) / sr
          const b = (i.end - st) / sr
          return a <= b ? { start: a, end: b } : { start: b, end: a }
        })
      }
      const before = activity.get(child) ?? []
      const after = mergeIntervals([...before, ...inner])
      if (!sameIntervals(before, after)) {
        activity.set(child, after)
        if (!queue.includes(child)) queue.push(child)
      }
    }
  }
  return activity
}

/** True when the layer is shown for at least part of its composition's active frames. */
export function isLayerEverVisible(anim: Animation, ref: LayerRef): boolean {
  const ip = num(ref.layer.ip)
  const op = num(ref.layer.op)
  if (ip === undefined || op === undefined) return true
  if (op <= ip) return false
  const active = compositionActivity(anim).get(ref.comp) ?? []
  return intersect(active, ip, op).length > 0
}

/* -------------------------------------------------------------------------- */
/*                                 Statistics                                 */
/* -------------------------------------------------------------------------- */

/** Notable features shown as chips in the document summary. */
export const STAT_FEATURES = [
  'masks',
  'mattes',
  'gradients',
  'trimPaths',
  'repeaters',
  'mergePaths',
  'text',
  'images',
  'expressions',
  'effects',
  'layerStyles',
  'threeD',
  'timeRemap',
  'blendModes',
  'cameras',
  'audio',
  'slots',
] as const
export type StatFeatureId = (typeof STAT_FEATURES)[number]

export interface StatFeature {
  id: StatFeatureId
  /** Occurrences (masks, gradient items, expressions… or layers for layer-level features). */
  count: number
  /** Layers that use the feature (for selecting them). */
  layers: NodePath[]
}

export interface DocumentStatistics {
  width: number
  height: number
  fps: number
  /** op − ip */
  frames: number
  /** Seconds. */
  duration: number
  /** Layers in every composition. */
  layers: number
  rootLayers: number
  layersByKind: Partial<Record<LayerKind, number>>
  hiddenLayers: number
  /** Precomposition assets. */
  compositions: number
  /** Precomposition layers (instances). */
  precompLayers: number
  /** Shape items, not counting group transforms. */
  shapes: number
  groups: number
  shapesByType: Record<string, number>
  /** Animatable properties (static and animated). */
  properties: number
  animatedProperties: number
  keyframes: number
  masks: number
  /** Layers with a track matte. */
  mattes: number
  effects: number
  layerStyles: number
  expressions: number
  textLayers: number
  fonts: number
  glyphs: number
  imageAssets: number
  embeddedImages: number
  externalImages: number
  /** Decoded bytes of the embedded images. */
  imageBytes: number
  markers: number
  features: StatFeature[]
}

const statsCache = new WeakMap<object, DocumentStatistics>()

/** Counts and notable features of a document (cached per document object). */
export function computeStats(anim: Animation): DocumentStatistics {
  const cached = statsCache.get(anim)
  if (cached) return cached
  const scan: DocumentScan = scanDocument(anim)
  const root = anim as unknown as Json

  const featureLayers = new Map<StatFeatureId, Map<string, NodePath>>()
  const featureCount = new Map<StatFeatureId, number>()
  const note = (id: StatFeatureId, layerPath: NodePath, n = 1) => {
    featureCount.set(id, (featureCount.get(id) ?? 0) + n)
    let layers = featureLayers.get(id)
    if (!layers) {
      layers = new Map()
      featureLayers.set(id, layers)
    }
    if (layers.size < 1000) layers.set(pathKey(layerPath), layerPath)
  }

  const layersByKind: Partial<Record<LayerKind, number>> = {}
  let hiddenLayers = 0
  let precompLayers = 0
  let masks = 0
  let mattes = 0
  let effects = 0
  let layerStyles = 0
  let textLayers = 0
  for (const { layer, path } of scan.layers) {
    const kind = layerKind({ ty: num(layer.ty) ?? -1 } as Pick<Layer, 'ty'>)
    layersByKind[kind] = (layersByKind[kind] ?? 0) + 1
    if (layer.hd === true) hiddenLayers++
    if (layer.ty === 0) precompLayers++
    if (layer.ty === 5) {
      textLayers++
      note('text', path)
    }
    if (layer.ty === 2) note('images', path)
    if (layer.ty === 13) note('cameras', path)
    if (layer.ty === 6) note('audio', path)
    const m = arr(layer.masksProperties).length
    if (m) {
      masks += m
      note('masks', path, m)
    }
    if ((num(layer.tt) ?? 0) > 0) {
      mattes++
      note('mattes', path)
    }
    const e = arr(layer.ef).length
    if (e) {
      effects += e
      note('effects', path, e)
    }
    const s = arr(layer.sy).length
    if (s) {
      layerStyles += s
      note('layerStyles', path, s)
    }
    const ks = isObj(layer.ks) ? layer.ks : {}
    if (layer.ddd === 1 || 'rx' in ks || 'ry' in ks || 'or' in ks) note('threeD', path)
    if (isObj(layer.tm)) note('timeRemap', path)
    if ((num(layer.bm) ?? 0) !== 0) note('blendModes', path)
  }

  const shapesByType: Record<string, number> = {}
  let shapes = 0
  let groups = 0
  for (const { item, layer } of scan.shapes) {
    const ty = typeof item.ty === 'string' ? item.ty : '?'
    if (ty === 'tr') continue
    shapes++
    shapesByType[ty] = (shapesByType[ty] ?? 0) + 1
    if (ty === 'gr') groups++
    if (ty === 'gf' || ty === 'gs') note('gradients', layer.path)
    else if (ty === 'tm') note('trimPaths', layer.path)
    else if (ty === 'rp') note('repeaters', layer.path)
    else if (ty === 'mm') note('mergePaths', layer.path)
    if ((num(item.bm) ?? 0) !== 0) note('blendModes', layer.path)
  }

  let properties = 0
  let animatedProperties = 0
  let keyframes = 0
  let expressions = 0
  for (const { prop, layer, kind } of scan.properties) {
    if (kind === 'text') {
      // Source text: every document is a keyframe; only several of them animate.
      const n = arr(prop.k).length
      if (n > 1) {
        animatedProperties++
        keyframes += n
      }
      properties++
    } else {
      properties++
      if (isAnimated(prop as { k: unknown })) {
        animatedProperties++
        keyframes += arr(prop.k).length
      }
    }
    if (typeof prop.x === 'string' && prop.x.trim()) {
      expressions++
      note('expressions', layer.path)
    }
    if (typeof prop.sid === 'string') note('slots', layer.path)
  }

  let imageAssets = 0
  let embeddedImages = 0
  let externalImages = 0
  let imageBytes = 0
  for (const a of arr(root.assets)) {
    if (!isObj(a) || Array.isArray(a.layers) || typeof a.p !== 'string') continue
    imageAssets++
    const info = inspectDataUri(a.p)
    if (info) {
      embeddedImages++
      imageBytes += info.bytes
    } else externalImages++
  }

  const fps = num(anim.fr) ?? 0
  const frames = Math.max(0, (num(anim.op) ?? 0) - (num(anim.ip) ?? 0))
  const features: StatFeature[] = []
  for (const id of STAT_FEATURES) {
    const count = featureCount.get(id) ?? 0
    if (count > 0)
      features.push({ id, count, layers: [...(featureLayers.get(id)?.values() ?? [])] })
  }

  const stats: DocumentStatistics = {
    width: num(anim.w) ?? 0,
    height: num(anim.h) ?? 0,
    fps,
    frames,
    duration: fps > 0 ? frames / fps : 0,
    layers: scan.layers.length,
    rootLayers: scan.comps[0].layers.length,
    layersByKind,
    hiddenLayers,
    compositions: scan.comps.length - 1,
    precompLayers,
    shapes,
    groups,
    shapesByType,
    properties,
    animatedProperties,
    keyframes,
    masks,
    mattes,
    effects,
    layerStyles,
    expressions,
    textLayers,
    fonts: arr(isObj(root.fonts) ? root.fonts.list : undefined).length,
    glyphs: arr(root.chars).length,
    imageAssets,
    embeddedImages,
    externalImages,
    imageBytes,
    markers: arr(root.markers).length,
    features,
  }
  statsCache.set(anim, stats)
  return stats
}
