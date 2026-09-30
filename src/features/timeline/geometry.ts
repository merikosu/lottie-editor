/**
 * Timeline geometry: frame ↔ pixel mapping, zoom limits, adaptive ruler ticks and snapping.
 * Pure functions (unit-tested); all x values are in content coordinates of the tracks area
 * (0 = left edge of the scrollable content, before horizontal scrolling).
 */
import { formatDecimal } from '@/lib/format'
import type { TimeUnits } from './store'

export const LAYER_ROW_H = 28
export const PROP_ROW_H = 24
export const RULER_H = 24
export const MARKER_LANE_H = 16
export const HEADER_H = RULER_H + MARKER_LANE_H
/** Empty space before the first and after the last frame, so edge keyframes stay grabbable. */
export const TRACK_PAD = 14
/** Most zoomed-in scale (pixels per frame). */
export const MAX_PPF = 96
/** Snapping distance in pixels. */
export const SNAP_PX = 6
/** Keyframe hit target (px). */
export const KEY_HIT = 14
/** Narrowest tracks area the names column may leave when resized. */
export const NAMES_MIN_TRACK = 160

export function frameToX(frame: number, ip: number, ppf: number): number {
  return TRACK_PAD + (frame - ip) * ppf
}

export function xToFrame(x: number, ip: number, ppf: number): number {
  return ip + (x - TRACK_PAD) / ppf
}

/** Width of the scrollable content for the root range [ip, op]. */
export function contentWidth(ip: number, op: number, ppf: number): number {
  return TRACK_PAD * 2 + Math.max(1, op - ip) * ppf
}

/** Scale at which the whole range fits `viewWidth`. */
export function fitPpf(viewWidth: number, ip: number, op: number): number {
  return Math.max(0.02, (viewWidth - TRACK_PAD * 2) / Math.max(1, op - ip))
}

/** Allowed zoom range: from "whole animation fits" to MAX_PPF. */
export function zoomLimits(
  viewWidth: number,
  ip: number,
  op: number,
): { min: number; max: number } {
  const min = Math.min(fitPpf(viewWidth, ip, op), MAX_PPF)
  return { min, max: Math.max(min, MAX_PPF) }
}

export function clampPpf(ppf: number, limits: { min: number; max: number }): number {
  return Math.min(limits.max, Math.max(limits.min, ppf))
}

/** Maps a zoom level to a 0..100 slider position (logarithmic) and back. */
export function ppfToSlider(ppf: number, limits: { min: number; max: number }): number {
  if (limits.max <= limits.min) return 0
  return (Math.log(ppf / limits.min) / Math.log(limits.max / limits.min)) * 100
}

export function sliderToPpf(value: number, limits: { min: number; max: number }): number {
  if (limits.max <= limits.min) return limits.min
  return limits.min * (limits.max / limits.min) ** (value / 100)
}

/* -------------------------------------------------------------------------- */
/*                                    Ticks                                   */
/* -------------------------------------------------------------------------- */

export interface TickSpec {
  /** Distance between minor ticks, in frames. */
  minor: number
  /** Distance between labelled major ticks, in frames (a multiple of `minor`). */
  major: number
}

const MIN_MINOR_PX = 6
const MIN_LABEL_PX = 52
const FRAME_STEPS = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000,
]
const SECOND_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600]

function isMultiple(value: number, step: number): boolean {
  const q = value / step
  return Math.abs(q - Math.round(q)) < 1e-6
}

/**
 * Chooses tick spacing for a zoom level: labels at least ~52px apart, minor ticks at least
 * 6px apart. In seconds mode majors fall on round seconds (or round fractions of a second).
 */
export function tickSpec(ppf: number, fps: number, units: TimeUnits): TickSpec {
  if (units === 'seconds' && fps > 0) {
    const majorSeconds =
      SECOND_STEPS.find((s) => s * fps * ppf >= MIN_LABEL_PX) ??
      SECOND_STEPS[SECOND_STEPS.length - 1]
    // Majors never go below one frame.
    const major = Math.max(1, majorSeconds * fps)
    // Minor ticks subdivide the major step evenly (whole frames when possible).
    const divisions = [10, 5, 4, 2, 1]
    const div =
      divisions.find((d) => (major / d) * ppf >= MIN_MINOR_PX && (major / d >= 1 || d === 1)) ?? 1
    return { minor: major / div, major }
  }
  const minor =
    FRAME_STEPS.find((s) => s * ppf >= MIN_MINOR_PX) ?? FRAME_STEPS[FRAME_STEPS.length - 1]
  const major =
    FRAME_STEPS.find((s) => s >= minor && s * ppf >= MIN_LABEL_PX && isMultiple(s, minor)) ??
    Math.ceil(MIN_LABEL_PX / ppf / minor) * minor
  return { minor, major }
}

/** Tick positions (frames) of `step` inside [from, to], aligned to `origin`. */
export function ticksInRange(from: number, to: number, step: number, origin = 0): number[] {
  if (!(step > 0) || to < from) return []
  const first = Math.ceil((from - origin) / step - 1e-9) * step + origin
  const out: number[] = []
  for (let f = first; f <= to + 1e-9 && out.length < 10000; f += step)
    out.push(Math.round(f * 1e6) / 1e6)
  return out
}

/** Ruler label for a frame. Seconds use the given unit suffix ("s") and the locale's decimals. */
export function formatTickLabel(
  frame: number,
  fps: number,
  units: TimeUnits,
  secondsSuffix: string,
): string {
  if (units === 'frames' || !(fps > 0)) return String(Math.round(frame))
  const seconds = frame / fps
  if (Math.abs(seconds) >= 60) {
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds - m * 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  const rounded = Math.round(seconds * 100) / 100
  return `${formatDecimal(rounded, 2)}${secondsSuffix}`
}

/* -------------------------------------------------------------------------- */
/*                                  Snapping                                  */
/* -------------------------------------------------------------------------- */

/** Nearest target to `value` within `threshold`, or null. `targets` need not be sorted. */
export function nearestTarget(
  value: number,
  targets: readonly number[],
  threshold: number,
): number | null {
  let best: number | null = null
  let bestDist = threshold
  for (const t of targets) {
    const d = Math.abs(t - value)
    if (d <= bestDist) {
      best = t
      bestDist = d
    }
  }
  return best
}

/**
 * Snaps a moving set of anchor times by one shared delta: the anchor closest to a target
 * wins. Returns the delta to apply and the target that was hit (or null when nothing snapped).
 */
export function snapDelta(
  anchors: readonly number[],
  rawDelta: number,
  targets: readonly number[],
  threshold: number,
): { delta: number; target: number | null } {
  let best: { delta: number; target: number; dist: number } | null = null
  for (const a of anchors) {
    const moved = a + rawDelta
    const hit = nearestTarget(moved, targets, threshold)
    if (hit === null) continue
    const dist = Math.abs(hit - moved)
    if (!best || dist < best.dist) best = { delta: hit - a, target: hit, dist }
  }
  return best ? { delta: best.delta, target: best.target } : { delta: rawDelta, target: null }
}

/** Sorted unique numbers (within 1e-6). */
export function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1] > 1e-6)
}

/**
 * Formats a frame value for display: integers as is, fractions with up to 2 decimals and the
 * locale's decimal separator ("12,5" in Russian).
 */
export function formatFrame(frame: number): string {
  const r = Math.round(frame * 100) / 100
  return r === 0 ? '0' : formatDecimal(r, 2)
}
