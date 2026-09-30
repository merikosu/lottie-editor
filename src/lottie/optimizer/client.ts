/**
 * Typed client of the optimizer worker.
 *
 *   const client = createOptimizerClient()
 *   const result = await client.optimize(anim, 'balanced', (step, done, total) => …)
 *   client.dispose()
 *
 * Jobs run one at a time, in order. `cancel()` stops everything (the worker is terminated and
 * recreated on the next job); a job's own `signal` cancels just that job. When Web Workers are
 * unavailable (or the worker fails to start) the same code runs on the main thread, yielding
 * between steps.
 */
import type { Animation } from '../types'
import type { WorkerRequest, WorkerResponse } from './protocol'
import type { VerifySemanticOptions } from './semantic'
import type {
  Analysis,
  OptimizeOptionsInput,
  OptimizeResult,
  ProgressFn,
  SemanticReport,
} from './types'

export interface OptimizeJobOptions {
  signal?: AbortSignal
  /** Original file text (whitespace included) for honest before sizes. */
  source?: string
  /** Measure gzip after every step (default true). */
  measureGzip?: boolean
}

export interface OptimizerClient {
  optimize(
    anim: Animation | string,
    options?: OptimizeOptionsInput,
    onProgress?: ProgressFn,
    job?: OptimizeJobOptions,
  ): Promise<OptimizeResult>
  analyze(
    anim: Animation | string,
    options?: OptimizeOptionsInput,
    job?: { signal?: AbortSignal },
  ): Promise<Analysis>
  verifySemantic(
    a: Animation | string,
    b: Animation | string,
    options?: VerifySemanticOptions,
    job?: { signal?: AbortSignal },
  ): Promise<SemanticReport>
  /** Rejects every pending and running job with an AbortError. */
  cancel(): void
  /** Cancels everything and releases the worker. */
  dispose(): void
  /** True while jobs run in a Web Worker (false after a fallback to the main thread). */
  readonly usesWorker: boolean
}

export interface OptimizerClientOptions {
  /** Force the main-thread implementation (tests, environments without workers). */
  worker?: boolean
}

type Payload = WorkerRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never

interface Job {
  id: number
  payload: Payload
  onProgress?: ProgressFn
  /** Aborted when the job is cancelled (stops a main-thread run between steps). */
  controller: AbortController
  resolve(value: WorkerResponse): void
  reject(error: Error): void
  cleanup(): void
}

function abortError(): DOMException {
  return new DOMException('The optimization was cancelled.', 'AbortError')
}

const toJson = (anim: Animation | string) =>
  typeof anim === 'string' ? anim : JSON.stringify(anim)

/** Runs a request on the main thread (same code as the worker). */
async function runInline(
  payload: Payload,
  id: number,
  onProgress: ProgressFn | undefined,
  signal?: AbortSignal,
): Promise<WorkerResponse> {
  switch (payload.type) {
    case 'optimize': {
      const { optimizeAnimation } = await import('./pipeline')
      const result = await optimizeAnimation(payload.json, payload.options, {
        source: payload.source,
        measureGzip: payload.measureGzip,
        signal,
        onProgress,
      })
      return { type: 'optimized', id, json: result.json, report: result.report }
    }
    case 'analyze': {
      const { analyze } = await import('./analyze')
      return { type: 'analysis', id, analysis: analyze(payload.json, payload.options) }
    }
    case 'verifySemantic': {
      const { verifySemantic } = await import('./semantic')
      const report = verifySemantic(
        JSON.parse(payload.a) as Animation,
        JSON.parse(payload.b) as Animation,
        payload.options,
      )
      return { type: 'semantic', id, report }
    }
  }
}

export function createOptimizerClient(opts: OptimizerClientOptions = {}): OptimizerClient {
  let worker: Worker | null = null
  let workerBroken = opts.worker === false || typeof Worker === 'undefined'
  let nextId = 1
  const queue: Job[] = []
  let running: Job | null = null
  let disposed = false

  const startWorker = (): Worker | null => {
    if (workerBroken) return null
    if (worker) return worker
    try {
      worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      workerBroken = true
      return null
    }
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      const job = running
      if (!job || msg.id !== job.id) return
      if (msg.type === 'progress') {
        job.onProgress?.(msg.step, msg.done, msg.total)
        return
      }
      finish(job, msg)
    })
    worker.addEventListener('error', (event) => {
      // The worker could not start (or crashed): fall back to the main thread for this job.
      event.preventDefault?.()
      worker?.terminate()
      worker = null
      workerBroken = true
      const job = running
      if (job) {
        running = null
        queue.unshift(job)
      }
      pump()
    })
    return worker
  }

  const finish = (job: Job, msg: WorkerResponse) => {
    if (running === job) running = null
    job.cleanup()
    if (msg.type === 'error') {
      const err =
        msg.name === 'AbortError'
          ? abortError()
          : Object.assign(new Error(msg.message), { name: msg.name })
      job.reject(err)
    } else job.resolve(msg)
    pump()
  }

  const pump = () => {
    if (running || disposed) return
    const job = queue.shift()
    if (!job) return
    running = job
    const w = startWorker()
    if (w) {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker, not window
      w.postMessage({ ...job.payload, id: job.id } as WorkerRequest)
      return
    }
    runInline(job.payload, job.id, job.onProgress, job.controller.signal).then(
      (msg) => {
        if (running === job) finish(job, msg)
      },
      (err: unknown) => {
        if (running !== job) return
        const e = err instanceof Error ? err : new Error(String(err))
        finish(job, { type: 'error', id: job.id, name: e.name, message: e.message })
      },
    )
  }

  /** Stops the running job hard (terminates the worker) and rejects it. */
  const abortRunning = () => {
    const job = running
    if (!job) return
    running = null
    job.controller.abort()
    if (worker) {
      worker.terminate()
      worker = null
    }
    job.cleanup()
    job.reject(abortError())
  }

  const submit = (
    payload: Payload,
    onProgress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<WorkerResponse> => {
    if (disposed) return Promise.reject(new Error('The optimizer client was disposed.'))
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise<WorkerResponse>((resolve, reject) => {
      const job: Job = {
        id: nextId++,
        payload,
        onProgress,
        controller: new AbortController(),
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      }
      function onAbort() {
        if (running === job) {
          abortRunning()
          pump()
          return
        }
        const i = queue.indexOf(job)
        if (i >= 0) queue.splice(i, 1)
        job.cleanup()
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort)
      queue.push(job)
      pump()
    })
  }

  const cancel = () => {
    for (const job of queue.splice(0)) {
      job.cleanup()
      job.reject(abortError())
    }
    abortRunning()
  }

  return {
    get usesWorker() {
      return !workerBroken
    },
    async optimize(anim, options, onProgress, job = {}) {
      const msg = await submit(
        {
          type: 'optimize',
          json: toJson(anim),
          options,
          source: job.source,
          measureGzip: job.measureGzip,
        },
        onProgress,
        job.signal,
      )
      if (msg.type !== 'optimized') throw new Error('Unexpected optimizer response')
      return { animation: JSON.parse(msg.json) as Animation, json: msg.json, report: msg.report }
    },
    async analyze(anim, options, job = {}) {
      const msg = await submit(
        { type: 'analyze', json: toJson(anim), options },
        undefined,
        job.signal,
      )
      if (msg.type !== 'analysis') throw new Error('Unexpected optimizer response')
      return msg.analysis
    },
    async verifySemantic(a, b, options, job = {}) {
      const msg = await submit(
        { type: 'verifySemantic', a: toJson(a), b: toJson(b), options },
        undefined,
        job.signal,
      )
      if (msg.type !== 'semantic') throw new Error('Unexpected optimizer response')
      return msg.report
    },
    cancel,
    dispose() {
      cancel()
      disposed = true
      worker?.terminate()
      worker = null
    },
  }
}
