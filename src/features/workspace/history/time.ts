/**
 * Compact times for the history panel: "now", "12 min", then the clock time ("14:32"), and
 * the date for older steps. The full date and time is available in a tooltip.
 */

export interface HistoryTimeStrings {
  justNow: string
  minutes: (n: number) => string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const clockFormats = new Map<string, Intl.DateTimeFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()
const fullFormats = new Map<string, Intl.DateTimeFormat>()

function cached(
  map: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  let f = map.get(locale)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    map.set(locale, f)
  }
  return f
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatHistoryTime(
  time: number,
  now: number,
  locale: string,
  s: HistoryTimeStrings,
): string {
  const diff = Math.max(0, now - time)
  if (diff < MINUTE) return s.justNow
  if (diff < HOUR) return s.minutes(Math.floor(diff / MINUTE))
  const date = new Date(time)
  if (sameDay(date, new Date(now))) {
    return cached(clockFormats, locale, { timeStyle: 'short' }).format(date)
  }
  return cached(dateFormats, locale, { day: 'numeric', month: 'short' }).format(date)
}

/** "29 Sep 2026, 14:32:05" in the UI language, for tooltips. */
export function formatFullTime(time: number, locale: string): string {
  return cached(fullFormats, locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(time),
  )
}

/**
 * Milliseconds until the label of `time` changes (drives the panel's refresh timer), or null
 * when it no longer changes within the hour.
 */
export function nextTimeChange(time: number, now: number): number | null {
  const diff = Math.max(0, now - time)
  if (diff >= HOUR) return null
  return MINUTE - (diff % MINUTE)
}
