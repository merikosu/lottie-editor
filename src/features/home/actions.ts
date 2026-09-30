/**
 * What the home page does with files: open them in the editor or Customize, or hand them to the
 * optimizer. Opening goes through the io feature (formats, repairs, recents, autosave), which also
 * switches to the chosen page once the document is open.
 */
import { navigate, type Route } from '@/app/router'
import { dispatchFiles } from '@/commands/files'
import { getCommand, isCommandEnabled, runCommand } from '@/commands/registry'
import {
  buildDownload,
  describeOpenError,
  explainUnhandledFiles,
  notifyError,
  openFiles,
  readDocument,
  type DocumentRoute,
  type RecentEntry,
} from '@/features/io'
import { getT } from '@/i18n'
import { isImageFileName } from '@/lottie/formats'
import { findSample } from '@/samples'
import { useDocument } from '@/store/document'

/** The three services of the app, in the order the home page and the top bar show them. */
export type ServiceRoute = Exclude<Route, 'home'>

/** The command the optimizer registers to take the open animation (with "replace in editor"). */
const OPTIMIZE_DOCUMENT = 'anim.optimize'

const isImage = (file: File) => isImageFileName(file.name, file.type)

/**
 * Resolves once a page switch has taken effect: React renders the new page right away, but pages
 * finish setting up (and may register handlers) in effects; two frames later all of that has run.
 */
function afterPageSwitch(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

/** Opens files in the editor or Customize (the first animation among them; see io's openFiles). */
export async function openIn(route: DocumentRoute, files: File[]): Promise<void> {
  if (await openFiles(files, { route })) return
  // No animation among them: images belong to the open animation, anything else is explained.
  if (useDocument.getState().doc && files.every(isImage)) {
    navigate(route)
    await afterPageSwitch()
    await dispatchFiles(files)
    return
  }
  await explainUnhandledFiles(files)
}

/** Hands files to the optimizer, whose file handler takes them while its page is showing. */
export async function sendToOptimizer(files: File[]): Promise<void> {
  if (!files.length) return
  navigate('optimize')
  await afterPageSwitch()
  await dispatchFiles(files)
}

/** Opens files dropped on (or chosen from) a service card in that service. */
export function openInService(route: ServiceRoute, files: File[]): Promise<void> {
  return route === 'optimize' ? sendToOptimizer(files) : openIn(route, files)
}

/** True when the optimizer can take the open animation directly (its own command). */
export function canOptimizeDocument(): boolean {
  return isCommandEnabled(getCommand(OPTIMIZE_DOCUMENT))
}

/**
 * Sends the open animation to the optimizer: through the optimizer's command when it is there
 * (its result can replace the document), else as a file, like one dropped on its page.
 */
export async function optimizeDocument(): Promise<void> {
  if (canOptimizeDocument()) {
    runCommand(OPTIMIZE_DOCUMENT)
    return
  }
  const { doc, meta } = useDocument.getState()
  if (!doc || !meta) return
  try {
    const { blob, fileName } = buildDownload(doc, meta)
    await sendToOptimizer([new File([blob], fileName, { type: blob.type })])
  } catch (err) {
    notifyError(describeOpenError(err, meta.fileName, getT()))
  }
}

/** Sends a recent file to the optimizer (the open one goes as the document). */
export async function optimizeRecent(entry: RecentEntry): Promise<void> {
  if (useDocument.getState().meta?.id === entry.id) return optimizeDocument()
  try {
    const data = await readDocument(entry.id)
    if (!data) throw new Error(`"${entry.fileName}" is no longer stored`)
    const { blob, fileName } = buildDownload(data.stored.doc, data.stored.meta)
    await sendToOptimizer([new File([blob], fileName, { type: blob.type })])
  } catch (err) {
    notifyError(describeOpenError(err, entry.fileName, getT()))
  }
}

/** Sends a built-in sample to the optimizer. */
export async function optimizeSample(id: string): Promise<void> {
  const sample = findSample(id)
  if (!sample) return
  try {
    const data = await sample.load()
    const file = new File([JSON.stringify(data)], `${id}.json`, { type: 'application/json' })
    await sendToOptimizer([file])
  } catch (err) {
    notifyError(describeOpenError(err, `${id}.json`, getT()))
  }
}
