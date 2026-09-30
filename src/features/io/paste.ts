/**
 * Paste handler: full Lottie JSON (also wrapped, or as a JS snippet) opens as a document; an
 * http(s) link opens "Open from URL" and starts the download. On the optimizer page both become
 * files for its queue instead. Clipboard formats of other features (marked with `__lottieEditor`)
 * and image links are left alone.
 */
import { strToU8 } from 'fflate'
import { currentRoute } from '@/app/router'
import { dispatchFiles } from '@/commands/files'
import { CLIPBOARD_MARKER, type PasteData } from '@/commands/paste'
import { getT } from '@/i18n'
import { sanitizeFileName } from '@/lib/download'
import { animationName, findLotties, readLottieBytes, type OpenResult } from '@/lottie/formats'
import { looksLikeImageUrl, normalizeUrl } from './fetchUrl'
import { describeOpenError } from './messages'
import { notifyError } from './notify'
import { presentResult } from './open'
import { showOpenUrl } from './urlDownload'

async function openText(text: string): Promise<void> {
  const t = getT()
  let result: OpenResult
  try {
    result = readLottieBytes(strToU8(text), 'animation.json')
  } catch (err) {
    notifyError(describeOpenError(err, null, t))
    return
  }
  const name = animationName(result.animations[0].data.nm)
  const fileName = `${sanitizeFileName(name || 'animation')}.json`
  // The optimizer page takes files (its file handler turns them into jobs): hand it one.
  if (currentRoute() === 'optimize') {
    await dispatchFiles([new File([text], fileName, { type: 'application/json' })])
    return
  }
  await presentResult(result, { source: 'paste', fileName })
}

const JS_SNIPPET = /^(export\s|module\.exports|(var|let|const)\s)/

/** Paste handler (priority 0); returns true when the clipboard content was opened. */
export async function handlePaste({ text, json }: PasteData): Promise<boolean> {
  if (json !== undefined) {
    if (json && typeof json === 'object' && CLIPBOARD_MARKER in json) return false
    if (!findLotties(json).length) return false
    await openText(text)
    return true
  }
  const trimmed = text.trim()
  // A JavaScript snippet around an animation, or an animation with a JSON error: open it (the
  // error message then says where the JSON breaks) instead of silently ignoring the paste.
  if ((JS_SNIPPET.test(trimmed) || trimmed.startsWith('{')) && trimmed.includes('"layers"')) {
    await openText(trimmed)
    return true
  }
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    const url = normalizeUrl(trimmed)
    if (!url || looksLikeImageUrl(url.url)) return false
    showOpenUrl(trimmed, true)
    return true
  }
  return false
}
