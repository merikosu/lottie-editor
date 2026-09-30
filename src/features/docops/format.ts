/** Display formatting for timing and canvas values (units come from the dictionary). */
import type { Dict } from '@/i18n'
import { formatDecimal } from '@/lib/format'
import { roundTo } from '@/lib/math'
import type { Animation } from '@/lottie/types'

/** "2.98 s" / "2,98 с" */
export function formatSeconds(t: Dict, seconds: number): string {
  return `${formatDecimal(seconds, 2)} ${t.common.secondsShort}`
}

/** "60 fps" / "60 к/с" */
export function formatFps(t: Dict, fps: number): string {
  return `${formatDecimal(fps, 2)} ${t.common.fps}`
}

/** 0.75 → "75%", 1 / 3 → "33.3%" / "33,3%" */
export function formatPercent(ratio: number): string {
  return `${formatDecimal(ratio * 100, 1)}%`
}

/** "1080 × 1920" */
export function formatSize(width: number, height: number): string {
  return `${formatDecimal(width, 2)} × ${formatDecimal(height, 2)}`
}

/** Signed pixels with a true minus sign: 12 → "12", -3.5 → "−3.5" / "−3,5". */
export function formatSigned(value: number): string {
  const v = roundTo(value, 2)
  return v < 0 ? `−${formatDecimal(Math.abs(v), 2)}` : formatDecimal(v, 2)
}

/** Duration in seconds of a root range. */
export function durationOf(anim: Pick<Animation, 'ip' | 'op' | 'fr'>): number {
  return anim.fr > 0 ? (anim.op - anim.ip) / anim.fr : 0
}

/** "2.98 s · 179 frames · 60 fps" */
export function timingSummary(t: Dict, anim: Pick<Animation, 'ip' | 'op' | 'fr'>): string {
  const frames = roundTo(anim.op - anim.ip, 2)
  return t.docops.results.timing(formatSeconds(t, durationOf(anim)), frames, formatFps(t, anim.fr))
}
