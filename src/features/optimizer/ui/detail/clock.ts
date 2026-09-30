/**
 * Shared playhead of the comparison: both players show the same frame. Playback runs on
 * requestAnimationFrame at the animation's frame rate; listeners are called on every change
 * (players and the transport write to the DOM directly, nothing re-renders per frame).
 */
export interface FrameRange {
  ip: number
  op: number
  fps: number
}

type Listener = (frame: number, playing: boolean) => void

export class FrameClock {
  private range: FrameRange = { ip: 0, op: 1, fps: 30 }
  private current = 0
  private playingNow = false
  private raf = 0
  private startedAt = 0
  private startFrame = 0
  private readonly listeners = new Set<Listener>()

  get frame(): number {
    return this.current
  }

  get playing(): boolean {
    return this.playingNow
  }

  get bounds(): FrameRange {
    return this.range
  }

  /** Last frame that can be shown (the out point is exclusive). */
  get last(): number {
    return Math.max(this.range.ip, this.range.op - 1)
  }

  setRange(range: FrameRange): void {
    const fps = range.fps > 0 ? range.fps : 30
    const op = range.op > range.ip ? range.op : range.ip + 1
    this.range = { ip: range.ip, op, fps }
    this.seek(Math.min(Math.max(this.current, range.ip), this.last))
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.current, this.playingNow)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l(this.current, this.playingNow)
  }

  /** Shows a frame (clamped); keeps playing from there when playing. */
  seek(frame: number): void {
    this.current = Math.min(Math.max(frame, this.range.ip), this.last)
    if (this.playingNow) {
      this.startedAt = performance.now()
      this.startFrame = this.current
    }
    this.emit()
  }

  step(delta: number): void {
    this.pause()
    this.seek(Math.round(this.current) + delta)
  }

  play(): void {
    if (this.playingNow) return
    this.playingNow = true
    // At the end, start over.
    if (this.current >= this.last) this.current = this.range.ip
    this.startedAt = performance.now()
    this.startFrame = this.current
    this.emit()
    this.raf = requestAnimationFrame(this.tick)
  }

  pause(): void {
    if (!this.playingNow) return
    this.playingNow = false
    cancelAnimationFrame(this.raf)
    this.emit()
  }

  toggle(): void {
    if (this.playingNow) this.pause()
    else this.play()
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.playingNow = false
    this.listeners.clear()
  }

  private tick = (now: number): void => {
    if (!this.playingNow) return
    const { ip, op, fps } = this.range
    const span = op - ip
    const advanced = ((now - this.startedAt) * fps) / 1000
    let frame = this.startFrame + advanced
    if (frame >= op) frame = ip + ((frame - ip) % span)
    this.current = frame
    this.emit()
    this.raf = requestAnimationFrame(this.tick)
  }
}
