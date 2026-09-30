/**
 * Color helpers. Lottie stores colors as arrays of floats in 0..1 ([r, g, b] or [r, g, b, a]).
 * The UI works with hex strings (#rrggbb / #rrggbbaa) and HSL for adjustments.
 */
import { clamp } from './math'

export type RGBA = { r: number; g: number; b: number; a: number } // all 0..1
export type HSL = { h: number; s: number; l: number } // h 0..360, s/l 0..1

function hex2(n: number): string {
  return Math.round(clamp(n, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0')
}

export function rgbaToHex({ r, g, b, a }: RGBA, withAlpha = false): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`
  return withAlpha && a < 1 ? `${base}${hex2(a)}` : base
}

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa (with or without '#'). Returns null if invalid. */
export function hexToRgba(input: string): RGBA | null {
  let hex = input.trim().replace(/^#/, '')
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 1 }
}

/** Lottie color array (0..1 floats) → RGBA. Tolerates legacy 0..255 arrays. */
export function lottieToRgba(arr: readonly number[]): RGBA {
  const legacy = arr.slice(0, 3).some((v) => v > 1)
  const k = legacy ? 1 / 255 : 1
  return {
    r: clamp((arr[0] ?? 0) * k, 0, 1),
    g: clamp((arr[1] ?? 0) * k, 0, 1),
    b: clamp((arr[2] ?? 0) * k, 0, 1),
    a: clamp(arr.length > 3 ? (arr[3] ?? 1) * (legacy && (arr[3] ?? 0) > 1 ? k : 1) : 1, 0, 1),
  }
}

/** RGBA → Lottie color array. Keeps the original arity (3 or 4 components). */
const round4 = (v: number) => Math.round(v * 10000) / 10000

export function rgbaToLottie(c: RGBA, arity: 3 | 4 = 4): number[] {
  const round = round4
  const out = [round(c.r), round(c.g), round(c.b)]
  if (arity === 4) out.push(round(c.a))
  return out
}

export function lottieToHex(arr: readonly number[]): string {
  return rgbaToHex(lottieToRgba(arr))
}

export function rgbToHsl({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): HSL {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h * 60, s, l }
}

export function hslToRgb({ h, s, l }: HSL): Pick<RGBA, 'r' | 'g' | 'b'> {
  const hh = (((h % 360) + 360) % 360) / 360
  if (s === 0) return { r: l, g: l, b: l }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return { r: f(hh + 1 / 3), g: f(hh), b: f(hh - 1 / 3) }
}

/** WCAG relative luminance (0..1). */
const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

export function luminance({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): number {
  const lin = linearize
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Readable foreground (black/white) for a given background. */
export function contrastingFg(c: Pick<RGBA, 'r' | 'g' | 'b'>): '#000000' | '#ffffff' {
  return luminance(c) > 0.4 ? '#000000' : '#ffffff'
}

/** Normalizes any hex input to lowercase #rrggbb (alpha dropped), or null. */
export function normalizeHex(input: string): string | null {
  const c = hexToRgba(input)
  return c ? rgbaToHex(c) : null
}
