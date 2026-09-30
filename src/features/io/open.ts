/**
 * Opening documents: files (Open dialog, drop, paste), links, samples and new documents.
 * Every path ends in `loadDocument` with a registered DocumentInfo, so autosave, recent
 * files and the "opened with repairs" summary behave the same everywhere.
 */
import { currentRoute, navigate } from '@/app/router'
import { dispatchFiles } from '@/commands/files'
import { toast } from '@/components/ui'
import { getT } from '@/i18n'
import { sanitizeFileName } from '@/lib/download'
import { uid } from '@/lib/id'
import { createAnimation } from '@/lottie/document'
import { createDotLottieContainer, switchContainerAnimation } from '@/lottie/dotlottie'
import {
  OPEN_ACCEPT,
  fileExtension,
  fileStem,
  isImageFileName,
  isLottieFileName,
  readLottieBytes,
  sniffFormat,
  type NamedBytes,
  type OpenResult,
  type OpenedAnimation,
} from '@/lottie/formats'
import { findSample } from '@/samples'
import { isDirty, loadDocument, useDocument } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { openDialog } from '@/store/ui'
import { afterPendingWrites, scheduleThumbnail, setDocumentInfo } from './autosave'
import { confirmReplace } from './confirm'
import { DIALOG, type DocumentRoute, type OpenInfo, type PickerProps } from './dialog-ids'
import { describeOpenError, summarizeOpen } from './messages'
import { notifyError, notifyInfo, notifyWarning } from './notify'
import { revealDocument } from './reveal'
import { removeRecentEntry } from './session'
import { TGS_SOURCE, containerOf } from './source'
import { MAX_RECENTS, writeDocument, type RecentEntry } from './storage'
import { setOpening, setRecents } from './store'

/* -------------------------------------------------------------------------- */
/*                                   Loading                                  */
/* -------------------------------------------------------------------------- */

function documentFileName(result: OpenResult, opened: OpenedAnimation, info: OpenInfo): string {
  if (info.fileName) return info.fileName
  if (result.kind === 'dotlottie' || result.kind === 'tgs') return result.fileName
  if (result.animations.length > 1) return `${sanitizeFileName(opened.id)}.json`
  const ext = fileExtension(result.fileName)
  return ext === 'json' ? result.fileName : `${fileStem(result.fileName)}.json`
}

/** Loads one animation of an opened file and reports repairs and warnings once. */
export function loadOpened(result: OpenResult, animationId: string, info: OpenInfo): void {
  const t = getT()
  const opened = result.animations.find((a) => a.id === animationId) ?? result.animations[0]
  const dotLottie = result.kind === 'dotlottie' && result.dotLottie ? result.dotLottie : null
  const id = uid('doc')
  setDocumentInfo(id, {
    source: info.source,
    contentKey: `${result.fileName}|${result.size}|${opened.id}`,
    animationId: result.animations.length > 1 ? opened.id : undefined,
  })
  loadDocument(opened.data, {
    id,
    fileName: documentFileName(result, opened, info),
    format: dotLottie ? 'lottie' : 'json',
    sourceSize: result.size,
    dotLottie: sourceOf(result, opened),
  })
  revealDocument(info.route)
  const summary = summarizeOpen(opened.repairs, result.warnings, t)
  if (summary) notifyWarning(summary)
}

/**
 * Asks for confirmation if needed, then loads the file (or lets the user pick an animation).
 * Resolves false when the user kept the current document.
 */
export async function presentResult(result: OpenResult, info: OpenInfo): Promise<boolean> {
  if (!(await confirmReplace())) return false
  if (result.animations.length > 1) {
    openDialog(DIALOG.picker, { mode: 'open', result, info } satisfies PickerProps)
    return true
  }
  loadOpened(result, result.activeId, info)
  return true
}

/** Lets the browser paint (the "Opening…" state) before a long synchronous parse. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

/** Files above this size take long enough to parse that the user should see progress. */
const LARGE_FILE_BYTES = 1_000_000

/** True when the page on screen shows the "Opening…" state itself (see `useIo().opening`). */
function showsOpeningInline(): boolean {
  const route = currentRoute()
  return route === 'home' || (route === 'edit' && !useDocument.getState().doc)
}

/**
 * Reads a file into an OpenResult. Progress shows on the start pages ("Opening…"), or as a toast
 * anywhere else when reading or parsing takes a while. Throws on failure.
 */
export async function readForOpen(file: File, images: NamedBytes[] = []): Promise<OpenResult> {
  const t = getT()
  setOpening(file.name)
  let toastId: string | number | undefined
  const showProgress = () => {
    if (toastId === undefined && !showsOpeningInline())
      toastId = toast.loading(t.io.welcome.opening(file.name))
  }
  // A slow read (network drive, huge file) gets the toast after a moment…
  const slow = setTimeout(showProgress, 400)
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length > LARGE_FILE_BYTES) {
      // …and a large file right away: parsing blocks the page, so paint the state first.
      showProgress()
      await nextPaint()
    }
    return readLottieBytes(bytes, file.name, { images })
  } finally {
    clearTimeout(slow)
    setOpening(null)
    if (toastId !== undefined) toast.dismiss(toastId)
  }
}

/* -------------------------------------------------------------------------- */
/*                                    Files                                   */
/* -------------------------------------------------------------------------- */

/** Relative paths of files that came from a dropped folder (File objects don't carry them). */
const relativePaths = new WeakMap<File, string>()

/** Remembers where a file sat in a dropped folder (used to match `images/…` references). */
export function setRelativePath(file: File, path: string): void {
  relativePaths.set(file, path)
}

function pathOf(file: File): string {
  return relativePaths.get(file) || file.webkitRelativePath || file.name
}

async function sniffFile(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
    return sniffFormat(head, file.name) !== 'unknown'
  } catch {
    return false
  }
}

/** Lower is better: in a dropped Bodymovin export folder, data.json at the top is the animation. */
function preference(file: File): number {
  return (file.name.toLowerCase() === 'data.json' ? 0 : 100) + pathOf(file).split('/').length
}

/** Splits files into animation candidates (best first) and images. */
async function classify(files: File[]): Promise<{ animations: File[]; images: File[] }> {
  const animations: File[] = []
  const images: File[] = []
  for (const file of files) {
    if (isImageFileName(file.name, file.type)) images.push(file)
    else if (isLottieFileName(file.name, file.type) || (await sniffFile(file)))
      animations.push(file)
  }
  if (animations.length > 1) animations.sort((a, b) => preference(a) - preference(b))
  return { animations, images }
}

async function readImages(files: File[]): Promise<NamedBytes[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      path: pathOf(file),
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  )
}

/**
 * The single entry point for animation files (drop, Open dialog, pasted files). Images that come
 * with an animation resolve its external image references (a Bodymovin export folder). Returns
 * false when there is no animation among the files: images alone belong to the assets feature
 * (with a document open) or get an explanation (without one). `route` is the page to show the
 * document on (see `revealDocument`).
 */
export async function openFiles(
  files: File[],
  { route }: { route?: DocumentRoute } = {},
): Promise<boolean> {
  const { animations, images } = await classify(files)
  if (!animations.length) return false
  const t = getT()
  const startedAt = Date.now()
  const imageBytes = images.length ? await readImages(images) : []
  let firstError: unknown = null
  for (const [index, file] of animations.entries()) {
    let result: OpenResult
    try {
      result = await readForOpen(file, imageBytes)
    } catch (err) {
      firstError ??= err
      continue
    }
    if (!(await presentResult(result, { source: result.kind, route }))) return true
    const others = animations.slice(index + 1)
    if (others.length) await keepOthers(file.name, others, startedAt)
    return true
  }
  notifyError(describeOpenError(firstError, animations[0].name, t))
  return true
}

/**
 * One document is open at a time: other dropped animations go to the recent files (newest
 * first, below the opened one), so they are one click away. Without autosave nothing is stored.
 */
async function keepOthers(openedName: string, files: File[], startedAt: number): Promise<void> {
  const t = getT()
  if (!usePrefs.getState().autosave) {
    notifyWarning({ title: t.io.errors.tooManyFiles(openedName, files.length), lines: [] })
    return
  }
  let stored = 0
  for (const [index, file] of files.slice(0, MAX_RECENTS - 1).entries()) {
    try {
      const result = readLottieBytes(new Uint8Array(await file.arrayBuffer()), file.name)
      setRecents(await storeAsRecent(result, startedAt - 1 - index))
      stored++
    } catch (err) {
      console.warn(`Could not add "${file.name}" to Recent`, err)
    }
  }
  if (stored) notifyInfo(t.io.welcome.addedToRecent(openedName, stored))
}

/** The container kept in DocumentMeta.dotLottie for an opened animation. */
function sourceOf(result: OpenResult, opened: OpenedAnimation): unknown {
  if (result.kind === 'dotlottie' && result.dotLottie) {
    return createDotLottieContainer(result.dotLottie, opened.id)
  }
  return result.kind === 'tgs' ? TGS_SOURCE : undefined
}

/** Stores a read file as a recent file without opening it. Returns the new recent list. */
async function storeAsRecent(result: OpenResult, openedAt: number): Promise<RecentEntry[]> {
  const opened = result.animations.find((a) => a.id === result.activeId) ?? result.animations[0]
  const id = uid('doc')
  const doc = opened.data
  const fileName = documentFileName(result, opened, { source: result.kind })
  const format = result.kind === 'dotlottie' && result.dotLottie ? 'lottie' : 'json'
  const container = sourceOf(result, opened)
  const recents = await writeDocument({
    doc: {
      v: 1,
      id,
      doc,
      meta: { fileName, format, sourceSize: result.size, loadedAt: openedAt },
      savedAt: openedAt,
      dirty: false,
      edited: false,
    },
    recent: {
      id,
      fileName,
      format,
      source: result.kind,
      animationId: result.animations.length > 1 ? opened.id : undefined,
      width: doc.w,
      height: doc.h,
      fps: doc.fr,
      frames: Math.max(0, doc.op - doc.ip),
      size: result.size,
      openedAt,
      edited: false,
      contentKey: `${result.fileName}|${result.size}|${opened.id}`,
    },
    original: { value: doc, stored: false },
    container: container === undefined ? undefined : { value: container, changed: true },
    session: false,
  })
  scheduleThumbnail(id, doc)
  return recents
}

/**
 * Images go to the assets feature, which adds them to the open animation. Off the pages that show
 * the animation that change would happen out of sight: from the home page the editor opens first;
 * the optimizer page only takes animations, so the drop is explained instead.
 */
export function routeImageFiles(files: File[]): boolean {
  if (!files.length || !files.every((f) => isImageFileName(f.name, f.type))) return false
  const route = currentRoute()
  if (route === 'optimize') {
    const t = getT()
    notifyError({ title: t.io.drop.optimizeImages, lines: [t.io.drop.optimizeImagesHint] })
    return true
  }
  if (route === 'home' && useDocument.getState().doc) navigate('edit')
  return false
}

/** Last-resort handler: explains files nobody could open. */
export async function explainUnhandledFiles(files: File[]): Promise<boolean> {
  const t = getT()
  const onlyImages = files.every((f) => isImageFileName(f.name, f.type))
  if (onlyImages) {
    // With a document open, images belong to the assets feature; without one, say what to do.
    if (useDocument.getState().doc) return false
    notifyError({ title: t.io.errors.image, lines: [t.io.errors.imageNoDoc] })
    return true
  }
  const file = files.find((f) => !isImageFileName(f.name, f.type)) ?? files[0]
  notifyError({
    title: t.io.errors.openTitle(file.name),
    lines: [t.io.errors.unsupported(fileExtension(file.name))],
  })
  return true
}

/**
 * Shows the system Open dialog. The chosen files go to the file handlers (as if dropped), or to
 * `onPick` when given (e.g. a home page card that opens them in a particular service).
 */
export function pickFiles(onPick?: (files: File[]) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = OPEN_ACCEPT
  input.multiple = true
  input.hidden = true
  // Attached while the dialog is up: some browsers drop the change event of a detached input.
  input.addEventListener(
    'change',
    () => {
      const files = Array.from(input.files ?? [])
      input.remove()
      if (!files.length) return
      if (onPick) onPick(files)
      else void dispatchFiles(files)
    },
    { once: true },
  )
  input.addEventListener('cancel', () => input.remove(), { once: true })
  document.body.appendChild(input)
  input.click()
}

/* -------------------------------------------------------------------------- */
/*                          Samples, new, switching                           */
/* -------------------------------------------------------------------------- */

/** Opens a built-in sample (on `route`, see `revealDocument`). */
export async function openSample(id: string, route?: DocumentRoute): Promise<void> {
  const sample = findSample(id)
  if (!sample || !(await confirmReplace())) return
  try {
    const data = await sample.load()
    const docId = uid('doc')
    setDocumentInfo(docId, { source: 'sample', contentKey: `sample:${id}` })
    loadDocument(data, { id: docId, fileName: `${id}.json`, format: 'json' })
    revealDocument(route)
  } catch (err) {
    notifyError(describeOpenError(err, `${id}.json`, getT()))
  }
}

export interface NewAnimationSettings {
  name: string
  width: number
  height: number
  fps: number
  frames: number
}

/** Creates and opens an empty animation. Resolves false when the user kept the current one. */
export async function createNewAnimation(s: NewAnimationSettings): Promise<boolean> {
  if (!(await confirmReplace())) return false
  const name = s.name.trim() || getT().common.untitled
  const id = uid('doc')
  setDocumentInfo(id, { source: 'new' })
  loadDocument(
    createAnimation({ name, width: s.width, height: s.height, fps: s.fps, frames: s.frames }),
    {
      id,
      fileName: `${sanitizeFileName(name, 'animation')}.json`,
      format: 'json',
    },
  )
  revealDocument()
  return true
}

/**
 * Switches the edited animation of the open dotLottie: the current one (with its changes) goes
 * back into the container, which travels with the newly loaded animation.
 */
export function switchAnimation(nextId: string): void {
  const s = useDocument.getState()
  const container = containerOf(s.meta?.dotLottie)
  if (!s.doc || !s.meta || !container) return
  const next = switchContainerAnimation(container, s.doc, nextId)
  if (!next) return
  const previousId = s.meta.id
  const id = uid('doc')
  setDocumentInfo(id, { source: 'dotlottie', animationId: nextId, edited: s.past.length > 0 })
  loadDocument(next.data, {
    id,
    fileName: s.meta.fileName,
    format: 'lottie',
    sourceSize: s.meta.sourceSize,
    dotLottie: next.container,
    // The file still holds unexported changes of the other animation: keep the "edited" dot.
    dirty: isDirty(s),
  })
  // The new entry carries every change; the previous one would only confuse the recent list.
  void afterPendingWrites().then(() => removeRecentEntry(previousId))
}
