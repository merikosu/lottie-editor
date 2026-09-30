/**
 * Pure planning for rendered exports (GIF, video, PNG sequence, frames): which composition
 * frames to render, at what size, and how GIF frame delays are rounded.
 *
 * Time model: frames are absolute frames of the root composition (`ip ≤ frame < op`), the same
 * values the playhead uses. An export at a different frame rate samples the animation by time,
 * so a 30 fps animation exported at 60 fps renders the half frames in between (lottie-web
 * interpolates sub-frames), and one exported at 24 fps skips evenly.
 */
import type { Animation } from '@/lottie/types'

/** Half-open range of root composition frames: [start, end). */
export interface FrameRange {
  start: number
  end: number
}

export type RangeMode = 'all' | 'workArea'

/** The range to export: the work area when asked for (and set), otherwise the whole animation. */
export function resolveRange(
  doc: Pick<Animation, 'ip' | 'op'>,
  workArea: FrameRange | null,
  mode: RangeMode,
): FrameRange {
  if (mode === 'workArea' && workArea && workArea.end > workArea.start) {
    const start = Math.max(doc.ip, workArea.start)
    const end = Math.min(doc.op, workArea.end)
    if (end > start) return { start, end }
  }
  return { start: doc.ip, end: doc.op }
}

/** Duration of a range in seconds at the composition frame rate. */
export function rangeSeconds(range: FrameRange, fps: number): number {
  return fps > 0 ? Math.max(0, range.end - range.start) / fps : 0
}

/** Last whole frame inside the range (the end is exclusive), for "Frames 0–59" labels. */
export function lastFrameOf(range: FrameRange): number {
  return Math.max(range.start, Math.ceil(range.end) - 1)
}

/** Number of frames an export produces for one pass over `range` at `outFps`. */
export function outputFrameCount(range: FrameRange, compFps: number, outFps: number): number {
  const seconds = rangeSeconds(range, compFps)
  return Math.max(1, Math.round(seconds * outFps))
}

/** Snaps values within 1e-6 of a whole number (float noise from fps ratios) to it. */
function snapWhole(t: number): number {
  const r = Math.round(t)
  return Math.abs(t - r) < 1e-6 ? r : t
}

/**
 * Composition frames to render, one per output frame. `repeat` plays the range several times
 * in a row (for platforms with a minimum video length).
 */
export function sampleTimes(
  range: FrameRange,
  compFps: number,
  outFps: number,
  repeat = 1,
): number[] {
  const count = outputFrameCount(range, compFps, outFps)
  const step = compFps / outFps
  const passes = Math.max(1, Math.floor(repeat))
  const once = Array.from({ length: count }, (_, i) => snapWhole(range.start + i * step))
  if (passes === 1) return once
  const out: number[] = []
  for (let p = 0; p < passes; p++) out.push(...once)
  return out
}

/** Evenly spaced indices into `count` items (for palette sampling and size estimates). */
export function spreadIndices(count: number, samples: number): number[] {
  if (count <= 0 || samples <= 0) return []
  const n = Math.min(count, Math.floor(samples))
  if (n === 1) return [0]
  const out = new Set<number>()
  for (let i = 0; i < n; i++) out.add(Math.round((i * (count - 1)) / (n - 1)))
  return [...out]
}

/* -------------------------------------------------------------------------- */
/*                                    Sizes                                   */
/* -------------------------------------------------------------------------- */

/**
 * - scale presets (`0.5x` … `4x`) multiply the animation size;
 * - resolution presets (`720p`, `1080p`, `4k`) scale so the SHORT side is 720 / 1080 / 2160 px
 *   (a square animation becomes 1080 × 1080, a portrait one 1080 × 1920), keeping the aspect;
 * - `custom` uses the given width and height; a different aspect letterboxes the animation.
 */
export type SizePreset = '0.5x' | '1x' | '2x' | '3x' | '4x' | '720p' | '1080p' | '4k' | 'custom'

export interface SizeSpec {
  preset: SizePreset
  /** Used by `custom`. */
  width: number
  height: number
}

export interface ResolvedSize {
  width: number
  height: number
  /** True when the size was reduced to stay within the limits (or made even). */
  adjusted: boolean
}

/** Largest canvas side we render (browsers allow more, encoders and memory do not). */
export const MAX_SIDE = 8192
/** Largest canvas area (Safari's limit for a 2D canvas is 16,777,216 pixels). */
export const MAX_AREA = 16_777_216

const SCALE: Partial<Record<SizePreset, number>> = {
  '0.5x': 0.5,
  '1x': 1,
  '2x': 2,
  '3x': 3,
  '4x': 4,
}
const SHORT_SIDE: Partial<Record<SizePreset, number>> = { '720p': 720, '1080p': 1080, '4k': 2160 }

/** Scale factor of a preset for an animation of size `w × h` (null for custom sizes). */
export function presetScale(preset: SizePreset, w: number, h: number): number | null {
  const scale = SCALE[preset]
  if (scale !== undefined) return scale
  const short = SHORT_SIDE[preset]
  if (short !== undefined) return short / Math.max(1, Math.min(w, h))
  return null
}

/**
 * Output size in pixels. `even` rounds both sides down to even numbers (H.264 and most video
 * encoders require it for 4:2:0 chroma).
 */
export function resolveSize(
  doc: Pick<Animation, 'w' | 'h'>,
  spec: SizeSpec,
  opts: { even?: boolean } = {},
): ResolvedSize {
  const w0 = doc.w > 0 ? doc.w : 512
  const h0 = doc.h > 0 ? doc.h : 512
  const scale = presetScale(spec.preset, w0, h0)
  let width = scale === null ? spec.width : w0 * scale
  let height = scale === null ? spec.height : h0 * scale
  width = Number.isFinite(width) && width > 0 ? width : w0
  height = Number.isFinite(height) && height > 0 ? height : h0
  let adjusted = false
  // Keep the aspect when shrinking to the limits.
  const fit = Math.min(
    1,
    MAX_SIDE / width,
    MAX_SIDE / height,
    Math.sqrt(MAX_AREA / (width * height)),
  )
  if (fit < 1) {
    width *= fit
    height *= fit
    adjusted = true
  }
  let w = Math.max(1, Math.round(width))
  let h = Math.max(1, Math.round(height))
  if (fit < 1) {
    // Rounding up could cross the limit again.
    w = Math.min(w, Math.floor(width))
    h = Math.min(h, Math.floor(height))
  }
  if (opts.even) {
    const ew = Math.max(2, w - (w % 2))
    const eh = Math.max(2, h - (h % 2))
    if (ew !== w || eh !== h) adjusted = true
    w = ew
    h = eh
  }
  return { width: Math.max(1, w), height: Math.max(1, h), adjusted }
}

/* -------------------------------------------------------------------------- */
/*                                     GIF                                    */
/* -------------------------------------------------------------------------- */

/**
 * GIF frame delays are whole centiseconds, and browsers treat delays below 2 cs as 10 cs, so
 * 50 fps is the fastest a GIF can play.
 */
export const GIF_MAX_FPS = 50

/** Frame rate a GIF can actually play at. */
export function gifFps(fps: number): number {
  return Math.min(GIF_MAX_FPS, Math.max(1, fps))
}

/**
 * Delay of each GIF frame in centiseconds. Delays are rounded against the running total, so
 * the duration stays exact: 30 fps becomes 3, 4, 3, 3, 4, 3 … (10 cs per 3 frames).
 */
export function gifDelays(frameCount: number, fps: number): number[] {
  const rate = gifFps(fps)
  const out: number[] = []
  let previous = 0
  for (let i = 1; i <= frameCount; i++) {
    const total = Math.round((i * 100) / rate)
    out.push(Math.max(2, total - previous))
    previous = total
  }
  return out
}

/**
 * GIF loop setting as gifenc expects it: -1 plays once (no loop extension), 0 loops forever,
 * n > 0 repeats n more times. `plays` is the total number of times the animation plays
 * (0 = forever).
 */
export function gifRepeat(plays: number): number {
  if (!(plays > 0)) return 0
  return plays <= 1 ? -1 : Math.min(65535, Math.round(plays) - 1)
}

/* -------------------------------------------------------------------------- */
/*                                  File names                                */
/* -------------------------------------------------------------------------- */

/** Zero-padded frame file name: ("bounce", 7, 120) → "bounce_0007.png". */
export function frameFileName(base: string, index: number, count: number, ext = 'png'): string {
  const digits = Math.max(4, String(Math.max(0, count - 1)).length)
  return `${base}_${String(index).padStart(digits, '0')}.${ext}`
}

/* -------------------------------------------------------------------------- */
/*                                  Estimates                                 */
/* -------------------------------------------------------------------------- */

/** Rendering time an estimate may spend (heavy animations get fewer samples). */
export const ESTIMATE_BUDGET_MS = 1200

/**
 * How many samples of `framesPerSample` frames fit in the budget, given how long the first
 * frame took to render: at least one, at most `max`.
 */
export function samplesWithinBudget(
  firstFrameMs: number,
  framesPerSample: number,
  max: number,
  budgetMs = ESTIMATE_BUDGET_MS,
): number {
  const perSample = Math.max(1, firstFrameMs) * Math.max(1, framesPerSample)
  return Math.max(1, Math.min(Math.floor(max), Math.floor(budgetMs / perSample)))
}

/** Seconds between key frames in exported videos (players seek to key frames). */
export const KEY_FRAME_INTERVAL_S = 2
