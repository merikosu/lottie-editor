/**
 * Small value helpers for the inspector: mixed values, color scales, expression summaries.
 */
import { lottieToRgba, type RGBA } from '@/lib/color'
import { encodeChannel, to8 } from '@/lottie/colors'

/** The common value of a multi-selection, or null when the values differ ("Mixed"). */
export function commonNumber(
  values: readonly (number | undefined)[],
  epsilon = 1e-6,
): number | null {
  let first: number | undefined
  for (const v of values) {
    if (v === undefined || !Number.isFinite(v)) return null
    if (first === undefined) first = v
    else if (Math.abs(v - first) > epsilon) return null
  }
  return first ?? null
}

/** The common value of any comparable values (booleans, strings, enums), or null when mixed. */
export function commonValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null
  const first = values[0]
  return values.every((v) => v === first) ? first : null
}

/** Compares dotted versions ("5.5.2" vs "4.1.9"): negative, 0 or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Files exported by bodymovin < 4.1.9 store fill and stroke colors as 0–255; lottie-web
 * divides them by 255 on load. New values must be written in the same scale.
 */
export function usesLegacyColorScale(version: string | undefined): boolean {
  return (
    typeof version === 'string' && version.trim() !== '' && compareVersions(version, '4.1.9') < 0
  )
}

/**
 * Color of stored components. Legacy files (`legacy`: fills and strokes of bodymovin < 4.1.9)
 * store every component, alpha included, in 0–255.
 */
export function decodeColor(values: readonly number[], legacy = false): RGBA {
  if (!legacy) return lottieToRgba(values)
  return {
    r: fromLegacy(values[0], 0),
    g: fromLegacy(values[1], 0),
    b: fromLegacy(values[2], 0),
    a: values.length > 3 ? fromLegacy(values[3], 255) : 1,
  }
}

const fromLegacy = (v: number | undefined, fallback: number) =>
  Math.min(1, Math.max(0, (v ?? fallback) / 255))

/**
 * Stored components of a picked color: exact 8-bit channels that render as that color both in
 * players that floor (lottie-web) and in players that round — the encoding the Colors panel
 * writes — in the file's scale, with the given arity and alpha.
 */
export function encodeColor(
  color: Pick<RGBA, 'r' | 'g' | 'b'>,
  alpha: number,
  arity: 3 | 4,
  legacy = false,
): number[] {
  const scale = legacy ? 255 : 1
  const out = [
    encodeChannel(to8(color.r), scale),
    encodeChannel(to8(color.g), scale),
    encodeChannel(to8(color.b), scale),
  ]
  if (arity === 4)
    out.push(Math.round(Math.min(1, Math.max(0, alpha)) * (legacy ? 255 : 1) * 10000) / 10000)
  return out
}

/**
 * First meaningful line of an After Effects expression, for tooltips. Skips bodymovin
 * boilerplate (`var $bm_rt;`, bare declarations, `try {`).
 */
export function expressionSummary(source: string, maxLength = 90): string {
  const lines = source
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const meaningful =
    lines.find(
      (l) =>
        !/^var\s+[\w$]+(\s*,\s*[\w$]+)*\s*;?$/.test(l) &&
        !/^(try|else|finally)?\s*\{?$/.test(l) &&
        l !== '}',
    ) ??
    lines[0] ??
    ''
  return meaningful.length > maxLength ? `${meaningful.slice(0, maxLength - 1)}…` : meaningful
}
