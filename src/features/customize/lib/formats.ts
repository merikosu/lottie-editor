/**
 * Canvas formats of the Customize page. A format adds space around the animation so the
 * canvas gets another aspect ratio — nothing is cut off and nothing is scaled. The "design
 * area" is the part of the canvas the animation was made for: the largest rectangle with the
 * original aspect ratio that fits the canvas (formats only ever add space on one axis, and
 * scaling keeps the proportions), so it can be derived from the document at any time.
 */

export type FormatId = 'original' | 'square' | 'landscape' | 'portrait' | 'social'

export interface Size {
  w: number
  h: number
}

/** Width ÷ height of each format ('original' uses the design area's own ratio). */
export const FORMAT_RATIOS: Record<Exclude<FormatId, 'original'>, number> = {
  square: 1,
  landscape: 16 / 9,
  portrait: 9 / 16,
  social: 4 / 5,
}

export const FORMATS: FormatId[] = ['original', 'square', 'landscape', 'portrait', 'social']

/** The design area inside `canvas` for an animation made at `original` (see module comment). */
export function designArea(original: Size, canvas: Size): Size {
  if (!(original.w > 0) || !(original.h > 0)) return canvas
  const ratio = original.w / original.h
  return canvas.w / canvas.h > ratio
    ? { w: canvas.h * ratio, h: canvas.h }
    : { w: canvas.w, h: canvas.w / ratio }
}

/** The smallest canvas of `format` that contains `area` (whole pixels). */
export function formatCanvas(area: Size, format: FormatId): Size {
  if (format === 'original') return { w: Math.round(area.w), h: Math.round(area.h) }
  const ratio = FORMAT_RATIOS[format]
  const size =
    area.w / area.h > ratio ? { w: area.w, h: area.w / ratio } : { w: area.h * ratio, h: area.h }
  return { w: Math.round(size.w), h: Math.round(size.h) }
}

/** The format the canvas has (null when it is none of them). */
export function currentFormat(original: Size, canvas: Size): FormatId | null {
  const area = designArea(original, canvas)
  for (const format of FORMATS) {
    const c = formatCanvas(area, format)
    if (Math.abs(c.w - canvas.w) <= 1 && Math.abs(c.h - canvas.h) <= 1) return format
  }
  return null
}
