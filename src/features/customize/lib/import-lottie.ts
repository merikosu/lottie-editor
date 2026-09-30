/**
 * "Import Lottie as layer": another animation becomes a precomp in the open document.
 *
 * The imported animation is wrapped into an editor layers payload — one precomp layer showing a
 * new composition that holds the imported root layers, plus the imported assets, fonts and
 * glyphs — and pasted with `pasteLayers`, which already does everything an import needs:
 * times are converted to the document's frame rate (durations in seconds are kept), assets are
 * merged (identical ones reused, conflicting ids renamed, references remapped) and fonts added.
 */
import { compInfoAt } from '@/lottie/create'
import { pasteLayers, type LayersClipboard } from '@/lottie/layer-ops'
import { getAt, type NodePath } from '@/lottie/path'
import type { Animation, Asset, Layer, PrecompAsset, PrecompLayer } from '@/lottie/types'

export interface ImportLottieOptions {
  /** Composition to insert into: `['layers']` or `['assets', i, 'layers']`. */
  compPath: NodePath
  /** Position in the layer list (0 = top). */
  index: number
  /** Name of the new layer and composition (e.g. the file name without extension). */
  name: string
}

const stat = <T>(k: T): { a: 0; k: T } => ({ a: 0, k })

/** JSON copy: detaches the source (it may be a frozen document or shared data). */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function uniqueId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 0; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * Builds the payload that pastes `source` as one precomp layer. The layer shows the source's
 * first frame at its in point (frame 0 of the payload's time), is centered in a `target`-sized
 * composition and scaled down to fit it when the source is larger.
 */
export function importPayload(
  source: Animation,
  target: { w: number; h: number },
  name: string,
): LayersClipboard {
  const assets = cloneJson<Asset[]>(Array.isArray(source.assets) ? source.assets : [])
  const compId = uniqueId('comp_', new Set(assets.map((a) => a.id)))
  const w = positive(source.w) ? source.w : target.w
  const h = positive(source.h) ? source.h : target.h
  const ip = Number.isFinite(source.ip) ? source.ip : 0
  const op = Number.isFinite(source.op) && source.op > ip ? source.op : ip + 1
  const fit = Math.min(1, target.w / w, target.h / h)
  const scale = Math.round(fit * 100 * 1000) / 1000

  const comp: PrecompAsset = {
    id: compId,
    nm: name,
    layers: cloneJson<Layer[]>(Array.isArray(source.layers) ? source.layers : []),
  }
  const layer = {
    ddd: 0,
    ind: 1,
    ty: 0,
    nm: name,
    refId: compId,
    sr: 1,
    ks: {
      o: stat(100),
      r: stat(0),
      p: stat([target.w / 2, target.h / 2, 0]),
      a: stat([w / 2, h / 2, 0]),
      s: stat([scale, scale, 100]),
    },
    ao: 0,
    w,
    h,
    ip: 0,
    op: op - ip,
    // Inner frame = outer − st: the source's in point shows at the layer's in point.
    st: -ip,
    bm: 0,
  } as PrecompLayer

  const payload: LayersClipboard = {
    __lottieEditor: 'layers',
    version: 1,
    kind: 'layers',
    fr: positive(source.fr) ? source.fr : undefined,
    layers: [layer],
    assets: [...assets, comp],
  }
  const fonts = source.fonts?.list
  if (Array.isArray(fonts) && fonts.length) payload.fonts = cloneJson(fonts)
  if (Array.isArray(source.chars) && source.chars.length) payload.chars = cloneJson(source.chars)
  return payload
}

/**
 * Imports `source` into `anim` as a precomp layer at `opts.index` of the composition at
 * `opts.compPath`, starting at that composition's first frame. Mutates `anim` (use inside
 * `updateDoc`). Returns the path of the new layer, or null when nothing could be inserted.
 */
export function importLottieAsLayer(
  anim: Animation,
  source: Animation,
  opts: ImportLottieOptions,
): NodePath | null {
  const info = compInfoAt(anim, opts.compPath)
  const payload = importPayload(source, { w: info.w, h: info.h }, opts.name)
  const [path] = pasteLayers(anim, opts.compPath, payload, opts.index)
  if (!path) return null
  const layer = getAt<Layer>(anim, path)
  if (layer && info.ip !== 0) {
    layer.ip += info.ip
    layer.op += info.ip
    layer.st = (layer.st ?? 0) + info.ip
  }
  return path
}
