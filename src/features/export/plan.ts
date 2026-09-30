/**
 * What a rendered export will produce with the current options: range, frame rate, frame
 * count, pixel size and background. Shared by the dialog (summary, preview) and the runner.
 */
import {
  GIF_MAX_FPS,
  outputFrameCount,
  rangeSeconds,
  resolveRange,
  resolveSize,
  sampleTimes,
  type FrameRange,
  type ResolvedSize,
  type SizePreset,
} from '@/export/plan'
import type { Animation } from '@/lottie/types'
import type { WorkArea } from '@/store/playback'
import type { ExportPrefs, FpsChoice, FramePrefs, SizeOptions } from './store'

export type RasterFormat = 'gif' | 'mp4' | 'webm' | 'png'
export type FrameFormat = 'framePng' | 'frameSvg'

export function isRasterFormat(format: string): format is RasterFormat {
  return format === 'gif' || format === 'mp4' || format === 'webm' || format === 'png'
}

export function isFrameFormat(format: string): format is FrameFormat {
  return format === 'framePng' || format === 'frameSvg'
}

export interface RasterPlan {
  range: FrameRange
  compFps: number
  /** Output frame rate. */
  fps: number
  /** The GIF limit lowered the chosen frame rate. */
  fpsCapped: boolean
  /** Frames of one pass over the range. */
  frames: number
  /** Plays in a row (video repeat). */
  passes: number
  totalFrames: number
  /** Seconds of one pass. */
  seconds: number
  totalSeconds: number
  size: ResolvedSize
  /** CSS color under the animation, or null for transparency. */
  background: string | null
}

/** Size presets offered per format. */
export const SIZE_PRESETS: Record<RasterFormat | FrameFormat, SizePreset[]> = {
  gif: ['0.5x', '1x', '2x', 'custom'],
  mp4: ['1x', '2x', '720p', '1080p', '4k', 'custom'],
  webm: ['1x', '2x', '720p', '1080p', '4k', 'custom'],
  png: ['0.5x', '1x', '2x', '3x', '4x', 'custom'],
  framePng: ['0.5x', '1x', '2x', '3x', '4x', 'custom'],
  frameSvg: ['1x', '2x', '3x', '4x', 'custom'],
}

/** Frame rate choices per format ('source' first). */
export const FPS_CHOICES: Record<RasterFormat, FpsChoice[]> = {
  gif: ['source', '50', '30', '25', '24', '20', '15', '12', '10'],
  mp4: ['source', '24', '25', '30', '50', '60'],
  webm: ['source', '24', '25', '30', '50', '60'],
  png: ['source', '60', '30', '25', '24', '15', '12'],
}

export function fpsValue(choice: FpsChoice, docFps: number): number {
  const fps = choice === 'source' ? docFps : Number(choice)
  return Number.isFinite(fps) && fps > 0 ? fps : docFps > 0 ? docFps : 30
}

function sizeSpec(options: SizeOptions, allowed: SizePreset[]) {
  const preset = allowed.includes(options.preset) ? options.preset : '1x'
  return { preset, width: options.width, height: options.height }
}

export function planRaster(
  format: RasterFormat,
  doc: Animation,
  prefs: ExportPrefs,
  workArea: WorkArea | null,
): RasterPlan {
  const p = prefs[format]
  const range = resolveRange(doc, workArea, p.range)
  const compFps = doc.fr > 0 ? doc.fr : 30
  const chosen = fpsValue(p.fps, compFps)
  const fps = format === 'gif' ? Math.min(GIF_MAX_FPS, chosen) : chosen
  const frames = outputFrameCount(range, compFps, fps)
  const video = format === 'mp4' || format === 'webm'
  const passes = video ? Math.max(1, Math.min(100, Math.round(prefs[format].repeat))) : 1
  const seconds = rangeSeconds(range, compFps)
  let background: string | null
  if (format === 'mp4') background = prefs.mp4.color
  else if (format === 'webm') background = prefs.webm.transparent ? null : prefs.webm.color
  else if (format === 'gif') background = prefs.gif.background === 'color' ? prefs.gif.color : null
  else background = prefs.png.background === 'color' ? prefs.png.color : null
  return {
    range,
    compFps,
    fps,
    fpsCapped: fps < chosen,
    frames,
    passes,
    totalFrames: frames * passes,
    seconds,
    totalSeconds: seconds * passes,
    size: resolveSize(doc, sizeSpec(p.size, SIZE_PRESETS[format]), { even: video }),
    background,
  }
}

/** Composition frame of every output frame. */
export function planTimes(plan: RasterPlan): number[] {
  return sampleTimes(plan.range, plan.compFps, plan.fps, plan.passes)
}

export interface FramePlan {
  size: ResolvedSize
  background: string | null
}

export function planFrame(format: FrameFormat, doc: Animation, prefs: FramePrefs): FramePlan {
  return {
    size: resolveSize(doc, sizeSpec(prefs.size, SIZE_PRESETS[format])),
    background: prefs.background === 'color' ? prefs.color : null,
  }
}
