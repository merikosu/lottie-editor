/**
 * Visual verification (browser main thread only): renders the original and the optimized
 * animation with lottie-web's canvas renderer at sampled frames and compares the pixels.
 *
 * Both documents go through the editor's render-copy preparation (`prepareAnimationData`), so
 * they are normalized the same way; expressions are not evaluated.
 *
 * Rasterizers quantize edge coverage (Skia samples a quarter pixel horizontally), so moving an
 * edge by a thousandth of a pixel can flip single edge pixels by 64 levels or more: raw pixel
 * differences have a noise floor that says nothing about what a viewer sees. The comparison
 * therefore looks at the difference averaged over each pixel's 3×3 neighbourhood — isolated
 * quantization flips fade below the threshold, while a real change (an edge moved by half a
 * pixel, a missing line, a wrong color) keeps a coherent difference. A pixel differs when that
 * local difference exceeds `threshold`; a frame matches when at most `allowedShare` of its
 * pixels differ. `maxDiff` / `meanDiff` report the raw (unfiltered) differences.
 *
 * `autoSafe` optimizes, verifies, and while the verification fails backs off step by step
 * (halving the tolerances, raising image quality, then disabling the lossy techniques), and
 * reports what it had to back off.
 */
import { prepareAnimationData } from '../../player/prepare'
import type { Animation } from '../types'
import { optimizeAnimation } from './pipeline'
import { resolveOptions } from './presets'
import type {
  OptimizeHooks,
  OptimizeOptions,
  OptimizeOptionsInput,
  OptimizeReport,
  OptimizeResult,
  TechniqueId,
  VerifyVisualOptions,
  VisualReport,
} from './types'

interface LoadedAnimation {
  goToAndStop(value: number, isFrame: boolean): void
  destroy(): void
  addEventListener(name: string, cb: () => void): () => void
  isLoaded: boolean
  firstFrame: number
  totalFrames: number
}

interface LottieModule {
  loadAnimation(params: Record<string, unknown>): LoadedAnimation
}

let lottiePromise: Promise<LottieModule> | null = null

function loadLottie(): Promise<LottieModule> {
  lottiePromise ??= import('lottie-web').then((m) => (m.default ?? m) as unknown as LottieModule)
  return lottiePromise
}

function abortError(): DOMException {
  return new DOMException('The verification was cancelled.', 'AbortError')
}

/**
 * Runs `fn` with a seeded `Math.random` (mulberry32). lottie-web draws some things at random, e.g.
 * the letter order of text animators with "Randomize order" (`rn`), a fresh order per instance:
 * two renders of one document then differ although nothing changed. With the same seed for the
 * same step of both renders (loading, each frame), their random choices are the same.
 */
export function withSeededRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random
  let state = seed >>> 0
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  try {
    return fn()
  } finally {
    Math.random = original
  }
}

/** Seed of the loading step; frames use their own (see `frameSeed`). */
const LOAD_SEED = 0x51f15e

const frameSeed = (frame: number) => (Math.round(frame * 100) * 2654435761) >>> 0

interface Renderer {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  anim: LoadedAnimation
}

async function createRenderer(
  lottie: LottieModule,
  doc: Animation,
  width: number,
  height: number,
): Promise<Renderer> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is not available')
  const data = prepareAnimationData(doc, { imagePlaceholders: true })
  const anim = withSeededRandom(LOAD_SEED, () =>
    lottie.loadAnimation({
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      animationData: data,
      rendererSettings: {
        context: ctx,
        clearCanvas: true,
        dpr: 1,
        preserveAspectRatio: 'xMidYMid meet',
        progressiveLoad: false,
        runExpressions: false,
      },
    }),
  )
  // Images decode asynchronously; the canvas renderer reports DOMLoaded once they are ready.
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    const off = anim.addEventListener('DOMLoaded', () => {
      off()
      finish()
    })
    setTimeout(finish, 5000)
  })
  return { canvas, ctx, anim }
}

function renderPixels(r: Renderer, frame: number): Uint8ClampedArray {
  const relative = frame - r.anim.firstFrame
  r.anim.goToAndStop(Math.min(Math.max(0, relative), Math.max(0, r.anim.totalFrames - 0.001)), true)
  return r.ctx.getImageData(0, 0, r.canvas.width, r.canvas.height).data
}

/** Local differences (0..255) at or below this are not drawn on the heatmap. */
const HEATMAP_NOISE = 2

/** Largest premultiplied channel difference of every pixel (0..255). */
function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, out: Float32Array): void {
  for (let p = 0, i = 0; i < a.length; i += 4, p++) {
    const aa = a[i + 3]
    const ba = b[i + 3]
    let d = Math.abs(aa - ba)
    for (let c = 0; c < 3; c++) {
      const x = (a[i + c] * aa) / 255
      const y = (b[i + c] * ba) / 255
      const dc = Math.abs(x - y)
      if (dc > d) d = dc
    }
    out[p] = d
  }
}

/** 3×3 box average of a difference map (edges use the available neighbours). */
function boxBlur(src: Float32Array, width: number, height: number, out: Float32Array): void {
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1)
    const y1 = Math.min(height - 1, y + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1)
      const x1 = Math.min(width - 1, x + 1)
      let sum = 0
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * width
        for (let xx = x0; xx <= x1; xx++) sum += src[row + xx]
      }
      out[y * width + x] = sum / ((x1 - x0 + 1) * (y1 - y0 + 1))
    }
  }
}

/** Frames spread evenly over the animation (root composition time). */
export function visualFrames(anim: Animation, count: number): number[] {
  const ip = typeof anim.ip === 'number' ? anim.ip : 0
  const op = typeof anim.op === 'number' ? anim.op : ip + 1
  const last = Math.max(ip, op - 1)
  const n = Math.max(1, Math.min(count, Math.ceil(op - ip)))
  if (n === 1) return [ip]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Math.round((ip + ((last - ip) * i) / (n - 1)) * 100) / 100)
  return [...new Set(out)]
}

/**
 * Renders both animations at `frames` sampled frames (longest side `size` px) and compares
 * them. Browser main thread only (uses DOM canvas and lottie-web).
 */
export async function verifyVisual(
  original: Animation,
  optimized: Animation,
  opts: VerifyVisualOptions = {},
): Promise<VisualReport> {
  const size = Math.max(16, Math.round(opts.size ?? 256))
  const threshold = opts.threshold ?? 24
  const allowedShare = opts.allowedShare ?? 0.001
  const w0 = typeof original.w === 'number' && original.w > 0 ? original.w : size
  const h0 = typeof original.h === 'number' && original.h > 0 ? original.h : size
  const k = size / Math.max(w0, h0)
  const width = Math.max(1, Math.round(w0 * k))
  const height = Math.max(1, Math.round(h0 * k))
  const lottie = await loadLottie()
  if (opts.signal?.aborted) throw abortError()
  const a = await createRenderer(lottie, original, width, height)
  const b = await createRenderer(lottie, optimized, width, height)
  const frames = visualFrames(original, opts.frames ?? 24)
  const diff = new Float32Array(width * height)
  const local = new Float32Array(width * height)
  const perFrame: number[] = []
  let maxDiff = 0
  let sum = 0
  let worst = -1
  let worstShare = -1
  let worstDiff: Float32Array | null = null
  try {
    for (const frame of frames) {
      if (opts.signal?.aborted) throw abortError()
      // The same seed for both: lottie-web's random choices (made while rendering) match.
      const pa = withSeededRandom(frameSeed(frame), () => renderPixels(a, frame))
      const pb = withSeededRandom(frameSeed(frame), () => renderPixels(b, frame))
      pixelDiff(pa, pb, diff)
      boxBlur(diff, width, height, local)
      let over = 0
      for (let p = 0; p < diff.length; p++) {
        const d = diff[p]
        sum += d
        if (d > maxDiff) maxDiff = d
        if (local[p] > threshold) over++
      }
      const share = over / diff.length
      perFrame.push(share)
      if (share > worstShare || (share === worstShare && worst < 0)) {
        worstShare = share
        worst = frame
        worstDiff = local.slice()
      }
      // Keep the page responsive between frames.
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    a.anim.destroy()
    b.anim.destroy()
  }
  let heatmap: ImageData | undefined
  if (opts.heatmap !== false && worstDiff && typeof ImageData !== 'undefined') {
    heatmap = new ImageData(width, height)
    const px = heatmap.data
    for (let p = 0; p < worstDiff.length; p++) {
      const d = worstDiff[p]
      // Rasterization noise and one-level colour rounding are invisible: not drawn, or every
      // shape of a perfectly good result would light up.
      if (d <= HEATMAP_NOISE) continue
      const i = p * 4
      if (d > threshold) {
        // Red where the check counts a difference; stronger with the difference.
        px[i] = 240
        px[i + 1] = 56
        px[i + 2] = 48
        px[i + 3] = Math.min(255, Math.round(176 + (d - threshold) * 2))
      } else {
        // Amber below the threshold, fading towards the noise floor.
        px[i] = 255
        px[i + 1] = 176
        px[i + 2] = 32
        px[i + 3] = Math.round(
          40 + (120 * (d - HEATMAP_NOISE)) / Math.max(1, threshold - HEATMAP_NOISE),
        )
      }
    }
  }
  return {
    maxDiff: Math.round(maxDiff * 100) / 100,
    meanDiff: frames.length ? sum / (frames.length * diff.length) : 0,
    perFrame,
    frames,
    worstFrame: worst < 0 ? (frames[0] ?? 0) : worst,
    worstShare: Math.max(0, worstShare),
    match: perFrame.every((s) => s <= allowedShare),
    heatmap,
  }
}

/* -------------------------------------------------------------------------- */
/*                                  autoSafe                                  */
/* -------------------------------------------------------------------------- */

/** One back-off step: which option changed, from what to what. */
export interface Backoff {
  kind: 'tolerance' | 'imageQuality' | 'disable'
  technique?: TechniqueId
  from?: number
  to?: number
}

export interface AutoSafeOptions extends Pick<OptimizeHooks, 'signal' | 'onProgress' | 'source'> {
  /** Optimizer to use (e.g. a worker client's `optimize`); defaults to the in-thread pipeline. */
  optimize?: (
    anim: Animation,
    options: OptimizeOptions,
    hooks: OptimizeHooks,
  ) => Promise<OptimizeResult>
  verify?: VerifyVisualOptions
  /** Most optimize → verify rounds (default 6). */
  maxRounds?: number
}

export interface AutoSafeResult {
  result: OptimizeResult
  visual: VisualReport
  /** Back-off steps applied (empty when the first result verified). */
  backoffs: Backoff[]
  /** The final result verified (false when even the safest settings differ, e.g. renderer noise). */
  verified: boolean
}

const changed = (report: OptimizeReport | undefined, id: TechniqueId): boolean =>
  !report || (report.steps.find((s) => s.id === id)?.changes ?? 0) > 0

/**
 * Techniques disabled one by one once the tolerance cannot go lower: the geometric ones, then
 * the lossy `names`, then — a last resort, so the guarantee holds even if a lossless rewrite hits
 * a player quirk — the lossless ones, the most intricate first.
 */
const BACKOFF_ORDER: readonly TechniqueId[] = [
  'paths',
  'keyframes',
  'precision',
  'invisible',
  'names',
  'defaults',
  'hidden',
  'empty',
  'staticize',
  'dedupeAssets',
  'unusedAssets',
  'legacy',
]

/**
 * The next, safer options after a failed verification (null when nothing is left to back off).
 * Only techniques that changed something in `report` are backed off, images first (their
 * losses are the largest), then the geometric tolerance, then the other techniques one by one
 * (see `BACKOFF_ORDER`).
 */
export function nextBackoff(
  o: OptimizeOptions,
  report?: OptimizeReport,
): { options: OptimizeOptions; step: Backoff } | null {
  const next: OptimizeOptions = {
    ...o,
    techniques: { ...o.techniques },
    image: { ...o.image },
    names: { ...o.names },
  }
  const images = o.techniques.images && changed(report, 'images')
  if (images && (o.image.quality < 0.95 || o.image.maxScale > 0)) {
    next.image.quality = Math.max(0.95, o.image.quality)
    next.image.maxScale = 0
    return {
      options: next,
      step: { kind: 'imageQuality', from: o.image.quality, to: next.image.quality },
    }
  }
  if (images) {
    next.techniques.images = false
    return { options: next, step: { kind: 'disable', technique: 'images' } }
  }
  const geometric = (['precision', 'keyframes', 'paths'] as TechniqueId[]).some(
    (id) => o.techniques[id] && changed(report, id),
  )
  if (geometric && o.pxTolerance > 0.0125) {
    next.pxTolerance = o.pxTolerance / 2
    return { options: next, step: { kind: 'tolerance', from: o.pxTolerance, to: next.pxTolerance } }
  }
  for (const id of BACKOFF_ORDER) {
    if (o.techniques[id] && changed(report, id)) {
      next.techniques[id] = false
      return { options: next, step: { kind: 'disable', technique: id } }
    }
  }
  return null
}

/**
 * Optimizes, verifies visually, and backs off until the result matches (or nothing is left to
 * back off). Browser main thread only.
 */
export async function autoSafe(
  anim: Animation,
  input?: OptimizeOptionsInput,
  opts: AutoSafeOptions = {},
): Promise<AutoSafeResult> {
  const run = opts.optimize ?? ((a, o, h) => optimizeAnimation(a, o, h))
  let options = resolveOptions(input)
  const backoffs: Backoff[] = []
  const hooks: OptimizeHooks = {
    signal: opts.signal,
    onProgress: opts.onProgress,
    source: opts.source,
  }
  let result = await run(anim, options, hooks)
  let visual = await verifyVisual(anim, result.animation, { ...opts.verify, signal: opts.signal })
  const rounds = opts.maxRounds ?? 6
  for (let round = 0; !visual.match && round < rounds; round++) {
    const next = nextBackoff(options, result.report)
    if (!next) break
    options = next.options
    backoffs.push(next.step)
    result = await run(anim, options, hooks)
    visual = await verifyVisual(anim, result.animation, { ...opts.verify, signal: opts.signal })
  }
  return { result, visual, backoffs, verified: visual.match }
}
