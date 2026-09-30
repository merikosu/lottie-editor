/**
 * The files the optimizer hands out: the optimized JSON, a .lottie (keeping the container's other
 * animations, themes and state machines) or a Telegram sticker, one by one or all in a ZIP.
 * Built on demand and cached per result, so sizes shown are the sizes downloaded.
 */
import { gzipSync, strToU8, zipSync, type Zippable } from 'fflate'
import { downloadBlob, sanitizeFileName, withExtension } from '@/lib/download'
import { writeDotLottie } from '@/lottie/dotlottie'
import { telegramCompatible } from '@/lottie/optimizer'
import type { Animation } from '@/lottie/types'
import { outputFormat } from './summary'
import type { Job, OutputChoice, OutputFormat, PartResult } from './types'

export interface OutputFile {
  format: OutputFormat
  fileName: string
  blob: Blob
  size: number
}

const MIME: Record<OutputFormat, string> = {
  json: 'application/json',
  lottie: 'application/zip',
  tgs: 'application/gzip',
}

const EXTENSION: Record<OutputFormat, string> = { json: 'json', lottie: 'lottie', tgs: 'tgs' }

/** Output file name: the input's name with the output's extension. */
export function outputName(job: Pick<Job, 'name'>, format: OutputFormat, suffix = ''): string {
  const base = sanitizeFileName(job.name, 'animation')
  const stem = suffix ? `${base.replace(/\.[^./\\]+$/, '')}-${sanitizeFileName(suffix)}` : base
  return withExtension(stem, EXTENSION[format])
}

/** True when every part has a result (a file can be written). */
export function hasOutput(job: Job): boolean {
  return job.parts.length > 0 && job.parts.every((p) => p.result)
}

interface CacheEntry {
  results: (PartResult | null)[]
  files: Map<string, OutputFile>
}

/** Outputs by job, valid while the job's results are the same objects. */
const cache = new Map<string, CacheEntry>()

function cached(job: Job, key: string, build: () => OutputFile): OutputFile {
  const results = job.parts.map((p) => p.result)
  let entry = cache.get(job.id)
  if (
    !entry ||
    entry.results.length !== results.length ||
    entry.results.some((r, i) => r !== results[i])
  ) {
    entry = { results, files: new Map() }
    cache.set(job.id, entry)
  }
  let file = entry.files.get(key)
  if (!file) {
    file = build()
    entry.files.set(key, file)
  }
  return file
}

/** Forgets the outputs of removed jobs. */
export function pruneOutputs(liveIds: Set<string>): void {
  for (const id of cache.keys()) if (!liveIds.has(id)) cache.delete(id)
}

function makeFile(
  format: OutputFormat,
  fileName: string,
  bytes: Uint8Array<ArrayBuffer> | string,
): OutputFile {
  const blob = new Blob([bytes], { type: MIME[format] })
  return { format, fileName, blob, size: blob.size }
}

function resultOf(job: Job, index: number): PartResult {
  const result = job.parts[index]?.result
  if (!result) throw new Error(`"${job.name}" has not been optimized yet`)
  return result
}

/**
 * Builds a job's file in `format`. JSON and .tgs hold one animation (`part`, default the active
 * one); a .lottie holds them all.
 */
export function buildOutput(job: Job, format: OutputFormat, part = job.active): OutputFile {
  const several = job.parts.length > 1
  return cached(job, `${format}:${format === 'lottie' ? '*' : part}`, () => {
    if (format === 'lottie') {
      const animations = job.parts.map((p, i) => ({
        id: p.id,
        data: JSON.parse(resultOf(job, i).json) as Animation,
      }))
      const bytes = writeDotLottie({
        animations,
        container: job.container ?? undefined,
        options: { level: 9 },
      })
      return makeFile('lottie', outputName(job, 'lottie'), bytes)
    }
    const result = resultOf(job, part)
    // A file with several animations names each one's JSON after it.
    const name = outputName(job, format, several ? job.parts[part].id : '')
    if (format === 'tgs')
      return makeFile('tgs', name, gzipSync(strToU8(result.json), { level: 9, mtime: 0 }))
    return makeFile('json', name, result.json)
  })
}

/** Size of a job's file in `format` without building it, when it is known exactly. */
export function knownSize(job: Job, format: OutputFormat, part = job.active): number | null {
  const result = job.parts[part]?.result
  if (!result) return null
  // `after.raw` is the byte length of the JSON; `after.gzip` is gzip level 9 of the same bytes.
  if (format === 'json') return result.report.after.raw
  if (format === 'tgs') return result.report.after.gzip
  // A .lottie is only known once written (see buildOutput).
  return null
}

/** Telegram's limit for a sticker file (gzip). */
const STICKER_BYTES = 64 * 1024

const stickers = new WeakMap<PartResult, boolean>()

/**
 * The job can be saved as a Telegram sticker: one animation that meets the sticker rules (a file
 * that came as a .tgs stays one). Validated once per result.
 */
export function canBeSticker(job: Job): boolean {
  const result = job.parts.length === 1 ? job.parts[0].result : null
  if (!result) return false
  if (job.input === 'tgs') return true
  let ok = stickers.get(result)
  if (ok === undefined) {
    ok =
      result.report.after.gzip <= STICKER_BYTES &&
      telegramCompatible(JSON.parse(result.json) as Animation, result.report.after)
    stickers.set(result, ok)
  }
  return ok
}

/** Downloads one job in the queue's output format (or `format`). */
export function downloadJob(job: Job, choice: OutputChoice, format?: OutputFormat): OutputFile {
  const out = buildOutput(job, format ?? outputFormat(job, choice))
  downloadBlob(out.blob, out.fileName)
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Name for the ZIP of all files. */
export function archiveName(): string {
  const d = new Date()
  return `optimized-lottie-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`
}

/** Makes names unique inside an archive: "a.json", "a (2).json", … */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    let candidate = name
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

/** Builds the ZIP of every optimized file (already compressed formats are stored as they are). */
export async function buildArchive(jobs: Job[], choice: OutputChoice): Promise<Blob | null> {
  const outputs: OutputFile[] = []
  for (const job of jobs) {
    if (!hasOutput(job)) continue
    outputs.push(buildOutput(job, outputFormat(job, choice)))
    // Keep the page responsive between large files.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (!outputs.length) return null
  const names = uniqueNames(outputs.map((o) => o.fileName))
  const files: Zippable = {}
  for (const [i, out] of outputs.entries()) {
    const bytes = new Uint8Array(await out.blob.arrayBuffer())
    files[names[i]] = [bytes, { level: out.format === 'json' ? 6 : 0 }]
  }
  return new Blob([zipSync(files)], { type: 'application/zip' })
}
