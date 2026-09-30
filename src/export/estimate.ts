/**
 * File size estimates for rendered exports, measured on real samples with the real encoders
 * (so they account for the content, the options and frame differencing), then extrapolated:
 *
 * - GIF: pairs of consecutive frames at a few points: the first frame's size plus the average
 *   size of a following (differenced) frame times the remaining frames. An upper bound: frames
 *   without changes are merged away in the real file. Encoding runs in a worker.
 * - PNG sequence: the average PNG of a few frames times the frame count.
 * - Video: the start of the video (one key frame interval) encoded with the export's settings,
 *   scaled to the length.
 *
 * The first frame is timed: heavy animations (hundreds of layers) get fewer samples, so an
 * estimate never renders more than about a second of frames.
 *
 * Estimates re-run whenever an option changes, so the renderer (building it is the slowest step
 * for big files) is kept between runs while the document, size, background and renderer stay the
 * same. Runs never overlap: each waits for the previous one to stop.
 */
import type { GifCoreOptions, GifSamplePair } from './gif-core'
import { measureGif } from './gif'
import {
  ESTIMATE_BUDGET_MS,
  KEY_FRAME_INTERVAL_S,
  samplesWithinBudget,
  spreadIndices,
} from './plan'
import {
  canvasToBlob,
  createFrameRenderer,
  type FrameRenderer,
  type FrameRendererOptions,
} from './render'
import { encodeVideo, videoBitrate, type VideoContainer, type VideoQuality } from './video'
import type { Animation } from '@/lottie/types'
import type { VideoCodec } from 'mediabunny'

const PAIRS = 5
const PNG_SAMPLES = 3
/** Video estimates encode real frames: they may take a little longer than the others. */
const VIDEO_BUDGET_MS = ESTIMATE_BUDGET_MS * 1.5
/** ZIP local header + central directory entry per file, roughly. */
const ZIP_ENTRY_BYTES = 110
/** An unused renderer is released after this long. */
const IDLE_RELEASE_MS = 30_000

/* -------------------------------------------------------------------------- */
/*                                Renderer cache                              */
/* -------------------------------------------------------------------------- */

interface CachedRenderer {
  doc: Animation
  key: string
  renderer: FrameRenderer
}

let cached: CachedRenderer | null = null
let lock: Promise<void> = Promise.resolve()
let idleTimer: ReturnType<typeof setTimeout> | null = null

function rendererKey(o: FrameRendererOptions): string {
  return [
    o.width,
    o.height,
    o.background ?? '',
    o.renderer,
    o.runExpressions,
    o.readback ? 1 : 0,
  ].join('|')
}

/** Destroys the renderer kept for estimates (the export dialog calls it when it closes). */
export function releaseEstimateRenderer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const current = cached
  cached = null
  // A running estimate still holds the renderer: destroy it once that run is over.
  if (current) void lock.then(() => current.renderer.destroy())
}

/**
 * Runs `fn` with a renderer for `doc` and `opts` (reused when they match the last run). The
 * renderer is not bound to `opts.signal` (it outlives this run): `fn` checks the signal itself.
 */
async function withRenderer<T>(
  doc: Animation,
  opts: FrameRendererOptions,
  fn: (r: FrameRenderer) => Promise<T>,
): Promise<T> {
  const previous = lock
  let release!: () => void
  lock = new Promise<void>((resolve) => (release = resolve))
  await previous
  try {
    opts.signal?.throwIfAborted()
    const key = rendererKey(opts)
    if (!cached || cached.doc !== doc || cached.key !== key) {
      cached?.renderer.destroy()
      cached = null
      const renderer = await createFrameRenderer(doc, { ...opts, signal: undefined })
      cached = { doc, key, renderer }
    }
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(releaseEstimateRenderer, IDLE_RELEASE_MS)
    opts.signal?.throwIfAborted()
    return await fn(cached.renderer)
  } finally {
    release()
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Estimates                                 */
/* -------------------------------------------------------------------------- */

/** Renders a frame and returns how long that took (ms): heavy animations get fewer samples. */
async function timedRender(renderer: FrameRenderer, time: number): Promise<number> {
  const started = performance.now()
  await renderer.render(time)
  return performance.now() - started
}

export async function estimateGif(
  doc: Animation,
  render: FrameRendererOptions,
  gif: Omit<GifCoreOptions, 'width' | 'height'>,
  times: number[],
  delays: number[],
  globalPalette: boolean,
): Promise<number> {
  const { width, height, signal } = render
  const pairs = await withRenderer(doc, { ...render, readback: true }, async (renderer) => {
    const pixels = () => renderer.context.getImageData(0, 0, width, height).data
    const read = async (t: number) => {
      signal?.throwIfAborted()
      await renderer.render(t)
      return pixels()
    }
    // Pairs sit in the middle of equal slices of the animation, away from the rest poses loops
    // often start and end with. The first render is timed to decide how many fit the budget.
    const span = Math.max(1, times.length - 1)
    const at = (slice: number, count: number) =>
      Math.min(span - 1, Math.floor(((slice + 0.5) * span) / count))
    signal?.throwIfAborted()
    const firstIndex = at(0, PAIRS)
    const firstMs = await timedRender(renderer, times[firstIndex])
    const first = pixels()
    const count = samplesWithinBudget(firstMs, 2, PAIRS)
    const out: GifSamplePair[] = []
    for (let slice = 0; slice < count; slice++) {
      const i = at(slice, count)
      const a = i === firstIndex && slice === 0 ? first : await read(times[i])
      const b = i + 1 < times.length ? await read(times[i + 1]) : null
      out.push([a, b])
    }
    return out
  })
  const firstDelays: [number, number] = [delays[0] ?? 4, delays[1] ?? delays[0] ?? 4]
  const sizes = await measureGif(
    { ...gif, width, height },
    pairs,
    firstDelays,
    globalPalette,
    signal,
  )
  return Math.round(sizes.first + sizes.next * Math.max(0, times.length - 1))
}

export async function estimatePngSequence(
  doc: Animation,
  render: FrameRendererOptions,
  times: number[],
): Promise<number> {
  const { signal } = render
  return withRenderer(doc, render, async (renderer) => {
    signal?.throwIfAborted()
    const started = performance.now()
    await renderer.render(times[0])
    let total = (await canvasToBlob(renderer.canvas)).size
    const count = samplesWithinBudget(performance.now() - started, 1, PNG_SAMPLES)
    const picks = spreadIndices(times.length, count).slice(1)
    for (const i of picks) {
      signal?.throwIfAborted()
      await renderer.render(times[i])
      total += (await canvasToBlob(renderer.canvas)).size
    }
    const average = total / (picks.length + 1)
    return Math.round((average + ZIP_ENTRY_BYTES) * times.length + 22)
  })
}

/**
 * Encodes the start of the video (one key frame interval, like the real file's rhythm of key
 * and following frames) and scales it to the length. Animations too heavy to render that many
 * frames within the budget encode fewer; such a sample over-weights its key frame, so the
 * result is capped by what the encoder's bitrate allows.
 */
export async function estimateVideo(
  doc: Animation,
  render: FrameRendererOptions,
  video: {
    container: VideoContainer
    codec: VideoCodec
    fps: number
    quality: VideoQuality
    transparent: boolean
  },
  times: number[],
): Promise<number> {
  const { signal, width, height } = render
  return withRenderer(doc, render, async (renderer) => {
    signal?.throwIfAborted()
    const firstMs = await timedRender(renderer, times[0])
    const interval = Math.min(
      times.length,
      Math.max(1, Math.round(video.fps * KEY_FRAME_INTERVAL_S)),
    )
    const count = Math.min(
      interval,
      Math.max(2, samplesWithinBudget(firstMs, 1, interval, VIDEO_BUDGET_MS)),
    )
    const { blob } = await encodeVideo({
      ...video,
      canvas: renderer.canvas,
      renderFrame: (i) => renderer.render(times[i]),
      frameCount: count,
      signal,
    })
    const scaled = (blob.size * times.length) / count
    if (count >= interval) return Math.round(scaled)
    const seconds = times.length / video.fps
    // An alpha stream is encoded next to the color stream with the same settings.
    const streams = video.transparent && video.container === 'webm' ? 2 : 1
    const cap =
      (videoBitrate(video.codec, width, height, video.fps, video.quality) / 8) * seconds * streams
    return Math.round(Math.min(scaled, cap))
  })
}
