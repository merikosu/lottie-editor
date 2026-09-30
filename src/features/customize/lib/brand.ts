/**
 * Brand colors: recolors an animation's palette with up to three brand colors.
 *
 * Algorithm
 *  1. Every color value of the document (fills, strokes, gradient stops, texts, solids, effects)
 *     is bucketed by its 8-bit hex; a bucket weighs as many values as it holds.
 *  2. Neutrals — colors with an RGB chroma (max − min channel) below 0.1: grays, near-blacks
 *     and near-whites — keep their colors, so outlines, shadows and highlights keep working.
 *  3. The chromatic buckets form hue families. Buckets are visited by importance (weight ×
 *     chroma: vivid, frequent colors first); a bucket joins the family whose anchor — its first,
 *     most important color — is within 30° of hue, otherwise it starts a family of its own.
 *     Weighting by chroma makes the anchor the palette's main vivid color rather than a pale
 *     tint that happens to be used more often.
 *  4. Families are ranked by importance (the sum of weight × chroma of their colors): brand
 *     color 1 recolors the first family, brand color 2 the second, and so on. Families beyond
 *     the number of brand colors keep their colors.
 *  5. Every color of a family keeps its relation to the anchor (HSL): the hue offset is kept,
 *     saturation scales by brand ÷ anchor, and lightness goes through a piecewise-linear map
 *     that sends the anchor's lightness to the brand color's while keeping black and white in
 *     place. The anchor becomes exactly the brand color; lighter and darker shades stay lighter
 *     and darker, so gradients keep their ramp. The maps compose: applying other brand colors
 *     later gives (up to 8-bit rounding) the same result as applying them to the original.
 * Opacity is never changed.
 */
import { hslToRgb, rgbToHsl, type HSL, type RGBA } from '@/lib/color'
import { replaceColor, type ColorUsage } from '@/lottie/colors'
import type { Animation } from '@/lottie/types'

/** At most this many brand colors are mapped. */
export const MAX_BRAND_COLORS = 3

/** Colors whose RGB chroma is below this are neutrals (left alone). */
const NEUTRAL_CHROMA = 0.1

/** A color joins a family whose anchor hue is at most this far (degrees). */
const FAMILY_HUE_RADIUS = 30

type Rgb = Pick<RGBA, 'r' | 'g' | 'b'>

export interface BrandFamily {
  /** The family's main color (lowercase #rrggbb): it becomes the brand color. */
  anchor: string
  /** Colors of the family, most important first (the anchor first). */
  colors: string[]
  /** Number of color values in the document that belong to the family. */
  count: number
  /** Ranking score (sum of count × chroma). */
  score: number
  /** Index of the brand color that recolors the family, or null when it keeps its colors. */
  brand: number | null
}

export interface BrandPlan {
  /** Hue families, most important first. */
  families: BrandFamily[]
  /** New color of every recolored hex (alpha 1: opacity is kept by the writer). */
  map: Map<string, RGBA>
  /** Number of color values that change. */
  changes: number
}

/** RGB chroma (0 for grays, 1 for pure colors). */
export function chromaOf(c: Rgb): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

/** Grays, near-blacks and near-whites: brand colors never recolor them. */
export function isNeutralColor(c: Rgb): boolean {
  return chromaOf(c) < NEUTRAL_CHROMA
}

/** Signed hue difference a − b in (−180, 180]. */
function hueDelta(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360
  return d > 180 ? d - 360 : d
}

/** Piecewise-linear map of [0, 1] sending `from` to `to`, with 0 and 1 fixed. */
function remap01(v: number, from: number, to: number): number {
  if (from <= 1e-6) return to + v * (1 - to)
  if (from >= 1 - 1e-6) return v * to
  return v <= from ? (v * to) / from : to + ((v - from) * (1 - to)) / (1 - from)
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Equal within one 8-bit step per channel (rounding noise of the HSL round trip). */
function sameColor8(a: Rgb, b: Rgb): boolean {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) * 255 < 1.5
}

/**
 * The color a family member becomes when its family's anchor becomes `brand` (step 5 of the
 * algorithm). Returns an opaque color.
 */
export function mapToBrand(color: Rgb, anchor: Rgb, brand: Rgb): RGBA {
  const c = rgbToHsl(color)
  const a = rgbToHsl(anchor)
  const b = rgbToHsl(brand)
  const next: HSL = {
    h: (((b.h + hueDelta(c.h, a.h)) % 360) + 360) % 360,
    s: a.s > 1e-6 ? clamp01((c.s * b.s) / a.s) : b.s,
    l: clamp01(remap01(c.l, a.l, b.l)),
  }
  return { ...hslToRgb(next), a: 1 }
}

interface Bucket {
  hex: string
  color: Rgb
  hue: number
  count: number
  importance: number
  order: number
}

/** Chromatic color buckets of the usages, most important first. */
function chromaticBuckets(usages: readonly ColorUsage[]): Bucket[] {
  const buckets = new Map<string, Bucket>()
  usages.forEach((u, order) => {
    const bucket = buckets.get(u.hex)
    if (bucket) {
      bucket.count++
      return
    }
    buckets.set(u.hex, {
      hex: u.hex,
      color: u.color,
      hue: rgbToHsl(u.color).h,
      count: 1,
      importance: 0,
      order,
    })
  })
  const list = [...buckets.values()].filter((b) => !isNeutralColor(b.color))
  for (const b of list) b.importance = b.count * chromaOf(b.color)
  return list.sort((a, b) => b.importance - a.importance || a.order - b.order)
}

/**
 * Plans how `brand` colors recolor the document palette read from `usages` (see the module
 * comment). Nothing is changed; `applyBrandPlan` writes the plan.
 */
export function planBrandColors(usages: readonly ColorUsage[], brand: readonly Rgb[]): BrandPlan {
  const families: (BrandFamily & { hue: number; anchorColor: Rgb; members: Bucket[] })[] = []
  for (const bucket of chromaticBuckets(usages)) {
    let best: (typeof families)[number] | null = null
    let bestDistance = Infinity
    for (const f of families) {
      const d = Math.abs(hueDelta(bucket.hue, f.hue))
      if (d <= FAMILY_HUE_RADIUS && d < bestDistance) {
        best = f
        bestDistance = d
      }
    }
    if (best) {
      best.members.push(bucket)
      best.colors.push(bucket.hex)
      best.count += bucket.count
      best.score += bucket.importance
    } else {
      families.push({
        anchor: bucket.hex,
        colors: [bucket.hex],
        count: bucket.count,
        score: bucket.importance,
        brand: null,
        hue: bucket.hue,
        anchorColor: bucket.color,
        members: [bucket],
      })
    }
  }
  families.sort((a, b) => b.score - a.score)

  const map = new Map<string, RGBA>()
  let changes = 0
  const used = brand.slice(0, MAX_BRAND_COLORS)
  families.forEach((f, index) => {
    if (index >= used.length) return
    f.brand = index
    for (const m of f.members) {
      const next = mapToBrand(m.color, f.anchorColor, used[index])
      // Colors that already are what they would become (e.g. after applying the same brand
      // colors) are left out, so applying twice changes nothing.
      if (sameColor8(next, m.color)) continue
      map.set(m.hex, next)
      changes += m.count
    }
  })

  return {
    families: families.map(({ anchor, colors, count, score, brand: b }) => ({
      anchor,
      colors,
      count,
      score,
      brand: b,
    })),
    map,
    changes,
  }
}

/**
 * Writes a brand plan: every usage whose hex the plan maps gets its new color (opacity kept).
 * Mutates `draft` (use inside `updateDoc`); `usages` must have been read from the same
 * document. Returns the number of usages that changed.
 */
export function applyBrandPlan(
  draft: Animation,
  usages: readonly ColorUsage[],
  plan: BrandPlan,
): number {
  if (plan.map.size === 0) return 0
  const byHex = new Map<string, ColorUsage[]>()
  for (const u of usages) {
    if (!plan.map.has(u.hex)) continue
    const list = byHex.get(u.hex)
    if (list) list.push(u)
    else byHex.set(u.hex, [u])
  }
  let changed = 0
  for (const [hex, list] of byHex) changed += replaceColor(draft, list, plan.map.get(hex) as RGBA)
  return changed
}
