/**
 * Reading image files (drop, paste, file picker) into embeddable data URIs.
 */
import { extensionToMime } from '@/lottie/assets'

/** Types browsers render and lottie-web can embed. */
export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg'

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])

export function isImageFile(file: File): boolean {
  if (IMAGE_TYPES.has(file.type)) return true
  const mime = extensionToMime(file.name)
  return !!mime && IMAGE_TYPES.has(mime)
}

export interface LoadedImage {
  dataUri: string
  w: number
  h: number
  /** File name without extension (used for new asset and layer names). */
  name: string
  fileName: string
  bytes: number
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Could not read the file')),
    )
    reader.readAsDataURL(file)
  })
}

/** Size an SVG declares (width/height, else its viewBox), for files without intrinsic size. */
async function svgSize(file: Blob): Promise<{ w: number; h: number } | null> {
  try {
    const text = await file.text()
    const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? ''
    const num = (attr: string) => {
      const m = new RegExp(`\\b${attr}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, 'i').exec(tag)
      return m ? Number(m[1]) : NaN
    }
    const w = num('width')
    const h = num('height')
    if (w > 0 && h > 0) return { w, h }
    const vb =
      /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag)
    if (vb) return { w: Number(vb[1]), h: Number(vb[2]) }
  } catch {
    // Unreadable SVG text: fall through to the defaults.
  }
  return null
}

/**
 * Reads an image file as a base64 data URI with its pixel size.
 * Throws when the file is not an image the browser can decode.
 */
export async function readImageFile(file: File): Promise<LoadedImage> {
  let dataUri = await readAsDataUrl(file)
  // Some systems report no type for SVG/WebP: fix the media type from the extension.
  const mime = IMAGE_TYPES.has(file.type) ? file.type : extensionToMime(file.name)
  if (!mime || !IMAGE_TYPES.has(mime))
    throw new Error(`Unsupported image type: ${file.type || file.name}`)
  if (!dataUri.startsWith(`data:${mime}`))
    dataUri = `data:${mime};base64,${dataUri.slice(dataUri.indexOf(',') + 1)}`

  const img = new Image()
  img.src = dataUri
  await img.decode()
  let w = img.naturalWidth
  let h = img.naturalHeight
  if (mime === 'image/svg+xml') {
    const declared = await svgSize(file)
    if (declared) {
      w = declared.w
      h = declared.h
    }
  }
  if (!(w > 0) || !(h > 0)) {
    w = 512
    h = 512
  }
  return {
    dataUri,
    w: Math.round(w),
    h: Math.round(h),
    name: file.name.replace(/\.[^.]+$/, '') || 'Image',
    fileName: file.name,
    bytes: file.size,
  }
}

/**
 * Center-crops an image to the proportions of w×h, so it fills that size identically in every
 * player (lottie-web crops to fill, but mobile players stretch bitmaps to the asset size).
 * Raster images keep their full resolution; SVGs are rasterized at twice the target size.
 */
export async function cropToAspect(image: LoadedImage, w: number, h: number): Promise<LoadedImage> {
  const target = w / h
  if (Math.abs(image.w / image.h - target) <= target * 0.001) return image
  const img = new Image()
  img.src = image.dataUri
  await img.decode()
  const nw = img.naturalWidth || image.w
  const nh = img.naturalHeight || image.h
  let sw = nw
  let sh = nh
  if (nw / nh > target) sw = nh * target
  else sh = nw / target
  const svg = image.dataUri.startsWith('data:image/svg')
  const outW = Math.max(1, Math.round(svg ? w * 2 : sw))
  const outH = Math.max(1, Math.round(svg ? h * 2 : sh))
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (nw - sw) / 2, (nh - sh) / 2, sw, sh, 0, 0, outW, outH)
  const mime = /^data:image\/(jpeg|webp)/.exec(image.dataUri)
    ? image.dataUri.slice(5, image.dataUri.indexOf(';'))
    : 'image/png'
  const dataUri = canvas.toDataURL(mime, 0.92)
  return {
    ...image,
    dataUri,
    w: outW,
    h: outH,
    bytes: Math.round(((dataUri.length - dataUri.indexOf(',') - 1) * 3) / 4),
  }
}

/** Opens the system file picker; resolves with the chosen files ([] when cancelled). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true })
    input.addEventListener('cancel', () => resolve([]), { once: true })
    input.click()
  })
}
