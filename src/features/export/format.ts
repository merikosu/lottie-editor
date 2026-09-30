/**
 * Numbers in the export UI with the interface language's conventions: decimal separator
 * ("2.98 s" / "2,98 с"), file sizes (1 KB = 1024 B, like the rest of the app) and percentages.
 */
import { useMemo } from 'react'
import { getT, useLanguage, useT } from '@/i18n'
import type { Language } from '@/i18n/detect'
import { usePrefs } from '@/store/prefs'

export interface Formatter {
  /** At most `digits` decimals, trailing zeros dropped: 2.98, 30, 29.97. */
  decimal(value: number, digits?: number): string
  /** File size: 807 B, 23.7 KB, 64 KB (`decimals` 0), 1.2 MB. */
  size(bytes: number, decimals?: number): string
  /** Share as a percentage: 4.5%, 38%. */
  percent(ratio: number): string
}

type Units = readonly [string, string, string, string]

const cache = new Map<string, Intl.NumberFormat>()

function numberFormat(lang: Language, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}:${JSON.stringify(options)}`
  let format = cache.get(key)
  if (!format) {
    format = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
      useGrouping: false,
      ...options,
    })
    cache.set(key, format)
  }
  return format
}

/** A formatter for a language and its byte unit symbols (`t.common.byteUnits`). */
export function createFormatter(lang: Language, units: Units): Formatter {
  return {
    decimal(value, digits = 2) {
      if (!Number.isFinite(value)) return '—'
      return numberFormat(lang, { maximumFractionDigits: digits }).format(value)
    },
    size(bytes, decimals = 1) {
      if (!Number.isFinite(bytes) || bytes < 0) return '—'
      if (bytes < 1024) return `${Math.round(bytes)} ${units[0]}`
      let value = bytes / 1024
      let unit = 1
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
      }
      const digits = value >= 100 ? 0 : decimals
      const text = numberFormat(lang, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value)
      return `${text} ${units[unit]}`
    },
    percent(ratio) {
      if (!Number.isFinite(ratio)) return '—'
      const digits = Math.abs(ratio) < 0.1 && ratio !== 0 ? 1 : 0
      return numberFormat(lang, { style: 'percent', maximumFractionDigits: digits }).format(ratio)
    },
  }
}

/** Formatter for the current interface language (React). */
export function useFormatter(): Formatter {
  const lang = useLanguage()
  const units = useT().common.byteUnits
  return useMemo(() => createFormatter(lang, units), [lang, units])
}

/** Formatter for the current interface language (outside React). */
export function getFormatter(): Formatter {
  return createFormatter(usePrefs.getState().language, getT().common.byteUnits)
}
