/**
 * GIF encoding session: frames go to a worker (in parallel with rendering, a bounded number in
 * flight so memory stays flat) or, where module workers are unavailable, to the same encoder on
 * the main thread.
 */
import {
  GifCore,
  measureGifSamples,
  type GifCoreOptions,
  type GifSamplePair,
  type GifSampleSizes,
} from './gif-core'
import type { GifWorkerRequest, GifWorkerResponse } from './gif.worker'

export interface GifSession {
  /** Fixes one palette for all frames, built from sample frames (RGBA). */
  setGlobalPalette(samples: Uint8ClampedArray[]): Promise<void>
  /** Queues a frame; resolves when the encoder can take the next one. The buffer is consumed. */
  addFrame(rgba: Uint8ClampedArray, delayCs: number): Promise<void>
  /** Frames fully encoded so far. */
  readonly encoded: number
  /** Waits for the remaining frames and returns the GIF bytes. */
  finish(): Promise<Uint8Array<ArrayBuffer>>
  /** Stops the encoder (idempotent). */
  dispose(): void
}

const MAX_IN_FLIGHT = 3
const WORKER_START_TIMEOUT_MS = 4000
const MEASURE_TIMEOUT_MS = 60_000

/** Encoder on the main thread (fallback). */
function inlineSession(options: GifCoreOptions): GifSession {
  const core = new GifCore(options)
  let encoded = 0
  return {
    async setGlobalPalette(samples) {
      core.useGlobalPalette(samples)
    },
    async addFrame(rgba, delay) {
      core.addFrame(rgba, delay)
      encoded++
    },
    get encoded() {
      return encoded
    },
    async finish() {
      return core.finish()
    },
    dispose() {},
  }
}

class WorkerSession implements GifSession {
  private readonly worker: Worker
  private inFlight = 0
  private encodedFrames = 0
  private failure: Error | null = null
  private waiters: (() => void)[] = []
  private paletteWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null
  private doneWaiter: {
    resolve: (b: Uint8Array<ArrayBuffer>) => void
    reject: (e: Error) => void
  } | null = null
  private disposed = false

  constructor(worker: Worker) {
    this.worker = worker
    worker.addEventListener('message', (event: MessageEvent<GifWorkerResponse>) =>
      this.onMessage(event.data),
    )
    worker.addEventListener('error', (event) =>
      this.fail(new Error(event.message || 'The GIF encoder stopped')),
    )
  }

  get encoded(): number {
    return this.encodedFrames
  }

  private post(message: GifWorkerRequest, transfer: Transferable[] = []): void {
    if (this.failure) throw this.failure
    this.worker.postMessage(message, transfer)
  }

  private onMessage(message: GifWorkerResponse): void {
    switch (message.type) {
      case 'ack':
        this.encodedFrames = message.frames
        this.inFlight = Math.max(0, this.inFlight - 1)
        this.wake()
        break
      case 'palette-ready':
        this.paletteWaiter?.resolve()
        this.paletteWaiter = null
        break
      case 'done':
        this.doneWaiter?.resolve(new Uint8Array(message.buffer))
        this.doneWaiter = null
        break
      case 'error':
        this.fail(new Error(message.message))
        break
    }
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach((w) => w())
  }

  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    this.paletteWaiter?.reject(error)
    this.doneWaiter?.reject(error)
    this.paletteWaiter = null
    this.doneWaiter = null
    this.wake()
  }

  setGlobalPalette(samples: Uint8ClampedArray[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.paletteWaiter = { resolve, reject }
      // Copies own their buffers, so transferring them is safe.
      const buffers = samples.map(
        (s) =>
          (s.byteOffset === 0 && s.byteLength === s.buffer.byteLength ? s : s.slice())
            .buffer as ArrayBuffer,
      )
      try {
        this.post({ type: 'palette', samples: buffers }, buffers)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  async addFrame(rgba: Uint8ClampedArray, delay: number): Promise<void> {
    while (this.inFlight >= MAX_IN_FLIGHT && !this.failure) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    if (this.failure) throw this.failure
    const owned =
      rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength ? rgba : rgba.slice()
    const buffer = owned.buffer as ArrayBuffer
    this.inFlight++
    this.post({ type: 'frame', buffer, delay }, [buffer])
  }

  finish(): Promise<Uint8Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure)
      this.doneWaiter = { resolve, reject }
      this.post({ type: 'finish' }, [])
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.terminate()
    this.fail(new DOMException('The export was cancelled', 'AbortError') as unknown as Error)
  }
}

/** Starts a worker and waits until it answers (module workers can fail to load silently). */
function startWorker(options: GifCoreOptions): Promise<Worker | null> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./gif.worker.ts', import.meta.url), {
        type: 'module',
        name: 'gif-encoder',
      })
    } catch {
      resolve(null)
      return
    }
    const settle = (ok: boolean) => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      if (ok) resolve(worker)
      else {
        worker.terminate()
        resolve(null)
      }
    }
    const onMessage = (event: MessageEvent<GifWorkerResponse>) =>
      settle(event.data.type === 'ready')
    const onError = () => settle(false)
    const timer = setTimeout(() => settle(false), WORKER_START_TIMEOUT_MS)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ type: 'init', options } satisfies GifWorkerRequest, [])
  })
}

/** Creates an encoding session (worker when possible). */
export async function createGifSession(
  options: GifCoreOptions,
  opts: { worker?: boolean } = {},
): Promise<GifSession> {
  if (opts.worker !== false && typeof Worker !== 'undefined') {
    const worker = await startWorker(options)
    if (worker) return new WorkerSession(worker)
  }
  return inlineSession(options)
}

function ownedBuffer(pixels: Uint8ClampedArray): ArrayBuffer {
  const owned =
    pixels.byteOffset === 0 && pixels.byteLength === pixels.buffer.byteLength
      ? pixels
      : pixels.slice()
  return owned.buffer as ArrayBuffer
}

/**
 * Measures GIF sizes on sample frames (see `measureGifSamples`) in a worker, so estimates never
 * freeze the dialog; on the main thread where module workers are unavailable. The sample
 * buffers are transferred to the worker (unusable afterwards).
 */
export async function measureGif(
  options: GifCoreOptions,
  pairs: GifSamplePair[],
  delays: [number, number],
  globalPalette: boolean,
  signal?: AbortSignal,
): Promise<GifSampleSizes> {
  signal?.throwIfAborted()
  const worker = typeof Worker === 'undefined' ? null : await startWorker(options)
  if (signal?.aborted) {
    worker?.terminate()
    signal.throwIfAborted()
  }
  if (!worker) return measureGifSamples(options, pairs, delays, globalPalette)
  return new Promise<GifSampleSizes>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      fn()
    }
    const onAbort = () =>
      finish(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')))
    const timer = setTimeout(
      () => finish(() => reject(new Error('The GIF size estimate timed out'))),
      MEASURE_TIMEOUT_MS,
    )
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', (event: MessageEvent<GifWorkerResponse>) => {
      const message = event.data
      if (message.type === 'measured')
        finish(() => resolve({ first: message.first, next: message.next }))
      else if (message.type === 'error') finish(() => reject(new Error(message.message)))
    })
    worker.addEventListener('error', (event) =>
      finish(() => reject(new Error(event.message || 'The GIF encoder stopped'))),
    )
    const buffers = pairs.map(
      ([a, b]) => [ownedBuffer(a), b ? ownedBuffer(b) : null] as [ArrayBuffer, ArrayBuffer | null],
    )
    const transfer = buffers.flatMap(([a, b]) => (b ? [a, b] : [a]))
    worker.postMessage(
      {
        type: 'measure',
        options,
        pairs: buffers,
        delays,
        globalPalette,
      } satisfies GifWorkerRequest,
      transfer,
    )
  })
}
