/**
 * Pure planning helpers shared by previews and the actions that apply them, so what a dialog
 * shows is exactly what gets applied.
 */
import { planFrameRate } from '@/lottie/timing'
import type { Animation } from '@/lottie/types'

/** Outcome of the "Speed & frame rate" dialog, computed the same way for its preview and apply. */
export interface TimingPlan {
  fps: number
  keepDuration: boolean
  /** Root range after the frame rate change alone (see changeFrameRate). */
  base: { ip: number; op: number }
  /** Frames after the whole change. */
  frames: number
  /** How much faster the content plays afterwards (1 = unchanged). */
  speedFactor: number
}

/**
 * Timing after changing the frame rate and then retiming the result by `relative` (the speed
 * change asked for on top; 1 = none). Keeping the duration retimes the content exactly: only
 * the out point is rounded to a whole frame, which changes the length a little but not the
 * speed. Without it the same frames play at the new rate.
 */
export function planTiming(
  doc: Pick<Animation, 'fr' | 'ip' | 'op'>,
  fps: number,
  keepDuration: boolean,
  relative: number,
): TimingPlan {
  const base = planFrameRate(doc, fps, keepDuration)
  const baseFrames = base.op - base.ip
  const frames = Math.max(1, Math.round(baseFrames / (relative > 0 ? relative : 1)))
  const fpsFactor = keepDuration ? 1 : fps / doc.fr
  return { fps, keepDuration, base, frames, speedFactor: fpsFactor * (baseFrames / frames) }
}
