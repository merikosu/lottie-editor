/**
 * Reading image files for new image layers (embedded as data URIs).
 */

/** Image types every browser renders (and lottie-web can embed). */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'

export interface ImageFileData {
  dataUri: string
  w: number
  h: number
  /** File name without extension. */
  name: string
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

/** Reads an image file as a data URI with its natural size. Throws when it is not an image. */
export async function readImageFile(file: File): Promise<ImageFileData> {
  const dataUri = await readAsDataUrl(file)
  if (!dataUri.startsWith('data:image/')) throw new Error(`Not an image: ${file.type || file.name}`)
  const img = new Image()
  img.src = dataUri
  await img.decode()
  // SVGs without intrinsic size report 0×0: give them a sensible default.
  const w = img.naturalWidth || 512
  const h = img.naturalHeight || 512
  return { dataUri, w, h, name: file.name.replace(/\.[^.]+$/, '') || 'Image' }
}

/** Opens the system file picker for one image; resolves null when cancelled. */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = IMAGE_ACCEPT
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}
