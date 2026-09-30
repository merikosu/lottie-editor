/**
 * Playback state and clock.
 *
 * The editor drives rendering itself (instead of lottie-web's internal playback) so that
 * every view — canvas, compare view, timeline, inspector — shows the same frame.
 * `frame` is an absolute frame of the root composition (ip ≤ frame < op). While playing it
 * advances continuously (sub-frames); when paused it is snapped to an integer.
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { clampFrame, lastFrame } from '@/lottie/time'
import { useDocument } from './document'

export interface WorkArea {
  start: number
  /** Exclusive end frame. */
  end: number
}

/** loop: repeat; once: stop at the end; bounce: ping-pong between start and end. */
export type PlayMode = 'loop' | 'once' | 'bounce'

export interface PlaybackState {
  frame: number
  playing: boolean
  mode: PlayMode
  /** Current direction while bouncing (1 forward, -1 backward). */
  direction: 1 | -1
  /** Preview speed (not saved in the file). */
  speed: number
  /** Optional play range (like After Effects' work area). */
  workArea: WorkArea | null
}

export const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const

export const usePlayback = create<PlaybackState>()(
  subscribeWithSelector((): PlaybackState => ({
    frame: 0,
    playing: false,
    mode: 'loop',
    direction: 1,
    speed: 1,
    workArea: null,
  })),
)

/** Reactive integer frame (re-renders once per displayed frame, not per sub-frame). */
export function useIntegerFrame(): number {
  return usePlayback((s) => Math.floor(s.frame + 1e-6))
}

/** Reactive current frame (including sub-frames while playing). */
export function useFrame(): number {
  return usePlayback((s) => s.frame)
}

/**
 * Subscribes to frame changes outside React rendering (for 60fps DOM updates such as the
 * playhead). Returns an unsubscribe function.
 */
export function subscribeFrame(cb: (frame: number) => void): () => void {
  cb(usePlayback.getState().frame)
  return usePlayback.subscribe((s) => s.frame, cb)
}

/* -------------------------------------------------------------------------- */
/*                                    Range                                   */
/* -------------------------------------------------------------------------- */

/** Effective play range [start, end) in frames (work area, or the whole animation). */
export function playRange(): WorkArea {
  const doc = useDocument.getState().doc
  if (!doc) return { start: 0, end: 1 }
  const wa = usePlayback.getState().workArea
  if (wa && wa.end > wa.start) {
    return { start: Math.max(doc.ip, wa.start), end: Math.min(doc.op, wa.end) }
  }
  return { start: doc.ip, end: doc.op }
}

/* -------------------------------------------------------------------------- */
/*                                    Clock                                   */
/* -------------------------------------------------------------------------- */

let rafId = 0
let lastTime = 0

function tick(now: number) {
  const s = usePlayback.getState()
  const doc = useDocument.getState().doc
  if (!s.playing || !doc) {
    rafId = 0
    return
  }
  const dt = Math.min(now - lastTime, 250) // avoid huge jumps after tab switches
  lastTime = now
  const { start, end } = playRange()
  const last = Math.max(start, Math.ceil(end) - 1)
  const length = end - start
  let direction = s.direction
  let frame = s.frame + (dt / 1000) * doc.fr * s.speed * (s.mode === 'bounce' ? direction : 1)

  if (s.mode === 'bounce') {
    if (frame >= last) {
      frame = last - (frame - last)
      direction = -1
    } else if (frame <= start) {
      frame = start + (start - frame)
      direction = 1
    }
    frame = Math.min(Math.max(frame, start), last)
  } else if (frame >= end || frame < start) {
    if (s.mode === 'loop' && length > 0) {
      frame = start + ((((frame - start) % length) + length) % length)
    } else {
      usePlayback.setState({ frame: last, playing: false })
      rafId = 0
      return
    }
  }
  usePlayback.setState({ frame, direction })
  rafId = requestAnimationFrame(tick)
}

export function play(): void {
  const doc = useDocument.getState().doc
  if (!doc) return
  const s = usePlayback.getState()
  if (s.playing) return
  const { start, end } = playRange()
  // Restart from the beginning when at the end (or outside the range).
  let frame = s.frame
  if ((s.mode !== 'bounce' && frame >= Math.ceil(end) - 1) || frame < start || frame > end)
    frame = start
  usePlayback.setState({ playing: true, frame, direction: 1 })
  lastTime = performance.now()
  if (!rafId) rafId = requestAnimationFrame(tick)
}

export function pause(): void {
  const s = usePlayback.getState()
  if (!s.playing) return
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  usePlayback.setState({ playing: false, frame: Math.round(s.frame) })
}

export function togglePlay(): void {
  if (usePlayback.getState().playing) pause()
  else play()
}

/* -------------------------------------------------------------------------- */
/*                                  Seeking                                   */
/* -------------------------------------------------------------------------- */

/** Moves the playhead (pauses playback). The frame is clamped to [ip, op - 1]. */
export function setFrame(
  frame: number,
  opts: { keepPlaying?: boolean; allowSubframe?: boolean } = {},
): void {
  const doc = useDocument.getState().doc
  if (!doc) return
  if (!opts.keepPlaying) pause()
  const f = opts.allowSubframe ? frame : Math.round(frame)
  usePlayback.setState({ frame: clampFrame(doc, f) })
}

export function stepFrames(delta: number): void {
  const doc = useDocument.getState().doc
  if (!doc) return
  pause()
  const { frame } = usePlayback.getState()
  usePlayback.setState({ frame: clampFrame(doc, Math.round(frame) + delta) })
}

export function goToStart(): void {
  setFrame(playRange().start)
}

export function goToEnd(): void {
  const { end } = playRange()
  setFrame(Math.ceil(end) - 1)
}

export function setSpeed(speed: number): void {
  usePlayback.setState({ speed: Math.min(16, Math.max(0.05, speed)) })
}

export function setPlayMode(mode: PlayMode): void {
  usePlayback.setState({ mode, direction: 1 })
}

/** Cycles loop → once → bounce. */
export function cyclePlayMode(): void {
  const order: PlayMode[] = ['loop', 'once', 'bounce']
  const { mode } = usePlayback.getState()
  setPlayMode(order[(order.indexOf(mode) + 1) % order.length])
}

export function setWorkArea(workArea: WorkArea | null): void {
  usePlayback.setState({ workArea })
}

/** Sets the work area start at the playhead (keeps the end). */
export function setWorkAreaStart(frame = Math.round(usePlayback.getState().frame)): void {
  const doc = useDocument.getState().doc
  if (!doc) return
  const end = usePlayback.getState().workArea?.end ?? doc.op
  usePlayback.setState({ workArea: { start: Math.min(frame, end - 1), end } })
}

/** Sets the work area end at the playhead (inclusive frame → exclusive end). */
export function setWorkAreaEnd(frame = Math.round(usePlayback.getState().frame)): void {
  const doc = useDocument.getState().doc
  if (!doc) return
  const start = usePlayback.getState().workArea?.start ?? doc.ip
  usePlayback.setState({ workArea: { start, end: Math.max(frame + 1, start + 1) } })
}

export function goToWorkAreaStart(): void {
  setFrame(playRange().start)
}

export function goToWorkAreaEnd(): void {
  setFrame(Math.ceil(playRange().end) - 1)
}

/* -------------------------------------------------------------------------- */
/*                         Keep in sync with the document                     */
/* -------------------------------------------------------------------------- */

// New document → reset playback. Range changes (trim, fps) → clamp the playhead.
useDocument.subscribe(
  (s) => s.meta?.id,
  () => {
    pause()
    const doc = useDocument.getState().doc
    usePlayback.setState({ frame: doc ? doc.ip : 0, workArea: null })
  },
)

useDocument.subscribe(
  (s) => (s.doc ? `${s.doc.ip}:${s.doc.op}` : ''),
  () => {
    const doc = useDocument.getState().doc
    if (!doc) return
    const { frame, workArea } = usePlayback.getState()
    const next: Partial<PlaybackState> = {}
    if (frame < doc.ip || frame > lastFrame(doc)) next.frame = clampFrame(doc, frame)
    if (workArea && (workArea.start >= doc.op || workArea.end <= doc.ip)) next.workArea = null
    if (Object.keys(next).length) usePlayback.setState(next)
  },
)
