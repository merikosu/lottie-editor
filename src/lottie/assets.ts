/**
 * Image assets, precompositions and fonts: inspection and editing helpers.
 *
 * Lottie keeps reusable content in `assets` (images and precompositions, referenced by
 * layers through `refId`) and fonts in `fonts.list` (referenced by text documents through
 * `f`). The mutating helpers are meant for `updateDoc` recipes; the rest are pure reads.
 */
import { compInfoAt, createImageLayer } from './create'
import { nextLayerInd } from './layers'
import type { NodePath } from './path'
import { getAt } from './path'
import { forEachLayer } from './traverse'
import type { Animation, Asset, Font, ImageAsset, Layer, PrecompAsset, TextLayer } from './types'
import { isImageAsset, isPrecompAsset, isSplitPosition, LayerType } from './types'

/* -------------------------------------------------------------------------- */
/*                                  Data URIs                                 */
/* -------------------------------------------------------------------------- */

export interface DataUriInfo {
  /** Lower-cased media type, e.g. "image/png" ("text/plain" when omitted). */
  mime: string
  base64: boolean
  /** Index of the first payload character (after the comma). */
  dataOffset: number
}

export function isDataUri(value: unknown): value is string {
  return typeof value === 'string' && /^data:/i.test(value)
}

/** Parses the header of a data URI without touching the (possibly huge) payload. */
export function parseDataUri(uri: string): DataUriInfo | null {
  if (!isDataUri(uri)) return null
  const comma = uri.indexOf(',')
  if (comma < 0) return null
  const header = uri.slice(5, comma)
  const parts = header.split(';').map((p) => p.trim())
  const mime = (parts[0] || 'text/plain').toLowerCase()
  const base64 = parts.slice(1).some((p) => p.toLowerCase() === 'base64')
  return { mime, base64, dataOffset: comma + 1 }
}

/** Size in bytes of the data carried by a data URI (after base64 / percent decoding). */
export function dataUriByteSize(uri: string): number {
  const info = parseDataUri(uri)
  if (!info) return 0
  if (info.base64) {
    let end = uri.length
    while (end > info.dataOffset && /\s/.test(uri[end - 1])) end--
    let padding = 0
    if (uri[end - 1] === '=') padding++
    if (uri[end - 2] === '=') padding++
    return Math.max(0, Math.floor(((end - info.dataOffset) * 3) / 4) - padding)
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(uri.slice(info.dataOffset))).length
  } catch {
    return uri.length - info.dataOffset
  }
}

/** Decodes the payload of a data URI. Throws on malformed input. */
export function dataUriToBytes(uri: string): Uint8Array {
  const info = parseDataUri(uri)
  if (!info) throw new Error('Not a data URI')
  const payload = uri.slice(info.dataOffset)
  if (!info.base64) return new TextEncoder().encode(decodeURIComponent(payload))
  const binary = atob(payload.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

/** File extension for an image media type ("png" when unknown). */
export function mimeToExtension(mime: string | null | undefined): string {
  return (mime && MIME_EXTENSIONS[mime.toLowerCase()]) || 'png'
}

/** Image media type for a file name or extension, or null when it is not an image we support. */
export function extensionToMime(nameOrExt: string): string | null {
  const ext = nameOrExt.toLowerCase().split(/[?#]/)[0].split('.').pop() ?? ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'avif':
      return 'image/avif'
    default:
      return null
  }
}

/* -------------------------------------------------------------------------- */
/*                                Image assets                                */
/* -------------------------------------------------------------------------- */

/**
 * - embedded: the pixels are inside the file (data URI)
 * - linked: an absolute http(s) URL the player downloads at runtime
 * - missing: a relative path ("images/img_0.png") that only works next to the original
 *   export folder; the editor cannot show it until the file is embedded
 */
export type ImageStatus = 'embedded' | 'linked' | 'missing'

/** Full source string of an image asset as a player resolves it (`u` + `p`). */
function joinedSource(asset: ImageAsset): string {
  const p = asset.p ?? ''
  if (isDataUri(p) || /^[a-z][a-z0-9+.-]*:/i.test(p)) return p
  return `${asset.u ?? ''}${p}`
}

export function imageStatus(asset: ImageAsset): ImageStatus {
  if (isDataUri(asset.p)) return 'embedded'
  return /^https?:\/\//i.test(joinedSource(asset)) ? 'linked' : 'missing'
}

/** URL an <img> can display (data URI or absolute URL), or null when the image is missing. */
export function imageSrc(asset: ImageAsset): string | null {
  const status = imageStatus(asset)
  if (status === 'embedded') return asset.p
  if (status === 'linked') return joinedSource(asset)
  return null
}

/** Last path segment of a URL or relative path, without query/hash. */
export function baseName(path: string): string {
  const clean = path.split(/[?#]/)[0]
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/** Media type of an image asset (from the data URI header or the file extension). */
export function imageMime(asset: ImageAsset): string | null {
  const info = parseDataUri(asset.p)
  if (info) return info.mime
  return extensionToMime(baseName(asset.p ?? ''))
}

/** Suggested file name when saving the image: the original file name, or "<id>.<ext>". */
export function imageFileName(asset: ImageAsset): string {
  if (!isDataUri(asset.p)) {
    const name = baseName(asset.p ?? '')
    if (name) return name
  }
  const safeId = (asset.id || 'image').replace(/[\\/:*?"<>|\s]+/g, '_')
  return `${safeId}.${mimeToExtension(imageMime(asset))}`
}

export interface ImageAssetInfo {
  asset: ImageAsset
  /** Index in `anim.assets`. */
  index: number
  status: ImageStatus
  mime: string | null
  /** Decoded size of embedded data in bytes (null for linked/missing images). */
  bytes: number | null
  src: string | null
  fileName: string
}

const infoCache = new WeakMap<ImageAsset, Omit<ImageAssetInfo, 'index'>>()

/** Describes an image asset. Cached per asset object (documents are immutable). */
export function describeImage(asset: ImageAsset, index: number): ImageAssetInfo {
  let info = infoCache.get(asset)
  if (!info) {
    const status = imageStatus(asset)
    info = {
      asset,
      status,
      mime: imageMime(asset),
      bytes: status === 'embedded' ? dataUriByteSize(asset.p) : null,
      src: imageSrc(asset),
      fileName: imageFileName(asset),
    }
    // Frozen (store) objects are safe keys; drafts are not cached to avoid stale entries.
    if (Object.isFrozen(asset)) infoCache.set(asset, info)
  }
  return { ...info, index }
}

/** All image assets in document order. */
export function listImageAssets(anim: Animation): ImageAssetInfo[] {
  const out: ImageAssetInfo[] = []
  anim.assets?.forEach((asset, index) => {
    if (isImageAsset(asset)) out.push(describeImage(asset, index))
  })
  return out
}

/** Image assets a player cannot load from the file alone (relative paths). */
export function missingImages(anim: Animation): ImageAsset[] {
  return (anim.assets ?? []).filter(
    (a): a is ImageAsset => isImageAsset(a) && imageStatus(a) === 'missing',
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Usage                                   */
/* -------------------------------------------------------------------------- */

/** Layer paths referencing each asset id through `refId` (any layer type, every composition). */
export function assetReferences(anim: Animation): Map<string, NodePath[]> {
  const refs = new Map<string, NodePath[]>()
  forEachLayer(anim, (layer, path) => {
    const refId = (layer as { refId?: unknown }).refId
    if (typeof refId !== 'string') return
    const list = refs.get(refId)
    if (list) list.push(path)
    else refs.set(refId, [path])
  })
  return refs
}

function usageOf(anim: Animation, pick: (asset: Asset) => boolean): Map<string, NodePath[]> {
  const ids = new Set((anim.assets ?? []).filter(pick).map((a) => a.id))
  const all = assetReferences(anim)
  const out = new Map<string, NodePath[]>()
  for (const id of ids) out.set(id, all.get(id) ?? [])
  return out
}

/** Layers using each image asset (every image asset has an entry, possibly empty). */
export function imageUsage(anim: Animation): Map<string, NodePath[]> {
  return usageOf(anim, isImageAsset)
}

/** Precomp layers instancing each precomposition (every precomp has an entry, possibly empty). */
export function precompUsage(anim: Animation): Map<string, NodePath[]> {
  return usageOf(anim, isPrecompAsset)
}

/**
 * Asset ids reachable from the root composition: referenced by a root layer, or by a layer
 * of a reachable precomposition. Anything else can be removed without visible change.
 */
export function reachableAssetIds(anim: Animation): Set<string> {
  const byId = new Map<string, Asset>()
  for (const asset of anim.assets ?? [])
    if (asset && typeof asset.id === 'string') byId.set(asset.id, asset)
  const reached = new Set<string>()
  const queue: Layer[][] = [anim.layers ?? []]
  while (queue.length) {
    const layers = queue.pop()!
    for (const layer of layers) {
      const refId = (layer as { refId?: unknown }).refId
      if (typeof refId !== 'string' || reached.has(refId)) continue
      reached.add(refId)
      const asset = byId.get(refId)
      if (asset && isPrecompAsset(asset)) queue.push(asset.layers)
    }
  }
  return reached
}

/** Ids of assets (images and precomps) not reachable from the root composition. */
export function unusedAssets(anim: Animation): string[] {
  const reached = reachableAssetIds(anim)
  return (anim.assets ?? [])
    .filter((a) => a && typeof a.id === 'string' && !reached.has(a.id))
    .map((a) => a.id)
}

/* -------------------------------------------------------------------------- */
/*                                 Identifiers                                */
/* -------------------------------------------------------------------------- */

/** First free id of the form `<prefix>_<n>` (n ≥ 0), e.g. "image_3". */
export function uniqueAssetId(anim: Pick<Animation, 'assets'>, prefix = 'image'): string {
  const taken = new Set((anim.assets ?? []).map((a) => a.id))
  for (let n = 0; ; n++) {
    const id = `${prefix}_${n}`
    if (!taken.has(id)) return id
  }
}

export type AssetIdProblem = 'empty' | 'duplicate'

/** Validates a new id for an asset (`currentId` is the asset being renamed, if any). */
export function validateAssetId(
  anim: Pick<Animation, 'assets'>,
  id: string,
  currentId?: string,
): AssetIdProblem | null {
  const trimmed = id.trim()
  if (!trimmed) return 'empty'
  if (trimmed !== currentId && (anim.assets ?? []).some((a) => a.id === trimmed)) return 'duplicate'
  return null
}

/**
 * Renames an asset id and updates every layer `refId` pointing to it (all compositions).
 * Returns false when the id is invalid, taken or unknown.
 */
export function renameAsset(anim: Animation, oldId: string, newId: string): boolean {
  const next = newId.trim()
  if (next === oldId) return false
  if (validateAssetId(anim, next, oldId)) return false
  const asset = anim.assets?.find((a) => a.id === oldId)
  if (!asset) return false
  const layers: Layer[] = []
  forEachLayer(anim, (layer) => {
    if ((layer as { refId?: unknown }).refId === oldId) layers.push(layer)
  })
  asset.id = next
  for (const layer of layers) (layer as { refId?: string }).refId = next
  return true
}

/* -------------------------------------------------------------------------- */
/*                               Editing images                               */
/* -------------------------------------------------------------------------- */

/** Adds an embedded image asset and returns its (unique) id. */
export function addImageAsset(
  anim: Animation,
  dataUri: string,
  w: number,
  h: number,
  name?: string,
): string {
  const id = uniqueAssetId(anim, 'image')
  const asset: ImageAsset = { id, w: Math.round(w), h: Math.round(h), u: '', p: dataUri, e: 1 }
  const nm = name?.trim()
  if (nm) asset.nm = nm
  anim.assets ??= []
  anim.assets.push(asset)
  return id
}

/**
 * Replaces the pixels of an image asset with an embedded image, keeping its id (so every
 * layer using it updates) and any other fields (name, slot id).
 */
export interface ReplaceImageOptions {
  /**
   * When the size changes, keep the picture centered where it was: layers showing the image
   * move their anchor point by half the size change (every anchor keyframe too). Players draw
   * an image from its top-left corner, so without this a smaller image shifts up and left.
   */
  keepCenter?: boolean
}

export function replaceImageAsset(
  anim: Animation,
  assetId: string,
  dataUri: string,
  w: number,
  h: number,
  opts: ReplaceImageOptions = {},
): boolean {
  const asset = anim.assets?.find((a) => a.id === assetId)
  if (!asset || !isImageAsset(asset)) return false
  const oldW = asset.w
  const oldH = asset.h
  asset.p = dataUri
  asset.u = ''
  asset.e = 1
  asset.w = Math.round(w)
  asset.h = Math.round(h)
  // Image sequences are a different asset kind; a replaced still image is a plain image.
  if (asset.t === 'seq') delete asset.t
  if (opts.keepCenter && oldW && oldW > 0 && oldH && oldH > 0) {
    const dx = (asset.w - oldW) / 2
    const dy = (asset.h - oldH) / 2
    if (dx || dy) {
      forEachLayer(anim, (layer, _path, comp) => {
        if (layer.ty !== LayerType.Image || (layer as { refId?: string }).refId !== assetId) return
        shiftAnchor(layer, dx, dy)
        // Children live in the layer's space, anchor included: move them along so they stay put.
        if (typeof layer.ind !== 'number') return
        for (const child of comp.layers)
          if (child !== layer && child.parent === layer.ind) shiftPosition(child, dx, dy)
      })
    }
  }
  return true
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** Adds `delta` to the numbers of a static or keyframed property (values and legacy end values). */
function offsetProperty(prop: { k: unknown }, delta: readonly number[]): void {
  const shift = (v: number[]) => v.map((n, i) => round3(n + (delta[i] ?? 0)))
  if (typeof prop.k === 'number') {
    prop.k = round3(prop.k + (delta[0] ?? 0))
    return
  }
  if (!Array.isArray(prop.k)) return
  if (prop.k.every((n) => typeof n === 'number')) {
    prop.k = shift(prop.k as number[])
    return
  }
  for (const kf of prop.k as { s?: unknown; e?: unknown }[]) {
    if (!kf || typeof kf !== 'object') continue
    if (Array.isArray(kf.s) && kf.s.every((n) => typeof n === 'number'))
      kf.s = shift(kf.s as number[])
    if (Array.isArray(kf.e) && kf.e.every((n) => typeof n === 'number'))
      kf.e = shift(kf.e as number[])
  }
}

/** Moves a layer's anchor point (static or keyframed) by (dx, dy). */
function shiftAnchor(layer: Layer, dx: number, dy: number): void {
  layer.ks ??= {}
  if (!layer.ks.a) layer.ks.a = { a: 0, k: [round3(dx), round3(dy), 0] }
  else offsetProperty(layer.ks.a, [dx, dy])
}

/** Moves a layer's position (static, keyframed or separated dimensions) by (dx, dy). */
function shiftPosition(layer: Layer, dx: number, dy: number): void {
  layer.ks ??= {}
  const p = layer.ks.p
  if (!p) layer.ks.p = { a: 0, k: [round3(dx), round3(dy), 0] }
  else if (isSplitPosition(p)) {
    offsetProperty(p.x, [dx])
    offsetProperty(p.y, [dy])
  } else offsetProperty(p, [dx, dy])
}

/** Removes assets by id. Returns the ids that were removed. */
export function removeAssets(anim: Animation, ids: Iterable<string>): string[] {
  const remove = new Set(ids)
  if (!anim.assets || remove.size === 0) return []
  const removed: string[] = []
  anim.assets = anim.assets.filter((a) => {
    if (remove.has(a.id)) {
      removed.push(a.id)
      return false
    }
    return true
  })
  return removed
}

/**
 * Removes every asset that is not reachable from the root composition (unused images,
 * unused precomps and whatever only they referenced). Returns the removed ids.
 */
export function removeUnusedAssets(anim: Animation): string[] {
  return removeAssets(anim, unusedAssets(anim))
}

/**
 * Matches file names to image assets whose file lives outside the document (relative
 * paths first, then linked URLs), comparing base names case-insensitively.
 * Returns assetId → file name.
 */
export function matchFilesToImages(
  anim: Animation,
  fileNames: readonly string[],
): Map<string, string> {
  const byName = new Map<string, string>()
  for (const name of fileNames) {
    const key = baseName(name).toLowerCase()
    if (key && !byName.has(key)) byName.set(key, name)
  }
  const out = new Map<string, string>()
  for (const asset of anim.assets ?? []) {
    if (!isImageAsset(asset) || imageStatus(asset) === 'embedded') continue
    const candidates = [baseName(asset.p ?? ''), baseName(joinedSource(asset))]
    for (const c of candidates) {
      const match = c && byName.get(c.toLowerCase())
      if (match) {
        out.set(asset.id, match)
        break
      }
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                Image layers                                */
/* -------------------------------------------------------------------------- */

/** Uniform scale (percent) that fits a w×h image inside the composition; 100 when it already fits. */
export function fitScale(w: number, h: number, compW: number, compH: number): number {
  if (!(w > 0) || !(h > 0) || !(compW > 0) || !(compH > 0)) return 100
  const s = Math.min(compW / w, compH / h, 1)
  return Math.round(s * 10000) / 100
}

export interface AddImageLayerOptions {
  assetId: string
  w: number
  h: number
  /** Path of the target `layers` array (default: the root composition). */
  layersPath?: NodePath
  /** Insertion index in that array (0 = top, the default). */
  index?: number
  name?: string
}

/**
 * Inserts an image layer centered in its composition, spanning its time range and scaled
 * down to fit when the image is larger than the composition. Returns the new layer's path.
 */
export function addImageLayer(anim: Animation, opts: AddImageLayerOptions): NodePath {
  const layersPath = opts.layersPath ?? ['layers']
  const layers = getAt<Layer[]>(anim, layersPath)
  if (!Array.isArray(layers)) throw new Error('addImageLayer: no layers array at the given path')
  const comp = compInfoAt(anim, layersPath)
  const layer = createImageLayer(opts.assetId, opts.w, opts.h, {
    name: opts.name,
    ind: nextLayerInd(layers),
    ip: comp.ip,
    op: comp.op,
    position: [comp.w / 2, comp.h / 2],
    scale: fitScale(opts.w, opts.h, comp.w, comp.h),
  })
  const index = Math.max(0, Math.min(layers.length, opts.index ?? 0))
  layers.splice(index, 0, layer)
  return [...layersPath, index]
}

/* -------------------------------------------------------------------------- */
/*                                Compositions                                */
/* -------------------------------------------------------------------------- */

export interface PrecompInfo {
  asset: PrecompAsset
  index: number
  /** Size from the first instancing layer (or the asset, if it stores one). */
  w: number | null
  h: number | null
  layerCount: number
  instances: NodePath[]
}

/** Precompositions with their size, layer count and instancing layers. */
export function listPrecomps(anim: Animation): PrecompInfo[] {
  const refs = assetReferences(anim)
  const out: PrecompInfo[] = []
  anim.assets?.forEach((asset, index) => {
    if (!isPrecompAsset(asset)) return
    const instances = refs.get(asset.id) ?? []
    // Some exporters store the composition size on the asset itself.
    const sized = asset as unknown as { w?: unknown; h?: unknown }
    let w = typeof sized.w === 'number' ? sized.w : null
    let h = typeof sized.h === 'number' ? sized.h : null
    for (const path of instances) {
      const layer = getAt<{ w?: unknown; h?: unknown }>(anim, path)
      if (layer && typeof layer.w === 'number' && typeof layer.h === 'number') {
        w = layer.w
        h = layer.h
        break
      }
    }
    out.push({ asset, index, w, h, layerCount: asset.layers.length, instances })
  })
  return out
}

/* -------------------------------------------------------------------------- */
/*                                    Fonts                                   */
/* -------------------------------------------------------------------------- */

/** Font names (`fName`) used by each text layer's documents (all keyframes, all comps). */
function textLayerFonts(layer: TextLayer): Set<string> {
  const names = new Set<string>()
  const keys = layer.t?.d?.k
  if (Array.isArray(keys)) {
    for (const kf of keys) {
      const f = kf?.s?.f
      if (typeof f === 'string') names.add(f)
    }
  }
  return names
}

/** Text layers using each font of `fonts.list` (every listed font has an entry). */
export function fontUsage(anim: Animation): Map<string, NodePath[]> {
  const usage = new Map<string, NodePath[]>()
  for (const font of anim.fonts?.list ?? []) usage.set(font.fName, [])
  forEachLayer(anim, (layer, path) => {
    if (layer.ty !== LayerType.Text) return
    for (const name of textLayerFonts(layer as TextLayer)) {
      const list = usage.get(name)
      if (list) list.push(path)
    }
  })
  return usage
}

/** Font names referenced by text layers but missing from `fonts.list`. */
export function undefinedFonts(anim: Animation): string[] {
  const known = new Set((anim.fonts?.list ?? []).map((f) => f.fName))
  const missing = new Set<string>()
  forEachLayer(anim, (layer) => {
    if (layer.ty !== LayerType.Text) return
    for (const name of textLayerFonts(layer as TextLayer)) if (!known.has(name)) missing.add(name)
  })
  return [...missing]
}

export type FontOrigin = 'local' | 'css' | 'script' | 'file'

/** Where a player loads the font from (`fOrigin` letter or numeric `origin`). */
export function fontOrigin(font: Font): FontOrigin {
  const letter = font.fOrigin
  const n = font.origin
  if (letter === 'g' || n === 1) return 'css'
  if (letter === 't' || n === 2) return 'script'
  if (letter === 'p' || n === 3) return 'file'
  return 'local'
}

const withoutSpaces = (s: string) => s.trim().replace(/\s+/g, '')

/** "Roboto" + "Bold Italic" → "Roboto-BoldItalic" (PostScript-like, as After Effects writes it). */
export function fontNameFor(family: string, style: string): string {
  const f = withoutSpaces(family) || 'Font'
  const s = withoutSpaces(style)
  return s ? `${f}-${s}` : f
}

/** First font name derived from `base` that is not used in `fonts.list`. */
export function uniqueFontName(anim: Pick<Animation, 'fonts'>, base: string): string {
  const taken = new Set((anim.fonts?.list ?? []).map((f) => f.fName))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const name = `${base}-${n}`
    if (!taken.has(name)) return name
  }
}

/*
 * lottie-web derives the CSS weight from single style words (bold, black, medium, light…), so
 * "SemiBold" or "ExtraBold" render as regular unless `fWeight` says otherwise.
 */
const STYLE_WEIGHTS: [RegExp, string][] = [
  [/\b(thin|hairline)\b/, '100'],
  [/\b(extra|ultra)[\s-]?light\b/, '200'],
  [/\blight\b/, '300'],
  [/\b(semi|demi)[\s-]?bold\b/, '600'],
  [/\b(extra|ultra)[\s-]?bold\b/, '800'],
  [/\bbold\b/, '700'],
  [/\b(black|heavy)\b/, '900'],
  [/\bmedium\b/, '500'],
  [/\b(regular|normal|book|roman|italic|oblique)\b/, '400'],
]

/** CSS weight implied by a style name ("SemiBold Italic" → "600"), or undefined when unknown. */
export function fontWeightFor(style: string): string | undefined {
  const s = style.toLowerCase()
  return STYLE_WEIGHTS.find(([re]) => re.test(s))?.[1]
}

export interface NewFont {
  family: string
  style?: string
  /** Defaults to a unique name derived from family and style. */
  name?: string
  ascent?: number
}

/** Adds a local font entry and returns its `fName`. */
export function addFont(anim: Animation, font: NewFont): string {
  const style = font.style?.trim() || 'Regular'
  const fName = uniqueFontName(anim, font.name?.trim() || fontNameFor(font.family, style))
  anim.fonts ??= { list: [] }
  anim.fonts.list ??= []
  const entry: Font = {
    fName,
    fFamily: font.family.trim(),
    fStyle: style,
    fOrigin: 'n',
    fPath: '',
    ascent: font.ascent ?? 75,
  }
  const weight = fontWeightFor(style)
  if (weight) entry.fWeight = weight
  anim.fonts.list.push(entry)
  return fName
}

export type FontPatch = Partial<Pick<Font, 'fFamily' | 'fStyle' | 'fWeight' | 'fPath' | 'ascent'>>

/** Updates fields of a font entry (its `fName` stays, so text layers keep using it). */
export function updateFont(anim: Animation, fName: string, patch: FontPatch): boolean {
  const font = anim.fonts?.list?.find((f) => f.fName === fName)
  if (!font) return false
  let changed = false
  for (const [key, value] of Object.entries(patch) as [
    keyof FontPatch,
    string | number | undefined,
  ][]) {
    if (value === undefined || font[key] === value) continue
    ;(font as unknown as Record<string, unknown>)[key] =
      typeof value === 'string' ? value.trim() : value
    changed = true
  }
  // A new style implies a new weight, unless the caller set one explicitly.
  if (patch.fStyle !== undefined && patch.fWeight === undefined) {
    const weight = fontWeightFor(patch.fStyle)
    if (weight && font.fWeight !== weight) {
      font.fWeight = weight
      changed = true
    } else if (!weight && font.fWeight) {
      delete font.fWeight
      changed = true
    }
  }
  return changed
}

/** Renames a font (`fName`) and every text document keyframe referencing it. */
export function renameFont(anim: Animation, oldName: string, newName: string): boolean {
  const next = newName.trim()
  const list = anim.fonts?.list
  if (!next || next === oldName || !list) return false
  if (list.some((f) => f.fName === next)) return false
  const font = list.find((f) => f.fName === oldName)
  if (!font) return false
  font.fName = next
  forEachLayer(anim, (layer) => {
    if (layer.ty !== LayerType.Text) return
    for (const kf of (layer as TextLayer).t?.d?.k ?? []) {
      if (kf?.s && kf.s.f === oldName) kf.s.f = next
    }
  })
  return true
}

/** Removes a font entry (callers should only remove fonts no text layer uses). */
export function removeFont(anim: Animation, fName: string): boolean {
  const list = anim.fonts?.list
  if (!list) return false
  const index = list.findIndex((f) => f.fName === fName)
  if (index < 0) return false
  list.splice(index, 1)
  return true
}
