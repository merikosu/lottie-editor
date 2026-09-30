/**
 * ⌘S: downloads the document in the format it came in (.json, .lottie with every other
 * animation/theme/state machine preserved, or .tgs).
 */
import { getT } from '@/i18n'
import { downloadBlob, sanitizeFileName, withExtension } from '@/lib/download'
import { writeDotLottie } from '@/lottie/dotlottie'
import { fileStem, writeTgs } from '@/lottie/formats'
import type { Animation } from '@/lottie/types'
import { markSaved, useDocument, type DocumentMeta } from '@/store/document'
import { describeSaveError } from './messages'
import { notifyError } from './notify'
import { containerOf, isTgsSource } from './source'

/** Builds the file ⌘S downloads. Throws DotLottieError when the container cannot be written. */
export function buildDownload(
  doc: Animation,
  meta: Pick<DocumentMeta, 'fileName' | 'format' | 'dotLottie'>,
): {
  blob: Blob
  fileName: string
} {
  const base = sanitizeFileName(meta.fileName, 'animation')
  if (meta.format === 'lottie') {
    const container = containerOf(meta.dotLottie)
    const bytes = writeDotLottie({
      animations: [{ id: container?.activeId ?? fileStem(base), data: doc }],
      container: container ?? undefined,
    })
    return {
      blob: new Blob([bytes], { type: 'application/zip' }),
      fileName: withExtension(base, 'lottie'),
    }
  }
  if (isTgsSource(meta.dotLottie)) {
    return {
      blob: new Blob([writeTgs(doc)], { type: 'application/gzip' }),
      fileName: withExtension(base, 'tgs'),
    }
  }
  return {
    blob: new Blob([JSON.stringify(doc)], { type: 'application/json' }),
    fileName: withExtension(base, 'json'),
  }
}

/** Downloads the open document and marks it saved. Returns false when nothing was downloaded. */
export function downloadCurrent(): boolean {
  const { doc, meta } = useDocument.getState()
  if (!doc || !meta) return false
  try {
    const { blob, fileName } = buildDownload(doc, meta)
    downloadBlob(blob, fileName)
    markSaved()
    return true
  } catch (err) {
    notifyError(describeSaveError(err, getT()))
    return false
  }
}
