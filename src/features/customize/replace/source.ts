/**
 * Reading the file that replaces an element: an SVG (imported as vector shapes) or a raster
 * image (embedded; downscaled when it has far more pixels than the animation can show).
 */
import { fileExtension, fileStem } from '@/lottie/formats'
import { importSvg, SvgImportError, type SvgImportResult } from '@/lottie/svg'
import type { ReplaceContent } from './compute'

/** File types offered by the file picker. */
export const REPLACE_ACCEPT = '.svg,image/svg+xml,image/png,image/jpeg,image/webp'

const RASTER_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export type ReplaceSource =
  | {
      kind: 'svg'
      fileName: string
      name: string
      bytes: number
      svg: SvgImportResult
      /** The file itself, for the thumbnail. */
      previewUrl: string
    }
  | {
      kind: 'image'
      fileName: string
      name: string
      bytes: number
      dataUri: string
      w: number
      h: number
      /** Size of the file's image (larger than w × h when it was downscaled). */
      natural: { w: number; h: number }
    }

export type SourceErrorCode = 'unsupported' | 'read' | SvgImportError['code']

/** A file that cannot replace anything, with the reason (and SVG warnings explaining it). */
export class SourceError extends Error {
  readonly code: SourceErrorCode
  readonly fileName: string
  readonly svgWarnings: SvgImportError['warnings']
  constructor(
    code: SourceErrorCode,
    fileName: string,
    svgWarnings: SvgImportError['warnings'] = [],
  ) {
    super(`${fileName}: ${code}`)
    this.name = 'SourceError'
    this.code = code
    this.fileName = fileName
    this.svgWarnings = svgWarnings
  }
}

function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || fileExtension(file.name) === 'svg'
}

function rasterType(file: File): string | null {
  if (Object.values(RASTER_TYPES).includes(file.type)) return file.type
  return RASTER_TYPES[fileExtension(file.name)] ?? null
}

/** True for files the Replace dialog takes (SVG, PNG, JPEG, WebP). */
export function isReplaceFile(file: File): boolean {
  return isSvgFile(file) || rasterType(file) !== null
}

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Could not read the file')),
    )
    reader.readAsDataURL(file)
  })
}

async function decode(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

/** Redraws `img` at most `maxSide` pixels on its longer side (null when it is small enough). */
function downscale(
  img: HTMLImageElement,
  type: string,
  maxSide: number,
): { dataUri: string; w: number; h: number } | null {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const longest = Math.max(w, h)
  if (longest <= maxSide) return null
  const k = maxSide / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * k))
  canvas.height = Math.max(1, Math.round(h * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  let dataUri = canvas.toDataURL(type, 0.92)
  // Browsers without an encoder for the type fall back to PNG by themselves; say so honestly.
  if (!dataUri.startsWith(`data:${type}`)) dataUri = canvas.toDataURL('image/png')
  return { dataUri, w: canvas.width, h: canvas.height }
}

/**
 * Reads a replacement file. Raster images larger than `maxSide` pixels are downscaled (the
 * animation never shows them bigger). Throws `SourceError`.
 */
export async function readReplaceSource(
  file: File,
  opts: { maxSide: number },
): Promise<ReplaceSource> {
  const name = fileStem(file.name) || file.name
  if (isSvgFile(file)) {
    let text: string
    try {
      text = await file.text()
    } catch {
      throw new SourceError('read', file.name)
    }
    try {
      const svg = importSvg(text, { name })
      return {
        kind: 'svg',
        fileName: file.name,
        name,
        bytes: file.size,
        svg,
        previewUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`,
      }
    } catch (err) {
      if (err instanceof SvgImportError) throw new SourceError(err.code, file.name, err.warnings)
      throw new SourceError('invalid', file.name)
    }
  }
  const type = rasterType(file)
  if (!type) throw new SourceError('unsupported', file.name)
  let dataUri: string
  let img: HTMLImageElement
  try {
    dataUri = await readDataUrl(file)
    img = await decode(dataUri)
  } catch {
    throw new SourceError('read', file.name)
  }
  const natural = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 }
  const small = downscale(img, type, opts.maxSide)
  return {
    kind: 'image',
    fileName: file.name,
    name,
    bytes: file.size,
    dataUri: small?.dataUri ?? dataUri,
    w: small?.w ?? natural.w,
    h: small?.h ?? natural.h,
    natural,
  }
}

/** What the engine inserts for a source. */
export function contentOf(source: ReplaceSource): ReplaceContent {
  return source.kind === 'svg'
    ? { kind: 'shapes', name: source.name, shapes: source.svg.shapes }
    : { kind: 'image', name: source.name, dataUri: source.dataUri, w: source.w, h: source.h }
}

/** Longest side worth embedding for a document: twice its canvas (sharp on 2× screens). */
export function maxImageSide(doc: { w: number; h: number }): number {
  return Math.min(4096, Math.max(512, Math.ceil(2 * Math.max(doc.w, doc.h))))
}
