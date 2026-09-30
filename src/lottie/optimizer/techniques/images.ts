/**
 * `images` (browser and workers only): re-encodes embedded raster images.
 *
 * Each embedded PNG / JPEG / WebP is decoded with `createImageBitmap`, optionally downscaled to
 * the largest size it is ever displayed at (its asset size × the magnification of the layers
 * showing it, × `maxScale` for dense screens), and encoded with OffscreenCanvas in the candidate
 * formats: WebP (keeps transparency), JPEG (opaque images only), PNG. The smallest candidate
 * wins only when it is smaller than the original; otherwise the original bytes stay. The asset's
 * display size (`w`, `h`) never changes, so layouts are unaffected. SVG, GIF and animated images
 * (APNG, animated WebP) are skipped: re-encoding would flatten them.
 */
import { bytesToBase64, parseDataUri, sniffMime } from '../../dotlottie'
import { imageHeaderInfo } from '../../stats'
import { arr, compLayers, isObj, listComps, num, type Json } from '../model'
import { SpaceScales } from '../scale'
import type { ImageFormat, ImageReport } from '../types'
import { throwIfAborted, type TechniqueContext, type TechniqueDetails } from './context'

interface CanvasLike {
  getContext(type: '2d'): {
    drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray }
    imageSmoothingQuality?: string
  } | null
  convertToBlob(opts: { type: string; quality?: number }): Promise<Blob>
}

interface ImageEnv {
  createImageBitmap(blob: Blob): Promise<{ width: number; height: number; close(): void }>
  OffscreenCanvas: new (w: number, h: number) => CanvasLike
}

/** The browser APIs the technique needs, when available (also in workers). */
export function imageEnvironment(): ImageEnv | null {
  const g = globalThis as unknown as Partial<ImageEnv> & { createImageBitmap?: unknown }
  if (typeof g.createImageBitmap !== 'function' || typeof g.OffscreenCanvas !== 'function')
    return null
  return {
    createImageBitmap: (blob) => (g.createImageBitmap as ImageEnv['createImageBitmap'])(blob),
    OffscreenCanvas: g.OffscreenCanvas as ImageEnv['OffscreenCanvas'],
  }
}

/** True for animated PNG (acTL chunk before the image data) or animated WebP (ANIM chunk). */
export function isAnimatedImage(bytes: Uint8Array, mime: string): boolean {
  const ascii = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n))
  if (mime === 'image/png') {
    let pos = 8
    while (pos + 8 <= bytes.length) {
      const len =
        ((bytes[pos] << 24) >>> 0) +
        ((bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3])
      const type = ascii(pos + 4, 4)
      if (type === 'acTL') return true
      if (type === 'IDAT' || type === 'IEND') return false
      pos += 12 + len
    }
    return false
  }
  if (mime === 'image/webp') {
    for (let i = 12; i + 4 <= Math.min(bytes.length, 4096); i++)
      if (ascii(i, 4) === 'ANIM') return true
  }
  return false
}

/** Largest magnification (composition px per image px) of each image asset over its layers. */
export function imageDisplayScales(doc: Json): Map<string, number> {
  const scales = new SpaceScales(doc)
  const out = new Map<string, number>()
  for (const comp of listComps(doc)) {
    for (const layer of compLayers(comp)) {
      if (layer.ty !== 2 || typeof layer.refId !== 'string') continue
      const s = scales.of({ kind: 'layerContent', layer, comp })
      out.set(layer.refId, Math.max(out.get(layer.refId) ?? 0, s))
    }
  }
  return out
}

const CANDIDATES: Record<ImageFormat, string[]> = {
  auto: ['image/webp', 'image/jpeg'],
  webp: ['image/webp'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
}

function hasAlpha(
  ctx: NonNullable<ReturnType<CanvasLike['getContext']>>,
  w: number,
  h: number,
): boolean {
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true
  return false
}

export async function images(tc: TechniqueContext): Promise<TechniqueDetails> {
  const env = imageEnvironment()
  const assets = arr(tc.doc.assets).filter(
    (a): a is Json =>
      isObj(a) && !Array.isArray(a.layers) && typeof a.p === 'string' && /^data:image\//i.test(a.p),
  )
  if (assets.length === 0) return { images: 0, downscaled: 0 }
  if (!env) {
    tc.warn('imagesUnavailable', assets.length)
    return { images: 0, downscaled: 0 }
  }
  const { format, quality, maxScale } = tc.options.image
  const display = imageDisplayScales(tc.doc)
  let changed = 0
  let downscaled = 0
  let webp = 0
  let failed = 0
  for (const asset of assets) {
    throwIfAborted(tc.signal)
    const id = String(asset.id ?? '')
    const parsed = parseDataUri(asset.p as string)
    const mime = parsed ? (sniffMime(parsed.bytes) ?? parsed.mime) : 'unknown'
    const header = parsed ? imageHeaderInfo(parsed.bytes.subarray(0, 256 * 1024)) : null
    const before = {
      mime,
      bytes: parsed?.bytes.length ?? 0,
      width: header?.width,
      height: header?.height,
    }
    const report: ImageReport = { id, action: 'kept', before, after: before }
    tc.images.push(report)
    if (!parsed || !/^image\/(png|jpeg|webp)$/.test(mime)) {
      report.action = 'skipped'
      report.reason = mime === 'image/svg+xml' ? 'svg' : mime === 'image/gif' ? 'gif' : 'format'
      continue
    }
    if (typeof asset.sid === 'string') {
      report.action = 'skipped'
      report.reason = 'slot'
      continue
    }
    if (isAnimatedImage(parsed.bytes, mime)) {
      report.action = 'skipped'
      report.reason = 'animated'
      continue
    }
    let bitmap: { width: number; height: number; close(): void }
    try {
      bitmap = await env.createImageBitmap(new Blob([parsed.bytes as BlobPart], { type: mime }))
    } catch {
      report.action = 'skipped'
      report.reason = 'decode'
      failed++
      continue
    }
    try {
      // Target size: never above the displayed size × maxScale (0 keeps the bitmap size).
      let w = bitmap.width
      let h = bitmap.height
      const aw = num(asset.w) ?? w
      const ah = num(asset.h) ?? h
      const s = display.get(id) ?? 0
      if (maxScale > 0 && s > 0 && aw > 0 && ah > 0) {
        const fit = Math.min(1, (aw * s * maxScale) / w, (ah * s * maxScale) / h)
        // Resampling costs sharpness: only worth it for a real reduction.
        if (fit < 0.9) {
          w = Math.max(1, Math.round(w * fit))
          h = Math.max(1, Math.round(h * fit))
        }
      }
      const canvas = new env.OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No 2D context')
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, w, h)
      const resized = w !== bitmap.width || h !== bitmap.height
      const alpha = mime === 'image/jpeg' ? false : hasAlpha(ctx, w, h)
      let best: { type: string; bytes: Uint8Array } | null = null
      for (const type of CANDIDATES[format]) {
        if (type === 'image/jpeg' && alpha) continue
        const blob = await canvas.convertToBlob({ type, quality })
        // Browsers fall back to PNG for types they cannot encode (Safari: WebP).
        if (blob.type !== type) continue
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (!best || bytes.length < best.bytes.length) best = { type, bytes }
      }
      if (!best || best.bytes.length >= parsed.bytes.length) {
        report.reason = best ? 'larger' : 'encoder'
        continue
      }
      asset.p = `data:${best.type};base64,${bytesToBase64(best.bytes)}`
      asset.e = 1
      if (typeof asset.u === 'string') asset.u = ''
      report.action = resized ? 'downscaled' : 'reencoded'
      report.after = { mime: best.type, bytes: best.bytes.length, width: w, height: h }
      changed++
      if (resized) downscaled++
      if (best.type === 'image/webp') webp++
    } catch {
      report.action = 'skipped'
      report.reason = 'encoder'
    } finally {
      bitmap.close()
    }
  }
  if (webp) tc.warn('webp', webp)
  if (downscaled) tc.warn('imagesDownscaled', downscaled)
  if (failed) tc.warn('imageDecodeFailed', failed)
  return { images: changed, downscaled }
}
