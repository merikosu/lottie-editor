/**
 * Builders for optimizer tests: real animations (the built-in samples), real engine results and
 * jobs in every state.
 */
import bounce from '@/samples/bounce.json'
import like from '@/samples/like.json'
import {
  optimizeAnimation,
  resolveOptions,
  type OptimizeOptions,
  type VisualReport,
} from '@/lottie/optimizer'
import type { Animation } from '@/lottie/types'
import { newPart } from '../model/read'
import { optionsKey } from '../model/summary'
import type { Job, JobPart, PartResult } from '../model/types'

export const BOUNCE = bounce as unknown as Animation
export const LIKE = like as unknown as Animation

export const balanced = (): OptimizeOptions => resolveOptions('balanced')

let n = 0

export function job(patch: Partial<Job> = {}): Job {
  n++
  return {
    id: `job-${n}`,
    name: `anim-${n}.json`,
    input: 'json',
    inputSize: 1000,
    origin: { kind: 'file' },
    file: null,
    images: [],
    container: null,
    parts: [],
    active: 0,
    options: null,
    phase: 'ready',
    error: null,
    thumbnail: null,
    addedAt: 0,
    ...patch,
  }
}

export function part(doc: Animation = BOUNCE, id = 'bounce'): JobPart {
  return newPart(id, id, doc, JSON.stringify(doc))
}

/** A real optimization result of `doc` with `options`. */
export async function result(
  doc: Animation,
  options: OptimizeOptions = balanced(),
): Promise<PartResult> {
  const r = await optimizeAnimation(doc, options, { measureGzip: true })
  return {
    key: optionsKey(options),
    effective: options,
    backoffs: [],
    json: r.json,
    report: r.report,
  }
}

export function visual(match: boolean, patch: Partial<VisualReport> = {}): VisualReport {
  return {
    maxDiff: match ? 0 : 120,
    meanDiff: 0,
    perFrame: [0, match ? 0 : 0.05],
    frames: [0, 30],
    worstFrame: 30,
    worstShare: match ? 0 : 0.05,
    match,
    ...patch,
  }
}

/** A part optimized with `options` and checked (`match`). */
export async function donePart(
  doc: Animation = BOUNCE,
  options: OptimizeOptions = balanced(),
  match = true,
): Promise<JobPart> {
  const r = await result(doc, options)
  return {
    ...part(doc),
    result: r,
    verify: { status: 'done', of: r.json, frames: 'sampled', visual: visual(match) },
  }
}
