/**
 * Current-value readouts for property rows ("256, 150", "45°", "100%", a color swatch, …).
 */
import type { Dict } from '@/i18n'
import { lottieToRgba, rgbaToHex } from '@/lib/color'
import { formatDecimal } from '@/lib/format'
import { evaluateArray, evaluateTextDocument } from '@/lottie/property'
import type { TextData } from '@/lottie/types'
import type { PropNode } from './model'

export interface Readout {
  text: string
  /** CSS background for a small swatch (colors, gradients). */
  swatch?: string
}

const EMPTY: Readout = { text: '' }

/** Locale-aware number ("12,5" in Russian), never "-0". */
function formatNumber(v: number, precision: number): string {
  if (!Number.isFinite(v)) return '—'
  const text = formatDecimal(v, precision)
  return /^-0([.,]0*)?$/.test(text) ? '0' : text
}

function css255(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
}

/** CSS gradient for a flat Lottie gradient array with `stops` color stops. */
export function gradientCss(values: readonly number[], stops: number): string {
  const parts: string[] = []
  for (let i = 0; i < stops; i++) {
    const o = i * 4
    if (o + 3 >= values.length) break
    const pos = Math.round(Math.min(1, Math.max(0, values[o])) * 100)
    parts.push(
      `rgb(${css255(values[o + 1])} ${css255(values[o + 2])} ${css255(values[o + 3])}) ${pos}%`,
    )
  }
  if (parts.length === 0) return 'transparent'
  if (parts.length === 1) parts.push(parts[0])
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

/** Readout of a property at a local frame. */
export function readValue(node: PropNode, frame: number, t: Dict): Readout {
  const { meta } = node
  if (meta.value === 'path') return EMPTY
  if (meta.value === 'text') {
    const doc = evaluateTextDocument({ d: node.prop } as unknown as TextData, frame)
    // Line breaks: \r (lottie-web), \n, and ETX (char 3) used by some exporters.
    const line = (doc?.t ?? '').split('\r')[0].split('\n')[0].split(String.fromCharCode(3))[0]
    return { text: line ? `“${line.length > 40 ? `${line.slice(0, 40)}…` : line}”` : '' }
  }
  const v = evaluateArray(node.prop, frame)
  if (v.length === 0) return EMPTY
  if (meta.value === 'color') {
    const hex = rgbaToHex(lottieToRgba(v)).slice(1).toUpperCase()
    return { text: hex, swatch: `#${hex}` }
  }
  if (meta.value === 'gradient') {
    const stops = node.stops ?? Math.floor(v.length / 4)
    return { text: t.timeline.rows.stops(stops), swatch: gradientCss(v, stops) }
  }
  const dims = v.length === 1 ? 1 : Math.min(v.length, 2)
  // Components are separated by ", " (English) or "; " (Russian, where the comma is decimal).
  const text = v
    .slice(0, dims)
    .map((n) => formatNumber(n, meta.precision))
    .join(t.timeline.rows.valueSeparator)
  return { text: meta.unit ? `${text}${meta.unit}` : text }
}
