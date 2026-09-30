/**
 * GIF encoding worker: quantizes, dithers and LZW-compresses frames rendered on the main thread,
 * so encoding runs in parallel with rendering and the editor stays responsive.
 */
import { GifCore, measureGifSamples, type GifCoreOptions } from './gif-core'

export type GifWorkerRequest =
  | { type: 'init'; options: GifCoreOptions }
  | { type: 'palette'; samples: ArrayBuffer[] }
  | { type: 'frame'; buffer: ArrayBuffer; delay: number }
  | { type: 'finish' }
  /** Size estimate from sample frames (stateless, answered with 'measured'). */
  | {
      type: 'measure'
      options: GifCoreOptions
      pairs: [ArrayBuffer, ArrayBuffer | null][]
      delays: [number, number]
      globalPalette: boolean
    }

export type GifWorkerResponse =
  | { type: 'ready' }
  | { type: 'palette-ready' }
  | { type: 'ack'; frames: number }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'measured'; first: number; next: number }
  | { type: 'error'; message: string }

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<GifWorkerRequest>) => void): void
  postMessage(message: GifWorkerResponse, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope
let core: GifCore | null = null
let frames = 0

function requireCore(): GifCore {
  if (!core) throw new Error('The GIF encoder was not initialized')
  return core
}

scope.addEventListener('message', (event) => {
  const message = event.data
  try {
    switch (message.type) {
      case 'init':
        core = new GifCore(message.options)
        frames = 0
        scope.postMessage({ type: 'ready' }, [])
        break
      case 'palette':
        requireCore().useGlobalPalette(
          message.samples.map((buffer) => new Uint8ClampedArray(buffer)),
        )
        scope.postMessage({ type: 'palette-ready' }, [])
        break
      case 'frame':
        requireCore().addFrame(new Uint8ClampedArray(message.buffer), message.delay)
        frames++
        scope.postMessage({ type: 'ack', frames }, [])
        break
      case 'finish': {
        const bytes = requireCore().finish()
        core = null
        scope.postMessage({ type: 'done', buffer: bytes.buffer }, [bytes.buffer])
        break
      }
      case 'measure': {
        const pairs = message.pairs.map(
          ([a, b]) => [new Uint8ClampedArray(a), b ? new Uint8ClampedArray(b) : null] as const,
        )
        const sizes = measureGifSamples(
          message.options,
          pairs,
          message.delays,
          message.globalPalette,
        )
        scope.postMessage({ type: 'measured', ...sizes }, [])
        break
      }
    }
  } catch (err) {
    scope.postMessage(
      { type: 'error', message: err instanceof Error ? err.message : String(err) },
      [],
    )
  }
})
