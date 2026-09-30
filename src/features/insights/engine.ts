/**
 * Keeps the analysis of the open document current while any insights UI is mounted (the Issues
 * tab badge, the panel, the status bar readouts, the statistics).
 *
 * Edits are analyzed once they settle: after a short debounce (longer for big files) the
 * document is serialized in idle time and handed to a worker that gzips, validates and counts
 * it. One job runs at a time; edits made meanwhile are picked up when it ends. Results are
 * never shown for the wrong file: opening another document clears them at once.
 */
import { useEffect } from 'react'
import type { Animation } from '@/lottie/types'
import { useDocument } from '@/store/document'
import {
  analyze,
  type AnalysisRequest,
  type AnalysisResponse,
  type AnalysisResult,
} from './analysis'
import { clearFixed, EMPTY_ANALYSIS, resetIssuesUi, useAnalysis } from './store'

const MB = 1024 * 1024
/** Wait for edits to settle; big files wait longer because serializing them costs more. */
export function debounceFor(rawBytes: number | undefined): number {
  if (rawBytes === undefined) return 300
  if (rawBytes > 5 * MB) return 1200
  if (rawBytes > MB) return 700
  return 300
}

/* ---------------------------------- Worker ---------------------------------- */

const WORKER_START_TIMEOUT_MS = 4000

class WorkerCrash extends Error {}

/** Analysis worker with request ids; a crash rejects every pending job. */
class AnalysisWorker {
  private readonly jobs = new Map<
    number,
    { resolve: (r: AnalysisResult) => void; reject: (e: Error) => void }
  >()
  private nextId = 1
  private readonly worker: Worker

  constructor(worker: Worker) {
    this.worker = worker
    worker.addEventListener('message', (event: MessageEvent<AnalysisResponse>) => {
      const message = event.data
      if (message.type === 'ready') return
      const job = this.jobs.get(message.id)
      if (!job) return
      this.jobs.delete(message.id)
      if (message.type === 'result') job.resolve(message.result)
      else job.reject(new Error(message.message))
    })
    worker.addEventListener('error', (event) => {
      event.preventDefault()
      this.fail(new WorkerCrash(event.message || 'The analysis worker stopped'))
    })
  }

  analyze(json: string): Promise<AnalysisResult> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.jobs.set(id, { resolve, reject })
      this.worker.postMessage({ type: 'analyze', id, json } satisfies AnalysisRequest, [])
    })
  }

  private fail(error: Error): void {
    for (const job of this.jobs.values()) job.reject(error)
    this.jobs.clear()
    this.worker.terminate()
    if (client === this) client = null
  }
}

let client: AnalysisWorker | null = null
let starting: Promise<AnalysisWorker | null> | null = null
/** Set when module workers cannot start here; analysis then runs inline. */
let workersUnavailable = typeof Worker === 'undefined'

/** Starts the worker and waits for its handshake (module workers can fail to load silently). */
function startWorker(): Promise<AnalysisWorker | null> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
        type: 'module',
        name: 'insights-analysis',
      })
    } catch {
      resolve(null)
      return
    }
    const settle = (ok: boolean) => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      if (ok) resolve(new AnalysisWorker(worker))
      else {
        worker.terminate()
        resolve(null)
      }
    }
    const onMessage = (event: MessageEvent<AnalysisResponse>) => settle(event.data.type === 'ready')
    const onError = () => settle(false)
    const timer = setTimeout(() => settle(false), WORKER_START_TIMEOUT_MS)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ type: 'ping' } satisfies AnalysisRequest, [])
  })
}

function getWorker(): Promise<AnalysisWorker | null> {
  if (workersUnavailable) return Promise.resolve(null)
  if (client) return Promise.resolve(client)
  starting ??= startWorker().then((started) => {
    starting = null
    client = started
    if (!started) workersUnavailable = true
    return started
  })
  return starting
}

async function analyzeOffThread(doc: Animation, json: string): Promise<AnalysisResult> {
  const worker = await getWorker()
  if (worker) {
    try {
      return await worker.analyze(json)
    } catch (err) {
      // A crashed worker (e.g. out of memory) is restarted next time; this job runs inline.
      if (!(err instanceof WorkerCrash)) throw err
    }
  }
  return analyze(doc, json)
}

/* --------------------------------- Schedule --------------------------------- */

let subscribers = 0
let stopWatching: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let cancelIdle: (() => void) | null = null
let running = false
/** Bumped when watching stops, so a job finishing afterwards is ignored. */
let generation = 0

function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => fn(), { timeout: 800 })
    return () => cancelIdleCallback(handle)
  }
  const handle = setTimeout(fn, 1)
  return () => clearTimeout(handle)
}

function cancelScheduled(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  cancelIdle?.()
  cancelIdle = null
}

/**
 * Schedules an analysis of the open document (no-op when it is already analyzed).
 * `immediate` skips the debounce, e.g. right after a fix.
 */
export function scheduleAnalysis(opts: { immediate?: boolean } = {}): void {
  if (subscribers === 0) return
  cancelScheduled()
  const { doc, meta } = useDocument.getState()
  const state = useAnalysis.getState()
  const docId = meta?.id ?? null
  if (!doc) {
    if (state !== EMPTY_ANALYSIS) useAnalysis.setState(EMPTY_ANALYSIS, true)
    return
  }
  const otherFile = state.docId !== docId
  if (otherFile) {
    // Never show the previous file's issues for this one.
    useAnalysis.setState({ ...EMPTY_ANALYSIS, docId, pending: true }, true)
    resetIssuesUi()
  } else if (state.doc === doc) {
    if (state.pending) useAnalysis.setState({ pending: false })
    return
  } else if (!state.pending) {
    useAnalysis.setState({ pending: true })
  }
  // The running job reschedules itself when it ends.
  if (running) return
  const delay =
    opts.immediate || otherFile || !state.result ? 0 : debounceFor(state.result.size?.raw)
  timer = setTimeout(() => {
    timer = null
    cancelIdle = whenIdle(() => {
      cancelIdle = null
      void run()
    })
  }, delay)
}

async function run(): Promise<void> {
  const { doc, meta } = useDocument.getState()
  if (!doc || subscribers === 0 || running) return
  if (useAnalysis.getState().doc === doc) return
  const docId = meta?.id ?? null
  const gen = generation
  running = true
  let result: AnalysisResult
  try {
    result = await analyzeOffThread(doc, JSON.stringify(doc))
    // Partial failure (e.g. the checker stopped on odd data): the size is still shown.
    if (result.error) console.error('Document analysis failed:', result.error)
  } catch (err) {
    console.error('Document analysis failed', err)
    const message = err instanceof Error ? err.message : String(err)
    result = { size: null, issues: null, stats: null, error: message, ms: 0 }
  } finally {
    running = false
  }
  if (gen !== generation) {
    // Watching stopped meanwhile; if it restarted, its schedule waited for this job.
    if (subscribers > 0) scheduleAnalysis()
    return
  }
  const current = useDocument.getState()
  if ((current.meta?.id ?? null) === docId) {
    useAnalysis.setState({ result, doc, docId, pending: current.doc !== doc })
    clearFixed()
  }
  if (current.doc !== doc) scheduleAnalysis()
}

/** Runs the analysis again (e.g. after it failed). */
export function retryAnalysis(): void {
  useAnalysis.setState({ doc: null })
  scheduleAnalysis({ immediate: true })
}

function start(): void {
  stopWatching = useDocument.subscribe(
    (s) => s.doc,
    () => scheduleAnalysis(),
  )
  scheduleAnalysis()
}

function stop(): void {
  stopWatching?.()
  stopWatching = null
  cancelScheduled()
  generation++
}

/** Registers a consumer of the analysis; returns the release function. */
export function acquireAnalysis(): () => void {
  subscribers++
  if (subscribers === 1) start()
  let released = false
  return () => {
    if (released) return
    released = true
    subscribers--
    if (subscribers === 0) stop()
  }
}

/** Keeps the analysis running while the calling component is mounted. */
export function useAnalysisSubscription(): void {
  useEffect(() => acquireAnalysis(), [])
}
