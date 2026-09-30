/**
 * Does the queue's work, reacting to the store: reads dropped files, optimizes every animation in
 * a small pool of Web Workers and checks each result visually on the main thread when it is idle.
 *
 *  - One pump decides what to start next (the file on screen first, then queue order), so there
 *    is a single place that knows what is running. It runs after every change of the queue or of
 *    the settings.
 *  - Work that is no longer wanted (the file was removed, its settings changed) is cancelled: the
 *    worker is terminated and its late answer ignored.
 *  - With the guarantee on, a result whose visual check finds a difference is optimized again with
 *    safer settings (`nextBackoff`: image quality, then the tolerance, then techniques one by one)
 *    until the check passes or nothing is left to relax.
 */
import { currentRoute, useRouter } from '@/app/router'
import {
  createOptimizerClient,
  verifyVisual,
  type Backoff,
  type OptimizeOptions,
  type OptimizerClient,
} from '@/lottie/optimizer'
import { renderThumbnail, whenIdle } from '@/features/io/thumbnail'
import type { Animation } from '@/lottie/types'
import { describeFailure } from './errors'
import { readJobFile } from './read'
import { useOptimizerSettings } from './settings'
import { getJob, updateJob, updatePart, useOptimizer } from './store'
import { isCurrent, isVerified, policyFor, relaxation, type Policy } from './summary'
import type { Job, JobPart } from './types'

/** Frames checked when not every frame is: enough to catch what a viewer would notice. */
const SAMPLED_FRAMES = 60
/** Upper bound for "every frame" (very long animations). */
const MAX_FRAMES = 600
/** Longest side of the renderings compared (px). */
const VERIFY_SIZE = 256

/* -------------------------------------------------------------------------- */
/*                                 Worker pool                                */
/* -------------------------------------------------------------------------- */

interface Slot {
  client: OptimizerClient
  busy: boolean
}

const slots: Slot[] = []

function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2
  // Two files at a time is plenty (the main thread renders the checks); one on dual cores.
  return cores > 2 ? 2 : 1
}

function freeSlot(): Slot | null {
  const idle = slots.find((s) => !s.busy)
  if (idle) return idle
  if (slots.length >= poolSize()) return null
  const slot = { client: createOptimizerClient(), busy: false }
  slots.push(slot)
  return slot
}

/* -------------------------------------------------------------------------- */
/*                                  Tracking                                  */
/* -------------------------------------------------------------------------- */

interface Flight {
  jobId: string
  part: number
  key: string
  controller: AbortController
}

/** Optimizations in flight by `jobId:part`. */
const flights = new Map<string, Flight>()

/**
 * Re-runs wait until the settings stop changing for this long (dragging a slider or typing a
 * tolerance would otherwise restart the workers on every step). First runs start at once.
 */
const SETTLE_MS = 300

/** When each part's wanted settings key was first seen (by `jobId:part`). */
const wanted = new Map<string, { key: string; since: number }>()
let settleTimer: ReturnType<typeof setTimeout> | undefined

/** True when a re-run with `key` may start now; otherwise the pump runs again when it may. */
function settled(id: string, key: string): boolean {
  const now = performance.now()
  const seen = wanted.get(id)
  if (!seen || seen.key !== key) {
    wanted.set(id, { key, since: now })
    wakeAfter(SETTLE_MS)
    return false
  }
  const left = SETTLE_MS - (now - seen.since)
  if (left > 0) {
    wakeAfter(left)
    return false
  }
  return true
}

function wakeAfter(ms: number): void {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(schedule, Math.max(16, ms))
}

interface Check {
  jobId: string
  part: number
  json: string
  controller: AbortController
}

let check: Check | null = null
let reading: string | null = null
let thumbnailing = false
/** Parsed first animations waiting for their thumbnail (kept only until it is drawn). */
const thumbnails = new Map<string, Animation>()

const flightKey = (jobId: string, part: number) => `${jobId}:${part}`

/* -------------------------------------------------------------------------- */
/*                                    Pump                                    */
/* -------------------------------------------------------------------------- */

let scheduled = false
let started = false

/** Runs the pump after the current task (many store updates in a row cost one pass). */
export function schedule(): void {
  if (scheduled || !started) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    pump()
  })
}

/** Jobs in the order they get workers: the one on screen first. */
function ordered(jobs: Job[], selectedId: string | null): Job[] {
  const selected = selectedId ? jobs.find((j) => j.id === selectedId) : undefined
  return selected ? [selected, ...jobs.filter((j) => j !== selected)] : jobs
}

function pump(): void {
  const { jobs, selectedId } = useOptimizer.getState()
  const settings = useOptimizerSettings.getState()
  const queue = ordered(jobs, selectedId)

  cancelUnwanted(jobs, settings)

  if (!reading) {
    const next = queue.find((j) => j.phase === 'reading')
    if (next) void read(next)
  }

  for (const job of queue) {
    if (job.phase !== 'ready') continue
    const policy = policyFor(job, settings)
    for (let index = 0; index < job.parts.length; index++) {
      const part = job.parts[index]
      if (part.run || part.error?.key === policy.key) continue
      const current = isCurrent(part, policy)
      const next = current ? relaxation(part, policy) : { effective: policy.options, backoffs: [] }
      if (!next) continue
      // New settings for a file that already has a result: wait until they settle.
      if (!current && part.result && !settled(flightKey(job.id, index), policy.key)) continue
      const slot = freeSlot()
      if (!slot) break
      void optimize(slot, job.id, index, policy.key, next.effective, next.backoffs)
    }
  }

  if (!thumbnailing && thumbnails.size) drawNextThumbnail()

  // Checks render on the main thread: they run while the optimizer page is showing, so the other
  // pages stay smooth (optimizing runs in workers and goes on everywhere).
  // Thumbnails first (they are quick and make the queue recognizable), then checks.
  const thumbnailsPending = thumbnailing || thumbnails.size > 0
  if (!check && !reading && !thumbnailsPending && currentRoute() === 'optimize') {
    for (const job of queue) {
      if (job.phase !== 'ready') continue
      const policy = policyFor(job, settings)
      const index = job.parts.findIndex(
        (p) => p.result && !p.run && isCurrent(p, policy) && !isVerified(p, policy),
      )
      if (index >= 0) {
        void verify(job.id, index, policy)
        break
      }
    }
  }
}

/** Stops optimizations and checks whose file was removed or whose settings changed. */
function cancelUnwanted(jobs: Job[], settings: Parameters<typeof policyFor>[1]): void {
  const ids = new Set(jobs.map((j) => j.id))
  for (const k of wanted.keys()) if (!ids.has(k.slice(0, k.lastIndexOf(':')))) wanted.delete(k)
  for (const [k, flight] of flights) {
    const job = jobs.find((j) => j.id === flight.jobId)
    if (job && policyFor(job, settings).key === flight.key && job.parts[flight.part]) continue
    flight.controller.abort()
    flights.delete(k)
    if (job) updatePart(job.id, flight.part, { run: null })
  }
  if (check) {
    const job = jobs.find((j) => j.id === check!.jobId)
    const part = job?.parts[check.part]
    if (!part || part.result?.json !== check.json || part.run) {
      check.controller.abort()
      check = null
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Reading                                  */
/* -------------------------------------------------------------------------- */

async function read(job: Job): Promise<void> {
  reading = job.id
  try {
    const result = await readJobFile(job)
    if (!getJob(job.id)) return
    updateJob(job.id, {
      phase: 'ready',
      file: null,
      images: [],
      parts: result.parts,
      container: result.container,
      input: result.input,
      inputSize: result.inputSize,
    })
    thumbnails.set(job.id, result.first)
  } catch (err) {
    updateJob(job.id, {
      phase: 'error',
      file: null,
      images: [],
      error: describeFailure(err, job.name),
    })
  } finally {
    reading = null
    schedule()
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Optimizing                                 */
/* -------------------------------------------------------------------------- */

async function optimize(
  slot: Slot,
  jobId: string,
  index: number,
  key: string,
  effective: OptimizeOptions,
  backoffs: Backoff[],
): Promise<void> {
  const part = getJob(jobId)?.parts[index]
  if (!part) return
  slot.busy = true
  const controller = new AbortController()
  const id = flightKey(jobId, index)
  const flight: Flight = { jobId, part: index, key, controller }
  flights.set(id, flight)
  updatePart(jobId, index, { run: { key, progress: 0, step: null }, error: null })
  try {
    const result = await slot.client.optimize(
      part.source,
      effective,
      (step, done, total) => {
        if (flights.get(id) !== flight) return
        updatePart(jobId, index, { run: { key, progress: total ? done / total : 0, step } })
      },
      { signal: controller.signal, source: part.delivered },
    )
    if (flights.get(id) !== flight) return
    updatePart(jobId, index, {
      run: null,
      result: { key, effective, backoffs, json: result.json, report: result.report },
      verify: { status: 'pending' },
    })
  } catch (err) {
    if (flights.get(id) !== flight || controller.signal.aborted) return
    console.error('Optimization failed', err)
    updatePart(jobId, index, { run: null, error: { ...describeFailure(err, part.name), key } })
  } finally {
    if (flights.get(id) === flight) flights.delete(id)
    slot.busy = false
    schedule()
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Checking                                  */
/* -------------------------------------------------------------------------- */

function pageIdle(): Promise<void> {
  return new Promise((resolve) => whenIdle(resolve, 1000))
}

/** Frames to render for a part under the frames setting. */
export function checkedFrames(part: Pick<JobPart, 'info'>, frames: Policy['frames']): number {
  const total = Math.max(1, Math.ceil(part.info.op - part.info.ip))
  return frames === 'all' ? Math.min(total, MAX_FRAMES) : Math.min(total, SAMPLED_FRAMES)
}

async function verify(jobId: string, index: number, policy: Policy): Promise<void> {
  const part = getJob(jobId)?.parts[index]
  const result = part?.result
  if (!part || !result) return
  const controller = new AbortController()
  const mine: Check = { jobId, part: index, json: result.json, controller }
  check = mine
  updatePart(jobId, index, {
    verify: { status: 'running', of: result.json, frames: policy.frames },
  })
  try {
    await pageIdle()
    if (check !== mine) return
    const original = JSON.parse(part.source) as Animation
    const optimized = JSON.parse(result.json) as Animation
    const visual = await verifyVisual(original, optimized, {
      frames: checkedFrames(part, policy.frames),
      size: VERIFY_SIZE,
      signal: controller.signal,
    })
    if (check !== mine) return
    // With the guarantee on, a difference makes the pump start a safer run (see `relaxation`).
    updatePart(jobId, index, {
      verify: { status: 'done', of: result.json, frames: policy.frames, visual },
    })
  } catch (err) {
    if (check !== mine || controller.signal.aborted) return
    console.warn('Visual check failed', err)
    updatePart(jobId, index, {
      verify: {
        status: 'error',
        of: result.json,
        frames: policy.frames,
        error: err instanceof Error ? err.message : String(err),
      },
    })
  } finally {
    if (check === mine) check = null
    schedule()
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Thumbnails                                 */
/* -------------------------------------------------------------------------- */

/** Draws a job's thumbnail when the page is idle (`doc` is released once it is drawn). */
export function queueThumbnail(jobId: string, doc: Animation): void {
  thumbnails.set(jobId, doc)
  schedule()
}

function drawNextThumbnail(): void {
  const [jobId, doc] = thumbnails.entries().next().value ?? []
  if (!jobId || !doc) return
  thumbnails.delete(jobId)
  thumbnailing = true
  whenIdle(() => {
    void (async () => {
      try {
        if (!getJob(jobId)) return
        const url = await renderThumbnail(doc, { size: 96 })
        if (url) updateJob(jobId, { thumbnail: url })
      } finally {
        thumbnailing = false
        schedule()
      }
    })()
  })
}

/* -------------------------------------------------------------------------- */
/*                                  Lifecycle                                 */
/* -------------------------------------------------------------------------- */

/** Starts reacting to the queue and the settings; returns the stop function. */
export function startRunner(): () => void {
  started = true
  const offQueue = useOptimizer.subscribe(schedule)
  const offRoute = useRouter.subscribe(schedule)
  const offSettings = useOptimizerSettings.subscribe((s, prev) => {
    if (
      s.options !== prev.options ||
      s.guarantee !== prev.guarantee ||
      s.verifyFrames !== prev.verifyFrames
    )
      schedule()
  })
  schedule()
  return () => {
    started = false
    offQueue()
    offRoute()
    offSettings()
    // Work in flight is dropped: mark it undone, so a restarted runner picks it up again.
    for (const flight of flights.values()) {
      flight.controller.abort()
      updatePart(flight.jobId, flight.part, { run: null })
    }
    flights.clear()
    if (check) {
      check.controller.abort()
      updatePart(check.jobId, check.part, { verify: { status: 'pending' } })
      check = null
    }
    clearTimeout(settleTimer)
    for (const slot of slots.splice(0)) slot.client.dispose()
  }
}

/** Tries a file again after its optimization failed (reading errors are final). */
export function retryJob(jobId: string): void {
  updateJob(jobId, (job) => ({ parts: job.parts.map((p) => ({ ...p, error: null })) }))
}
