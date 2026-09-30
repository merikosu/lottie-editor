/**
 * What the optimizer's buttons and commands do (with translated failure messages).
 */
import { navigate } from '@/app/router'
import { notifyError, openFiles, pickFiles } from '@/features/io'
import { getT } from '@/i18n'
import { downloadBlob } from '@/lib/download'
import type { PresetId } from '@/lottie/optimizer'
import type { Animation } from '@/lottie/types'
import { findSample } from '@/samples'
import { replaceDoc, useDocument } from '@/store/document'
import { addFiles, optimizeEditorDocument } from '../model/intake'
import { archiveName, buildArchive, buildOutput, hasOutput, type OutputFile } from '../model/output'
import { presetOptions, setOptimizerSettings, useOptimizerSettings } from '../model/settings'
import { clearJobs, getJob, removeJob, updateJob, useOptimizer } from '../model/store'
import { outputFormat, sameFormat } from '../model/summary'
import type { Job, OutputFormat } from '../model/types'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** The system file picker; chosen files go through the file handlers like dropped ones. */
export function chooseFiles(): void {
  pickFiles()
}

/** Adds a built-in sample to the queue. */
export async function addSample(id: string): Promise<void> {
  const sample = findSample(id)
  if (!sample) return
  try {
    const data = await sample.load()
    addFiles([new File([JSON.stringify(data)], `${id}.json`, { type: 'application/json' })])
  } catch (err) {
    notifyError({ title: getT().optimizer.errors.failed, lines: [message(err)] })
  }
}

/** Builds a job's file, reporting failures (null when it could not be written). */
export function outputOf(job: Job, format: OutputFormat, part?: number): OutputFile | null {
  try {
    return buildOutput(job, format, part)
  } catch (err) {
    console.error('Could not build the optimized file', err)
    notifyError({ title: getT().optimizer.errors.download(job.name), lines: [message(err)] })
    return null
  }
}

/** Downloads a job in `format` (default: the queue's output choice). */
export function downloadJob(job: Job, format?: OutputFormat, part?: number): void {
  if (!hasOutput(job)) return
  const out = outputOf(
    job,
    format ?? outputFormat(job, useOptimizerSettings.getState().output),
    part,
  )
  if (out) downloadBlob(out.blob, out.fileName)
}

/** Downloads every optimized file: one file as it is, several in a ZIP. */
export async function downloadAll(): Promise<void> {
  const jobs = useOptimizer.getState().jobs.filter(hasOutput)
  if (!jobs.length) return
  if (jobs.length === 1) {
    downloadJob(jobs[0])
    return
  }
  try {
    const blob = await buildArchive(jobs, useOptimizerSettings.getState().output)
    if (blob) downloadBlob(blob, archiveName())
  } catch (err) {
    console.error('Could not build the ZIP', err)
    notifyError({ title: getT().optimizer.errors.archive, lines: [message(err)] })
  }
}

export function canDownloadAll(): boolean {
  return useOptimizer.getState().jobs.some(hasOutput)
}

/** Opens a job's optimized file in the editor (as a new document, like opening the file). */
export async function openInEditor(job: Job): Promise<void> {
  if (!hasOutput(job)) return
  const out = outputOf(job, job.parts.length > 1 ? 'lottie' : sameFormat(job.input))
  if (!out) return
  await openFiles([new File([out.blob], out.fileName, { type: out.blob.type })], { route: 'edit' })
}

/** The editor still shows the document the job was made from. */
export function editorHasJobDocument(job: Job, doc = useDocument.getState().doc): boolean {
  return job.origin.kind === 'editor' && doc !== null && doc === job.origin.doc
}

/** Puts an editor job's result into the editor as one undo step, then shows the editor. */
export function replaceInEditor(jobId: string): void {
  const job = getJob(jobId)
  const result = job?.parts[0]?.result
  if (!job || !result || job.origin.kind !== 'editor' || !editorHasJobDocument(job)) return
  replaceDoc(getT().optimizer.history.replace, JSON.parse(result.json) as Animation)
  const applied = useDocument.getState().doc
  if (applied) updateJob(job.id, { origin: { ...job.origin, doc: applied, replaced: true } })
  navigate('edit')
}

/** Sends the editor's current document again (after it changed). */
export function optimizeCurrentVersion(): void {
  optimizeEditorDocument()
}

export function removeFromQueue(id: string): void {
  removeJob(id)
}

export function clearQueue(): void {
  clearJobs()
}

/** Sets the preset of every file without its own settings. */
export function setQueuePreset(id: PresetId): void {
  setOptimizerSettings({ options: presetOptions(id) })
}
