/**
 * Derived facts about jobs (pure): what is current, statuses, sizes, totals and output formats.
 */
import {
  nextBackoff,
  type Backoff,
  type OptimizeOptions,
  type OptimizeReport,
} from '@/lottie/optimizer'
import type { OptimizerSettings, VerifyFrames } from './settings'
import type { InputFormat, Job, JobPart, JobStatus, OutputChoice, OutputFormat } from './types'

/** Stable key of a set of options: a result is current when it was made with the same key. */
export function optionsKey(options: OptimizeOptions): string {
  return JSON.stringify(options)
}

/** What a job's results must match to count as current. */
export interface Policy {
  /** Key of the options the job runs with (its own, else the queue's). */
  key: string
  options: OptimizeOptions
  /** Relax settings until the visual check passes. */
  guarantee: boolean
  frames: VerifyFrames
}

export function policyFor(
  job: Job,
  settings: Pick<OptimizerSettings, 'options' | 'guarantee' | 'verifyFrames'>,
): Policy {
  const options = job.options ?? settings.options
  return {
    key: optionsKey(options),
    options,
    guarantee: settings.guarantee,
    frames: settings.verifyFrames,
  }
}

/**
 * The part's latest result was made for the policy's settings. Relaxed settings only count while
 * the guarantee is on (turning it off asks for the settings as chosen).
 */
export function isCurrent(part: JobPart, policy: Policy): boolean {
  const r = part.result
  return !!r && r.key === policy.key && (policy.guarantee || r.backoffs.length === 0)
}

/** The visual check of the part's latest result is over (or not needed). */
export function isVerified(part: JobPart, policy: Policy): boolean {
  const v = part.verify
  return (
    !!part.result &&
    v.of === part.result.json &&
    v.frames === policy.frames &&
    (v.status === 'done' || v.status === 'error' || v.status === 'skipped')
  )
}

/**
 * With the guarantee on, a current result whose visual check found a difference is optimized
 * again with the next, safer settings; null when there is nothing (left) to relax.
 */
export function relaxation(
  part: JobPart,
  policy: Policy,
): { effective: OptimizeOptions; backoffs: Backoff[] } | null {
  const r = part.result
  if (!policy.guarantee || !r || !isCurrent(part, policy) || !isVerified(part, policy)) return null
  if (part.verify.status !== 'done' || part.verify.visual?.match !== false) return null
  const next = nextBackoff(r.effective, r.report)
  return next ? { effective: next.options, backoffs: [...r.backoffs, next.step] } : null
}

/** The part failed for the current settings (not retried until they change). */
export function hasFailed(part: JobPart, policy: Policy): boolean {
  return part.error?.key === policy.key && part.run === null
}

/** What the job is doing, from its parts. */
export function jobStatus(job: Job, policy: Policy): JobStatus {
  if (job.phase === 'reading') return 'reading'
  if (job.phase === 'error' || job.parts.some((p) => hasFailed(p, policy))) return 'error'
  if (job.parts.some((p) => p.run !== null)) return 'optimizing'
  if (job.parts.some((p) => !isCurrent(p, policy) || relaxation(p, policy))) return 'queued'
  if (job.parts.some((p) => !isVerified(p, policy))) return 'verifying'
  return 'done'
}

/** True while the job is still being read, optimized or checked. */
export function isBusy(status: JobStatus): boolean {
  return status !== 'done' && status !== 'error'
}

export interface Sizes {
  beforeRaw: number
  afterRaw: number
  beforeGzip: number
  afterGzip: number
  beforeLottie: number
  afterLottie: number
}

export const EMPTY_SIZES: Sizes = {
  beforeRaw: 0,
  afterRaw: 0,
  beforeGzip: 0,
  afterGzip: 0,
  beforeLottie: 0,
  afterLottie: 0,
}

export function addSizes(a: Sizes, b: Sizes): Sizes {
  return {
    beforeRaw: a.beforeRaw + b.beforeRaw,
    afterRaw: a.afterRaw + b.afterRaw,
    beforeGzip: a.beforeGzip + b.beforeGzip,
    afterGzip: a.afterGzip + b.afterGzip,
    beforeLottie: a.beforeLottie + b.beforeLottie,
    afterLottie: a.afterLottie + b.afterLottie,
  }
}

export function reportSizes(r: OptimizeReport): Sizes {
  return {
    beforeRaw: r.before.raw,
    afterRaw: r.after.raw,
    beforeGzip: r.before.gzip,
    afterGzip: r.after.gzip,
    beforeLottie: r.before.dotLottie,
    afterLottie: r.after.dotLottie,
  }
}

/** Sizes of a job's latest results (null until every part has one). */
export function jobSizes(job: Job): Sizes | null {
  if (!job.parts.length || job.parts.some((p) => !p.result)) return null
  return job.parts.reduce((total, p) => addSizes(total, reportSizes(p.result!.report)), EMPTY_SIZES)
}

/** Saved share (0..1) between two sizes. */
export function savedShare(before: number, after: number): number {
  return before > 0 ? (before - after) / before : 0
}

/** Visual check outcome over a job's parts (null until every part is checked). */
export type JobMatch = 'identical' | 'different' | 'unverified' | null

export function jobMatch(job: Job, policy: Policy): JobMatch {
  // A verdict about results made with other settings says nothing about the next ones.
  if (!job.parts.length || job.parts.some((p) => !isCurrent(p, policy) || !isVerified(p, policy)))
    return null
  if (job.parts.some((p) => p.verify.status === 'done' && p.verify.visual?.match === false))
    return 'different'
  if (job.parts.some((p) => p.verify.status !== 'done')) return 'unverified'
  return 'identical'
}

/** Largest share of differing pixels on any checked frame of the job (0..1). */
export function jobWorstShare(job: Job): number {
  let worst = 0
  for (const p of job.parts) worst = Math.max(worst, p.verify.visual?.worstShare ?? 0)
  return worst
}

export interface QueueTotals {
  files: number
  /** Files with results for every animation. */
  measured: number
  /** Files still being read, optimized or checked. */
  busy: number
  failed: number
  identical: number
  different: number
  sizes: Sizes
}

type SettingsForTotals = Pick<OptimizerSettings, 'options' | 'guarantee' | 'verifyFrames'>

/** Totals over the queue (sizes add up the files that have results). */
export function queueTotals(jobs: Job[], settings: SettingsForTotals): QueueTotals {
  const totals: QueueTotals = {
    files: jobs.length,
    measured: 0,
    busy: 0,
    failed: 0,
    identical: 0,
    different: 0,
    sizes: EMPTY_SIZES,
  }
  for (const job of jobs) {
    const policy = policyFor(job, settings)
    const status = jobStatus(job, policy)
    if (status === 'error') totals.failed++
    else if (isBusy(status)) totals.busy++
    const sizes = status === 'error' ? null : jobSizes(job)
    if (sizes) {
      totals.measured++
      totals.sizes = addSizes(totals.sizes, sizes)
    }
    const match = jobMatch(job, policy)
    if (match === 'identical') totals.identical++
    else if (match === 'different') totals.different++
  }
  return totals
}

/** The format a job is written as for the queue's output choice. */
export function outputFormat(
  job: Pick<Job, 'parts' | 'input'>,
  choice: OutputChoice,
): OutputFormat {
  // Several animations only fit in a .lottie.
  if (job.parts.length > 1) return 'lottie'
  if (choice === 'json') return 'json'
  if (choice === 'lottie') return 'lottie'
  return sameFormat(job.input)
}

/** The output format matching an input format ("same as input"). */
export function sameFormat(input: InputFormat): OutputFormat {
  switch (input) {
    case 'lottie':
      return 'lottie'
    case 'tgs':
      return 'tgs'
    default:
      // A ZIP export (data.json + images) becomes one JSON with the images embedded.
      return 'json'
  }
}
