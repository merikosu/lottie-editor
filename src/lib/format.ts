import { roundTo } from './math'

let byteUnits: readonly [string, string, string, string] = ['B', 'KB', 'MB', 'GB']
let numberLocale = 'en'
let secondsUnit = 's'
const formatters = new Map<string, Intl.NumberFormat>()

/** Sets the locale for decimal separators (called when the UI language changes). */
export function setNumberLocale(locale: string): void {
  numberLocale = locale
}

/** Sets the short seconds unit used by formatSeconds ("s", "с"). */
export function setSecondsUnit(unit: string): void {
  secondsUnit = unit
}

function numberFormat(maxDecimals: number): Intl.NumberFormat {
  const key = `${numberLocale}:${maxDecimals}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(numberLocale, {
      maximumFractionDigits: maxDecimals,
      useGrouping: false,
    })
    formatters.set(key, f)
  }
  return f
}

/** Locale-aware decimal without grouping: 2.5 → "2.5" (en) / "2,5" (ru). */
export function formatDecimal(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return '—'
  return numberFormat(maxDecimals).format(roundTo(value, maxDecimals))
}

/** Sets the unit labels used by formatBytes (called when the UI language changes). */
export function setByteUnits(units: readonly [string, string, string, string]): void {
  byteUnits = units
}

/** Human readable byte size: 1 KB = 1024 B (unit labels follow the UI language). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} ${byteUnits[0]}`
  const units = byteUnits.slice(1)
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${formatDecimal(value, value >= 100 ? 0 : decimals)} ${units[unit]}`
}

/** Format a number for display: trims trailing zeros, max `decimals` fraction digits, locale separator. */
export function formatNumber(value: number, decimals = 2): string {
  return formatDecimal(value, decimals)
}

/** 125 frames @ 25fps → "0:05.00". Negative values are clamped to zero. */
export function formatTimecode(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const totalSeconds = Math.max(0, frame) / safeFps
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`
}

/** Seconds with up to two decimals and the localized unit: 2.5 → "2.5 s" / "2,5 с". */
export function formatSeconds(seconds: number): string {
  return `${formatDecimal(seconds, 2)} ${secondsUnit}`
}

/** Percentage from a 0..1 ratio: 0.234 → "23%". Uses one decimal below 10%. */
export function formatPercent(ratio: number): string {
  const p = ratio * 100
  return `${Math.abs(p) < 10 && p !== 0 ? p.toFixed(1) : Math.round(p)}%`
}
