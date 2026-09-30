/**
 * Progress and time-left estimation for long exports.
 *
 * The estimate blends the average time per frame over the whole run (stable) with a moving
 * average of the recent frames (reacts when the animation gets heavier or lighter). It stays
 * unknown until a few frames are done, so the first frames (image decoding, JIT warm-up) do
 * not produce a wild guess.
 */

export type ExportPhase = 'preparing' | 'rendering' | 'finishing'

export interface ProgressInfo {
  phase: ExportPhase
  done: number
  total: number
  /** 0..1 */
  fraction: number
  /** Whole seconds left, null while unknown. */
  secondsLeft: number | null
}

const MIN_FRAMES = 3
const MIN_ELAPSED_MS = 400

export class ProgressClock {
  private readonly total: number
  private readonly startedAt: number
  private lastTime: number
  private lastDone = 0
  private recent: number | null = null

  constructor(total: number, now: number) {
    this.total = Math.max(1, total)
    this.startedAt = now
    this.lastTime = now
  }

  /** Records that `done` frames are finished at time `now` (ms) and returns the snapshot. */
  tick(done: number, now: number, phase: ExportPhase = 'rendering'): ProgressInfo {
    const clamped = Math.min(this.total, Math.max(0, done))
    if (clamped > this.lastDone) {
      const perFrame = (now - this.lastTime) / (clamped - this.lastDone)
      this.recent = this.recent === null ? perFrame : this.recent * 0.8 + perFrame * 0.2
      this.lastDone = clamped
      this.lastTime = now
    }
    const elapsed = now - this.startedAt
    let secondsLeft: number | null = null
    if (clamped >= MIN_FRAMES && elapsed >= MIN_ELAPSED_MS && this.recent !== null) {
      const average = elapsed / clamped
      const perFrame = average * 0.5 + this.recent * 0.5
      secondsLeft = Math.max(0, Math.ceil(((this.total - clamped) * perFrame) / 1000))
    }
    return { phase, done: clamped, total: this.total, fraction: clamped / this.total, secondsLeft }
  }
}

/** Snapshot for phases without frame counts (preparing, finishing). */
export function phaseProgress(phase: ExportPhase, total: number, done = 0): ProgressInfo {
  const t = Math.max(1, total)
  const d = Math.min(t, Math.max(0, done))
  return { phase, done: d, total: t, fraction: d / t, secondsLeft: null }
}
