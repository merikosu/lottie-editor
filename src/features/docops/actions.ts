/**
 * Document operations as user actions: each one is a single undo step with a translated
 * label, keeps the playhead and work area on the same moment of the animation, and reports
 * its result inline (toasts are reserved for failures).
 */
import { toast } from '@/components/ui'
import { getT } from '@/i18n'
import { nextTick } from '@/lib/timing'
import {
  boundsFrames,
  createBoundsSampler,
  fitCanvasToContent,
  pathAfterPrecompose,
  planFit,
  resizeCanvas,
  type Anchor,
  type Rect,
  type ResizeMode,
  type ResizeResult,
} from '@/lottie/canvas'
import {
  changeFrameRate,
  extendEnd,
  framesForDuration,
  framesForSpeed,
  pingPong,
  reverseAnimation,
  setFrameCount,
  trimToRange,
  type HoldResult,
} from '@/lottie/timing'
import type { Animation } from '@/lottie/types'
import {
  getDoc,
  updateDoc,
  useDocument,
  type Selection,
  type UpdateOptions,
} from '@/store/document'
import { usePlayback, type WorkArea } from '@/store/playback'
import { formatPercent, formatSeconds, formatSize, timingSummary } from './format'
import { planTiming } from './plan'
import {
  followTimeEdit,
  recordSpeedChange,
  setBusy,
  showResult,
  speedOf,
  useDocopsPrefs,
  useDocopsState,
  type PlaybackPlace,
} from './store'

/** Options of the actions driven by editing controls. */
export interface ActionOptions {
  /**
   * Gesture key of the control (repeated arrow-key nudges share one): consecutive changes
   * with the same key merge into one undo step.
   */
  coalesceKey?: string
  /** The gesture's `final` flag (see UpdateOptions): false while it is still in progress. */
  final?: boolean
}

/** History options of an action driven by a control gesture. */
function gestureOptions(opts: ActionOptions): UpdateOptions {
  return opts.coalesceKey ? { coalesceKey: opts.coalesceKey, final: opts.final ?? true } : {}
}

/** Runs `recipe` as one undo step. Unexpected failures are reported, never thrown. */
function commit(label: string, recipe: (draft: Animation) => void, opts?: UpdateOptions): boolean {
  try {
    return updateDoc(label, (draft) => recipe(draft as Animation), opts)
  } catch (err) {
    console.error(`[docops] ${label} failed`, err)
    toast.error(getT().docops.errors.failed, {
      description: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Playhead                                  */
/* -------------------------------------------------------------------------- */

/**
 * Playback state to move after an edit. It must be read BEFORE committing: as soon as the
 * document range changes, the playback store clamps the playhead and may drop the work area.
 */
function snapshotPlayback(): PlaybackPlace {
  const { frame, workArea } = usePlayback.getState()
  return { frame, workArea }
}

function showTiming(prefix?: string): void {
  const t = getT()
  const doc = getDoc()
  if (!doc) return
  const summary = timingSummary(t, doc)
  showResult('timing', prefix ? `${prefix} · ${summary}` : summary)
}

/* -------------------------------------------------------------------------- */
/*                                   Timing                                   */
/* -------------------------------------------------------------------------- */

/** Retimes to `frames` frames from the in point. `speedFactor` defaults to the inverse stretch. */
function retimeTo(
  frames: number,
  label: string,
  opts: ActionOptions,
  speedFactor?: number,
): boolean {
  const doc = getDoc()
  if (!doc) return false
  const before = doc.op - doc.ip
  const playback = snapshotPlayback()
  if (!commit(label, (d) => setFrameCount(d, frames), gestureOptions(opts))) return false
  const scale = frames / before
  recordSpeedChange(speedFactor ?? 1 / scale)
  followTimeEdit(playback, { a: scale, b: doc.ip * (1 - scale) })
  showTiming()
  return true
}

/** Sets the baked speed, relative to the file as opened (1 = original speed). */
export function applySpeed(speed: number, opts: ActionOptions = {}): boolean {
  const doc = getDoc()
  if (!doc || !(speed > 0) || !Number.isFinite(speed)) return false
  const current = speedOf()
  const factor = speed / current
  if (Math.abs(factor - 1) < 1e-6) return false
  // Frames at the original speed: rounding never accumulates over repeated changes.
  const base = { ip: 0, op: (doc.op - doc.ip) * current }
  const frames = framesForSpeed(base, speed)
  if (frames === doc.op - doc.ip) return false
  return retimeTo(frames, getT().docops.history.speed, opts, factor)
}

/** Multiplies the current speed (×2 = twice as fast). */
export function multiplySpeed(multiplier: number): boolean {
  return applySpeed(speedOf() * multiplier)
}

/** Stretches the animation to last `seconds`. */
export function applyDuration(seconds: number, opts: ActionOptions = {}): boolean {
  const doc = getDoc()
  if (!doc || !(seconds > 0) || !Number.isFinite(seconds)) return false
  const frames = framesForDuration(doc, seconds)
  if (frames === doc.op - doc.ip) return false
  return retimeTo(frames, getT().docops.history.duration, opts)
}

export function applyFrameRate(
  fps: number,
  keepDuration: boolean,
  opts: ActionOptions = {},
): boolean {
  const doc = getDoc()
  if (!doc || !(fps > 0) || !Number.isFinite(fps) || Math.abs(fps - doc.fr) < 1e-9) return false
  const playback = snapshotPlayback()
  const label = getT().docops.history.frameRate
  if (!commit(label, (d) => changeFrameRate(d, fps, { keepDuration }), gestureOptions(opts)))
    return false
  const ratio = fps / doc.fr
  if (keepDuration) followTimeEdit(playback, { a: ratio, b: 0 })
  else recordSpeedChange(ratio)
  showTiming()
  return true
}

/**
 * Applies the "Speed & frame rate" dialog (see planTiming): frame rate first, then the retime.
 * One undo step; the speed change is recorded for the Speed field.
 */
export function applyTiming(fps: number, keepDuration: boolean, relative: number): boolean {
  const doc = getDoc()
  if (!doc || !(fps > 0) || !Number.isFinite(fps) || !(relative > 0)) return false
  const t = getT()
  const plan = planTiming(doc, fps, keepDuration, relative)
  const fpsChanged = Math.abs(fps - doc.fr) > 1e-9
  const retimed = plan.frames !== plan.base.op - plan.base.ip
  if (!fpsChanged && !retimed) return false
  const label =
    fpsChanged && retimed
      ? t.docops.history.timing
      : fpsChanged
        ? t.docops.history.frameRate
        : t.docops.history.speed
  const playback = snapshotPlayback()
  const ok = commit(label, (d) => {
    changeFrameRate(d, fps, { keepDuration })
    setFrameCount(d, plan.frames)
  })
  if (!ok) return false
  recordSpeedChange(plan.speedFactor)
  // Frame f → f · ratio (frame rate), then scaled around the in point (retime).
  const ratio = keepDuration ? fps / doc.fr : 1
  const scale = plan.frames / (plan.base.op - plan.base.ip)
  followTimeEdit(playback, { a: ratio * scale, b: plan.base.ip * (1 - scale) })
  showTiming()
  return true
}

/** Sets the root in point (non-destructive). */
export function applyInPoint(frame: number, opts: ActionOptions = {}): boolean {
  const doc = getDoc()
  if (!doc || !Number.isFinite(frame)) return false
  const ip = Math.round(frame)
  if (!(ip < doc.op) || ip === doc.ip) return false
  return commit(
    getT().docops.history.inPoint,
    (d) => {
      d.ip = ip
    },
    gestureOptions(opts),
  )
}

/** Sets the root out point (non-destructive). */
export function applyOutPoint(frame: number, opts: ActionOptions = {}): boolean {
  const doc = getDoc()
  if (!doc || !Number.isFinite(frame)) return false
  const op = Math.round(frame)
  if (!(op > doc.ip) || op === doc.op) return false
  return commit(
    getT().docops.history.outPoint,
    (d) => {
      d.op = op
    },
    gestureOptions(opts),
  )
}

/** Part of the root range a work area keeps, or null when trimming would change nothing. */
export function trimRangeOf(
  range: { ip: number; op: number },
  workArea: WorkArea | null,
): { start: number; end: number } | null {
  if (!workArea) return null
  const start = Math.max(range.ip, Math.round(workArea.start))
  const end = Math.min(range.op, Math.round(workArea.end))
  if (!(end > start) || (start === range.ip && end === range.op)) return null
  return { start, end }
}

/** Range "Trim to work area" would keep right now. */
export function trimRange(): { start: number; end: number } | null {
  const doc = getDoc()
  return doc ? trimRangeOf(doc, usePlayback.getState().workArea) : null
}

export function trimToWorkArea(): boolean {
  const range = trimRange()
  if (!range) return false
  const { start, end } = range
  const playback = snapshotPlayback()
  if (
    !commit(getT().docops.history.trim, (d) =>
      trimToRange(d, start, end, { shiftToZero: true, clipMarkers: true }),
    )
  )
    return false
  // The work area is now the whole animation (undo brings it back).
  followTimeEdit(playback, { a: 1, b: -start }, { consumesWorkArea: true })
  showTiming(getT().docops.results.trimmed)
  return true
}

/** The current selection without keyframes (for edits that renumber or rewrite keyframes). */
function withoutKeyframes(): Selection {
  return { ...useDocument.getState().selection, keyframes: [] }
}

export function reverse(): boolean {
  const doc = getDoc()
  if (!doc) return false
  const pivot = doc.ip + doc.op
  const playback = snapshotPlayback()
  // Keyframe indices change meaning once reversed: drop the keyframe selection.
  if (!commit(getT().docops.history.reverse, reverseAnimation, { selection: withoutKeyframes() }))
    return false
  followTimeEdit(playback, { a: -1, b: pivot })
  showTiming(getT().docops.results.reversed)
  return true
}

export function addPause(seconds: number): boolean {
  const t = getT()
  if (!(seconds > 0) || !Number.isFinite(seconds)) return false
  let result: HoldResult | null = null
  const ok = commit(
    t.docops.history.pause,
    (d) => {
      result = extendEnd(d, seconds)
    },
    // Keyframes after the end are cut or merged: the selected indices would drift.
    { selection: withoutKeyframes() },
  )
  if (!ok) return false
  const held = result as HoldResult | null
  const parts = [t.docops.results.pause(formatSeconds(t, seconds))]
  if (held && held.remappedLayers > 0)
    parts.push(t.docops.results.frozenPrecomps(held.remappedLayers))
  showTiming(parts.join(' · '))
  return true
}

function precomposedSelection(selection: Selection, assetIndex: number): Selection {
  return {
    nodes: selection.nodes.map((p) => pathAfterPrecompose(p, assetIndex)),
    keyframes: selection.keyframes.map((k) => ({
      ...k,
      path: pathAfterPrecompose(k.path, assetIndex),
    })),
    property: selection.property ? pathAfterPrecompose(selection.property, assetIndex) : null,
  }
}

export function bakePingPong(): boolean {
  const t = getT()
  const selection = useDocument.getState().selection
  let assetIndex = -1
  const ok = commit(
    t.docops.history.pingPong,
    (d) => {
      assetIndex = pingPong(d, { name: t.docops.timing.pingPong }).assetIndex
    },
    // The layers moved into a precomp: keep the selection on the same nodes.
    {
      selection: () => (assetIndex >= 0 ? precomposedSelection(selection, assetIndex) : selection),
    },
  )
  if (!ok) return false
  showTiming(t.docops.results.pingPong)
  return true
}

/* -------------------------------------------------------------------------- */
/*                                   Canvas                                   */
/* -------------------------------------------------------------------------- */

export function resize(width: number, height: number, mode: ResizeMode, anchor: Anchor): boolean {
  const t = getT()
  const doc = getDoc()
  if (!doc || !(width > 0) || !(height > 0)) return false
  const selection = useDocument.getState().selection
  let result: ResizeResult | null = null
  const ok = commit(
    mode === 'scale' ? t.docops.history.scale : t.docops.history.resize,
    (d) => {
      result = resizeCanvas(d, width, height, {
        mode,
        anchor,
        name: t.docops.canvas.scaledContentName,
      })
    },
    {
      selection: () => {
        const index = (result as ResizeResult | null)?.precompAssetIndex
        return index === null || index === undefined
          ? selection
          : precomposedSelection(selection, index)
      },
    },
  )
  if (!ok) return false
  const done = result as ResizeResult | null
  const size = formatSize(Math.round(width), Math.round(height))
  if (done && done.mode === 'scale' && Math.abs(done.scale - 1) > 1e-9)
    showResult('canvas', t.docops.results.scaled(formatPercent(done.scale), size))
  else showResult('canvas', t.docops.results.resized(size))
  return true
}

/** Measures the visible content over the animation without blocking the UI for long. */
export async function measureContent(
  doc: Animation,
  isCancelled: () => boolean = () => false,
): Promise<Rect | null> {
  const sampler = createBoundsSampler(doc)
  let slice = performance.now()
  for (const frame of boundsFrames(doc, 1_500_000)) {
    sampler.sample(frame)
    if (performance.now() - slice > 16) {
      await nextTick()
      if (isCancelled()) return null
      slice = performance.now()
    }
  }
  return sampler.bounds()
}

/** Measuring restarts when the document is edited meanwhile, at most this many times. */
const MEASURE_ATTEMPTS = 3

export async function fitToContent(): Promise<boolean> {
  const t = getT()
  if (!getDoc() || useDocopsState.getState().busy) return false
  const { fitPadding, fitIncludeOffCanvas } = useDocopsPrefs.getState()
  const opts = { padding: fitPadding, clipToCanvas: !fitIncludeOffCanvas }
  setBusy('fit')
  try {
    for (let attempt = 0; attempt < MEASURE_ATTEMPTS; attempt++) {
      const doc = getDoc()
      if (!doc) return false
      const bounds = await measureContent(doc, () => getDoc() !== doc)
      // Edited while measuring: the measurement no longer applies, measure again.
      if (getDoc() !== doc) continue
      const plan = planFit(doc, bounds, opts)
      if (!plan) {
        showResult('canvas', t.docops.results.fitEmpty, 'warning')
        return false
      }
      if (!plan.changed) {
        showResult('canvas', t.docops.results.fitUnchanged, 'info')
        return false
      }
      if (!commit(t.docops.history.fit, (d) => fitCanvasToContent(d, { ...opts, bounds })))
        return false
      showResult('canvas', t.docops.results.fitted(formatSize(plan.width, plan.height)))
      return true
    }
    return false
  } catch (err) {
    console.error('[docops] measuring the content failed', err)
    toast.error(t.docops.errors.failed, {
      description: err instanceof Error ? err.message : String(err),
    })
    return false
  } finally {
    setBusy(null)
  }
}
