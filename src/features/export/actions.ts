/**
 * Export actions shared by the dialog and the commands: running an export with progress and
 * cancellation, downloading, copying to the clipboard, and user-facing messages.
 */
import { toast } from '@/components/ui'
import { phaseProgress, type ProgressInfo } from '@/export/progress'
import { isAbortError } from '@/export/render'
import { serializeJson, transformDocument } from '@/export/lottie-files'
import { getT, type Dict } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { downloadBlob } from '@/lib/download'
import { DotLottieError } from '@/lottie/dotlottie'
import { getDoc, markSaved } from '@/store/document'
import { FORMATS, exportKeepsDocument } from './formats'
import { getFormatter } from './format'
import {
  ExportError,
  embedSnippet,
  renderFramePng,
  renderFrameSvg,
  runExport,
  type ExportInput,
  type ExportOutput,
  type ExportWarning,
} from './run'
import { useExportJob, type ExportFormat } from './store'

/* -------------------------------------------------------------------------- */
/*                                  Messages                                  */
/* -------------------------------------------------------------------------- */

/** Translated explanation of an export failure. */
export function describeError(err: unknown, t: Dict = getT()): string {
  const e = t.export.errors
  if (err instanceof ExportError) {
    if (err.code === 'video-unsupported') return e.videoUnsupported
    if (err.code === 'clipboard-unsupported') return e.clipboardImage
    return e.failed
  }
  if (err instanceof DotLottieError && err.code === 'v2-required') return e.v2Required
  if (err instanceof DOMException) {
    if (err.name === 'SecurityError') return e.tainted
    if (err.name === 'QuotaExceededError' || err.name === 'EncodingError') return e.memory
  }
  if (err instanceof RangeError && /memory|allocation|array buffer/i.test(err.message))
    return e.memory
  const detail = err instanceof Error ? err.message : String(err)
  if (/lottie-web|layer|could not build/i.test(detail)) return e.build(detail)
  return detail ? `${e.failed}: ${detail}` : e.failed
}

export function describeWarning(w: ExportWarning, t: Dict = getT()): string {
  switch (w.code) {
    case 'missing-images':
      return t.export.warnings.missingImages(w.count)
    case 'unreachable-images':
      return t.export.warnings.unreachableImages(w.count)
    case 'render-errors':
      return t.export.warnings.renderErrors(w.count)
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Running                                  */
/* -------------------------------------------------------------------------- */

const PROGRESS_INTERVAL_MS = 80

/**
 * Runs an export with progress in the job store. Resolves to the output, or null when it was
 * cancelled or failed (the failure message is in the job store for the dialog to show).
 */
export async function startExport(
  format: ExportFormat,
  input: ExportInput,
): Promise<ExportOutput | null> {
  if (useExportJob.getState().status === 'running') return null
  const controller = new AbortController()
  useExportJob.setState({
    status: 'running',
    format,
    progress: phaseProgress('preparing', 1),
    error: null,
    errorFor: null,
    controller,
  })
  let lastUpdate = 0
  const onProgress = (progress: ProgressInfo) => {
    const now = performance.now()
    const phaseChanged = useExportJob.getState().progress?.phase !== progress.phase
    if (!phaseChanged && progress.done < progress.total && now - lastUpdate < PROGRESS_INTERVAL_MS)
      return
    lastUpdate = now
    useExportJob.setState({ progress })
  }
  try {
    const output = await runExport(format, input, { onProgress, signal: controller.signal })
    useExportJob.setState({ status: 'idle', format: null, progress: null, controller: null })
    return output
  } catch (err) {
    const cancelled = isAbortError(err) || controller.signal.aborted
    if (!cancelled) console.error('Export failed', err)
    useExportJob.setState({
      status: 'idle',
      format: null,
      progress: null,
      controller: null,
      error: cancelled ? null : describeError(err),
      errorFor: cancelled ? null : input.prefs,
    })
    return null
  }
}

/**
 * Saves the file. A faithful Lottie export also counts as saving the document, unless the
 * document changed since the export started.
 */
export function downloadOutput(
  format: ExportFormat,
  output: ExportOutput,
  input: ExportInput,
): void {
  downloadBlob(output.blob, output.fileName)
  if (getDoc() === input.doc && exportKeepsDocument(format, input.prefs, input.doc)) markSaved()
}

/**
 * Long exports end with a toast (the dialog is gone by then); quick ones stay silent unless
 * something was left out of the file.
 */
export function notifyDone(format: ExportFormat, output: ExportOutput): void {
  const t = getT()
  const size = getFormatter().size(output.blob.size)
  const warnings = output.warnings.map((w) => describeWarning(w, t))
  if (FORMATS[format].rendered) {
    const show = warnings.length ? toast.warning : toast.success
    show(t.export.done(output.fileName, size), {
      description: warnings.length ? warnings.join(' ') : undefined,
      duration: 8000,
      action: {
        label: t.export.downloadAgain,
        onClick: () => downloadBlob(output.blob, output.fileName),
      },
    })
  } else if (warnings.length) {
    toast.warning(t.export.done(output.fileName, size), {
      description: warnings.join(' '),
      duration: 8000,
    })
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Clipboard                                 */
/* -------------------------------------------------------------------------- */

/**
 * Writes a PNG to the clipboard. The ClipboardItem is created synchronously with a promise of
 * the image, so Safari still sees the user gesture while the frame renders.
 */
export async function copyPng(blob: Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new ExportError('clipboard-unsupported', 'Image clipboard is not supported')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

/**
 * Copies text. Text that is still being produced goes through a ClipboardItem promise, so the
 * write stays attached to the click (Safari rejects clipboard writes after an await).
 */
async function copyString(text: string | Promise<string>): Promise<boolean> {
  if (
    typeof text !== 'string' &&
    typeof ClipboardItem !== 'undefined' &&
    navigator.clipboard?.write
  ) {
    const blob = text.then((value) => new Blob([value], { type: 'text/plain' }))
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
    return true
  }
  if (await copyText(await text)) return true
  throw new Error('copy failed')
}

/** Results the dialog already computed for the current options (reused when up to date). */
export interface CopyCache {
  svgFrame?: { value?: { markup: string }; pending: boolean }
}

/** Copies the export of a format (with the dialog's options). Returns false on failure. */
export async function copyExport(
  format: ExportFormat,
  input: ExportInput,
  cached?: CopyCache,
): Promise<boolean> {
  const t = getT()
  try {
    switch (format) {
      case 'json':
        return await copyString(
          serializeJson(transformDocument(input.doc, input.prefs.json), input.prefs.json.pretty),
        )
      case 'embed':
        return await copyString(embedSnippet(input.doc, input.prefs, input.fileName).code)
      case 'frameSvg': {
        // A pending result belongs to the previous frame or size: render the current one.
        const markup =
          cached?.svgFrame && !cached.svgFrame.pending ? cached.svgFrame.value?.markup : undefined
        return await copyString(markup ?? renderFrameSvg(input).then((r) => r.markup))
      }
      case 'framePng':
        await copyPng(renderFramePng(input).then((r) => r.blob))
        return true
      default:
        return false
    }
  } catch (err) {
    console.warn('Copy failed', err)
    toast.error(err instanceof ExportError ? describeError(err, t) : t.export.errors.clipboard)
    return false
  }
}
