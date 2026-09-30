/**
 * Numbers in the UI language: file sizes (1 KB = 1024 B, like the rest of the app), savings as
 * signed percentages with a real minus sign, durations and pixel values.
 */
import { useMemo } from 'react'
import { formatFileSize } from '@/features/io'
import { useLanguage, useT, type Dict, type Language } from '@/i18n'

export interface Format {
  bytes(n: number): string
  /** A share (0..1) as a percentage: "23.8%"; "<0.1%" for tiny non-zero shares. */
  percent(share: number): string
  /** A saving as a signed percentage: "−23.8%" (smaller) or "+1.2%" (larger). */
  saving(share: number): string
  /** A byte difference: "−12.1 KB", "+80 B". */
  delta(bytes: number): string
  number(n: number, digits?: number): string
  /** Whole number without digit grouping (dimensions: "1920 × 1080"). */
  int(n: number): string
  /** Milliseconds or seconds. */
  duration(ms: number): string
  px(n: number): string
}

const MINUS = '−'

export function makeFormat(language: Language, t: Dict): Format {
  const percent = new Intl.NumberFormat(language, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const whole = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 })
  const numbers = new Map<number, Intl.NumberFormat>()
  const number = (n: number, digits = 2) => {
    let f = numbers.get(digits)
    if (!f) {
      f = new Intl.NumberFormat(language, { maximumFractionDigits: digits })
      numbers.set(digits, f)
    }
    return f.format(n)
  }
  const bytes = (n: number) => formatFileSize(n, language, t.io.units)
  const pct = (share: number) => {
    const abs = Math.abs(share)
    if (abs > 0 && abs < 0.0005) return `<${percent.format(0.001)}`
    // 99.96% would read as "100.0%": whole numbers at the top end.
    if (abs >= 0.9995) return whole.format(abs)
    return percent.format(abs)
  }
  return {
    bytes,
    percent: pct,
    saving: (share) => (share === 0 ? pct(0) : `${share > 0 ? MINUS : '+'}${pct(share)}`),
    delta: (n) => (n === 0 ? bytes(0) : `${n > 0 ? MINUS : '+'}${bytes(Math.abs(n))}`),
    number,
    int: (n) => String(Math.round(n)),
    duration: (ms) =>
      ms < 1000
        ? `${Math.max(1, Math.round(ms))} ${t.optimizer.units.ms}`
        : `${number(ms / 1000, ms < 10_000 ? 1 : 0)} ${t.optimizer.units.s}`,
    px: (n) => `${number(n, 3)} ${t.optimizer.units.px}`,
  }
}

/** Formatting helpers for the current UI language. */
export function useFormat(): Format {
  const language = useLanguage()
  const t = useT()
  return useMemo(() => makeFormat(language, t), [language, t])
}
