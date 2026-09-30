/**
 * How files get into the queue: drops, the file picker and pasted files (while the optimizer page
 * is showing), and the editor's document (`anim.optimize`).
 */
import { currentRoute, navigate } from '@/app/router'
import { uid } from '@/lib/id'
import { isDotLottieContainer } from '@/lottie/dotlottie'
import { fileExtension, isImageFileName } from '@/lottie/formats'
import { useDocument } from '@/store/document'
import { newPart } from './read'
import { queueThumbnail } from './runner'
import { addJobs, replaceJob, selectJob, useOptimizer } from './store'
import type { InputFormat, Job } from './types'

const isImage = (file: File) => isImageFileName(file.name, file.type)

/** Format chip before the file is read (the reader confirms it from the bytes). */
function guessInput(name: string): InputFormat {
  switch (fileExtension(name)) {
    case 'lottie':
      return 'lottie'
    case 'tgs':
      return 'tgs'
    case 'zip':
      return 'zip'
    default:
      return 'json'
  }
}

function fileJob(file: File, images: File[]): Job {
  return {
    id: uid('opt'),
    name: file.name || 'animation.json',
    input: guessInput(file.name),
    inputSize: file.size,
    origin: { kind: 'file' },
    file,
    images,
    container: null,
    parts: [],
    active: 0,
    options: null,
    phase: 'reading',
    error: null,
    thumbnail: null,
    addedAt: Date.now(),
  }
}

/**
 * Adds files to the queue. Images alone are not animations (false: someone else explains that);
 * images next to animations resolve their image references (a Bodymovin export folder). With an
 * empty queue a single file opens straight in the detail view.
 */
export function addFiles(files: File[]): boolean {
  const images = files.filter(isImage)
  const animations = files.filter((f) => !isImage(f))
  if (!animations.length) return false
  const wasEmpty = useOptimizer.getState().jobs.length === 0
  const jobs = animations.map((f) => fileJob(f, images))
  addJobs(jobs)
  if (wasEmpty && jobs.length === 1) selectJob(jobs[0].id)
  return true
}

/** File handler (drop, Open dialog, paste): takes files only while the optimizer page is showing. */
export function handleFiles(files: File[]): boolean {
  if (currentRoute() !== 'optimize') return false
  return addFiles(files)
}

function isTgsSource(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'tgs'
}

/**
 * Sends the editor's document to the optimizer and shows its detail. The same unchanged document
 * sent again shows the job it already has; a newer version of it takes the place of the job made
 * from an older one (the queue keeps one entry per editor document).
 */
export function optimizeEditorDocument(): void {
  const { doc, meta } = useDocument.getState()
  if (!doc || !meta) return
  const jobs = useOptimizer.getState().jobs
  const existing = jobs.find((j) => j.origin.kind === 'editor' && j.origin.doc === doc)
  if (existing) {
    selectJob(existing.id)
    navigate('optimize')
    return
  }
  const older = jobs.find((j) => j.origin.kind === 'editor' && j.origin.docId === meta.id)
  const source = JSON.stringify(doc)
  const container = isDotLottieContainer(meta.dotLottie) ? meta.dotLottie : null
  const input: InputFormat = container ? 'lottie' : isTgsSource(meta.dotLottie) ? 'tgs' : 'json'
  const partId = container?.activeId ?? meta.fileName.replace(/\.[^./\\]+$/, '')
  const job: Job = {
    id: uid('opt'),
    name: meta.fileName,
    input,
    inputSize: new TextEncoder().encode(source).length,
    origin: { kind: 'editor', docId: meta.id, doc, replaced: false },
    file: null,
    images: [],
    container,
    parts: [newPart(partId, doc.nm || meta.fileName, doc, source)],
    active: 0,
    options: null,
    phase: 'ready',
    error: null,
    thumbnail: null,
    addedAt: Date.now(),
  }
  if (older) replaceJob(older.id, job)
  else addJobs([job])
  queueThumbnail(job.id, doc)
  selectJob(job.id)
  navigate('optimize')
}
