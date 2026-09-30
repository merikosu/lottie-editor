/**
 * Human formatting in the UI language: relative times ("3 minutes ago", "yesterday"), clock
 * times ("12:41"), durations ("1,5") and file sizes ("3,2 КБ").
 */
import type { Language } from '@/i18n'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * "just now", "3 minutes ago", "yesterday", "2 weeks ago", then a date. `justNow` is the
 * translated word for the first minute (Intl says "now", which reads oddly after "Edited").
 */
export function formatRelativeTime(
  time: number,
  language: Language,
  justNow: string,
  now = Date.now(),
): string {
  const diff = Math.max(0, now - time)
  if (diff < MINUTE) return justNow
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'long' })
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour')
  if (diff < WEEK) return rtf.format(-Math.floor(diff / DAY), 'day')
  if (diff < 5 * WEEK) return rtf.format(-Math.floor(diff / WEEK), 'week')
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(time)
}

/** Wall-clock time: "12:41". */
export function formatClockTime(time: number, language: Language): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(time)
}

/** Duration in seconds with at most two decimals and a localized separator: "1.5", "1,5". */
export function formatDuration(frames: number, fps: number, language: Language): string {
  const seconds = fps > 0 ? frames / fps : 0
  return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(seconds)
}

/** Translated unit symbols for file sizes. */
export interface SizeUnits {
  B: string
  KB: string
  MB: string
  GB: string
}

/**
 * File size with 1 KB = 1024 B, like the rest of the app, but with the UI language's decimal
 * separator and unit symbols: "3.2 KB", "3,2 КБ".
 */
export function formatFileSize(bytes: number, language: Language, units: SizeUnits): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} ${units.B}`
  const steps = ['KB', 'MB', 'GB'] as const
  let value = bytes / 1024
  let step = 0
  while (value >= 1024 && step < steps.length - 1) {
    value /= 1024
    step++
  }
  const number = new Intl.NumberFormat(language, {
    minimumFractionDigits: value >= 100 ? 0 : 1,
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value)
  return `${number} ${units[steps[step]]}`
}
