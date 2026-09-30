/**
 * Gradient stops (`gf`/`gs` → `g`).
 *
 * `g.p` is the number of color stops; `g.k` holds a flat array (static or keyframed):
 *   [pos0, r0, g0, b0, pos1, r1, g1, b1, …]  followed by optional opacity stops
 *   [pos, alpha, pos, alpha, …]. Everything is 0..1.
 *
 * Opacity stops are "aligned" when they have the same count and positions as the color
 * stops (lottie-web then puts `stop-opacity` directly on the color stops). The editor shows
 * aligned gradients like Figma: each stop has a color and an opacity.
 *
 * Structural edits (adding/removing stops) must change EVERY keyframe of an animated
 * gradient, because keyframes are interpolated index by index.
 */
import { clamp, roundTo } from '@/lib/math'

export type RGB = [number, number, number]

export interface ColorStop {
  offset: number
  color: RGB
}

export interface OpacityStop {
  offset: number
  alpha: number
}

export interface GradientStops {
  colors: ColorStop[]
  opacities: OpacityStop[]
}

const ALIGN_EPSILON = 0.01
const round = (v: number) => roundTo(v, 4)

/** Parses a flat gradient array with `count` color stops. Missing values default sensibly. */
export function parseStops(flat: readonly number[], count: number): GradientStops {
  const n = Math.max(0, Math.min(Math.floor(count), Math.floor(flat.length / 4)))
  const colors: ColorStop[] = []
  for (let i = 0; i < n; i++) {
    const o = i * 4
    colors.push({
      offset: flat[o] ?? 0,
      color: [flat[o + 1] ?? 0, flat[o + 2] ?? 0, flat[o + 3] ?? 0],
    })
  }
  const opacities: OpacityStop[] = []
  for (let o = n * 4; o + 1 < flat.length; o += 2)
    opacities.push({ offset: flat[o], alpha: flat[o + 1] })
  return { colors, opacities }
}

/** Serializes stops back to the flat array (color stops first, then opacity stops). */
export function serializeStops(stops: GradientStops): number[] {
  const out: number[] = []
  for (const s of stops.colors)
    out.push(round(s.offset), round(s.color[0]), round(s.color[1]), round(s.color[2]))
  for (const s of stops.opacities) out.push(round(s.offset), round(s.alpha))
  return out
}

/** True when opacity stops exist and match the color stops one to one. */
export function hasAlignedOpacity(stops: GradientStops): boolean {
  return (
    stops.opacities.length > 0 &&
    stops.opacities.length === stops.colors.length &&
    stops.colors.every((c, i) => Math.abs(c.offset - stops.opacities[i].offset) <= ALIGN_EPSILON)
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Sampling                                  */
/* -------------------------------------------------------------------------- */

function sortedByOffset<T extends { offset: number }>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => a.offset - b.offset)
}

/** Color of the gradient at `offset` (linear interpolation between color stops). */
export function colorAt(stops: GradientStops, offset: number): RGB {
  const list = sortedByOffset(stops.colors)
  if (list.length === 0) return [0, 0, 0]
  if (offset <= list[0].offset) return [...list[0].color]
  const last = list[list.length - 1]
  if (offset >= last.offset) return [...last.color]
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i]
    const b = list[i + 1]
    if (offset >= a.offset && offset <= b.offset) {
      const span = b.offset - a.offset
      const t = span > 0 ? (offset - a.offset) / span : 0
      return [0, 1, 2].map((c) => a.color[c] + (b.color[c] - a.color[c]) * t) as RGB
    }
  }
  return [...last.color]
}

/** Opacity of the gradient at `offset` (1 when there are no opacity stops). */
export function alphaAt(stops: GradientStops, offset: number): number {
  const list = sortedByOffset(stops.opacities)
  if (list.length === 0) return 1
  if (offset <= list[0].offset) return list[0].alpha
  const last = list[list.length - 1]
  if (offset >= last.offset) return last.alpha
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i]
    const b = list[i + 1]
    if (offset >= a.offset && offset <= b.offset) {
      const span = b.offset - a.offset
      return a.alpha + (b.alpha - a.alpha) * (span > 0 ? (offset - a.offset) / span : 0)
    }
  }
  return last.alpha
}

/** CSS `linear-gradient` preview of the stops (left → right), including opacity. */
export function cssGradient(stops: GradientStops): string {
  const offsets = new Set<number>()
  for (const s of stops.colors) offsets.add(clamp(s.offset, 0, 1))
  for (const s of stops.opacities) offsets.add(clamp(s.offset, 0, 1))
  const sorted = [...offsets].sort((a, b) => a - b)
  if (sorted.length === 0) return 'transparent'
  const parts = sorted.map((o) => {
    const [r, g, b] = colorAt(stops, o).map((v) => Math.round(clamp(v, 0, 1) * 255))
    const a = roundTo(clamp(alphaAt(stops, o), 0, 1), 3)
    return `rgba(${r}, ${g}, ${b}, ${a}) ${roundTo(o * 100, 2)}%`
  })
  if (parts.length === 1) parts.push(parts[0].replace(/[\d.]+%$/, '100%'))
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

/* -------------------------------------------------------------------------- */
/*                                   Editing                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reorders color stops by offset (SVG requires ascending offsets) and returns the new index
 * of the stop that was at `index`. Aligned opacity stops move with their color stops.
 */
export function sortStops(
  stops: GradientStops,
  index = -1,
): { stops: GradientStops; index: number } {
  const aligned = hasAlignedOpacity(stops)
  const order = stops.colors
    .map((_, i) => i)
    .sort((a, b) => stops.colors[a].offset - stops.colors[b].offset || a - b)
  const colors = order.map((i) => stops.colors[i])
  const opacities = aligned ? order.map((i) => stops.opacities[i]) : sortedByOffset(stops.opacities)
  return { stops: { colors, opacities }, index: index < 0 ? index : order.indexOf(index) }
}

/** Sets the offset of color stop `index` (and of its aligned opacity stop). Does not sort. */
export function setStopOffset(stops: GradientStops, index: number, offset: number): GradientStops {
  const aligned = hasAlignedOpacity(stops)
  const value = clamp(offset, 0, 1)
  return {
    colors: stops.colors.map((s, i) => (i === index ? { ...s, offset: value } : s)),
    opacities: aligned
      ? stops.opacities.map((s, i) => (i === index ? { ...s, offset: value } : s))
      : stops.opacities,
  }
}

export function setStopColor(stops: GradientStops, index: number, color: RGB): GradientStops {
  return {
    ...stops,
    colors: stops.colors.map((s, i) => (i === index ? { ...s, color: [...color] as RGB } : s)),
  }
}

/**
 * Sets the opacity at color stop `index`. Gradients without opacity stops get aligned ones
 * (all opaque); unaligned opacity stops get a stop at that offset (replacing a close one).
 */
export function setStopAlpha(stops: GradientStops, index: number, alpha: number): GradientStops {
  const value = clamp(alpha, 0, 1)
  const stop = stops.colors[index]
  if (!stop) return stops
  if (stops.opacities.length === 0) {
    return {
      ...stops,
      opacities: stops.colors.map((s, i) => ({ offset: s.offset, alpha: i === index ? value : 1 })),
    }
  }
  if (hasAlignedOpacity(stops)) {
    return {
      ...stops,
      opacities: stops.opacities.map((s, i) => (i === index ? { ...s, alpha: value } : s)),
    }
  }
  const near = stops.opacities.findIndex((s) => Math.abs(s.offset - stop.offset) <= ALIGN_EPSILON)
  if (near >= 0)
    return {
      ...stops,
      opacities: stops.opacities.map((s, i) => (i === near ? { ...s, alpha: value } : s)),
    }
  return {
    ...stops,
    opacities: sortedByOffset([...stops.opacities, { offset: stop.offset, alpha: value }]),
  }
}

/** Opacity shown for color stop `index`. */
export function stopAlpha(stops: GradientStops, index: number): number {
  const stop = stops.colors[index]
  if (!stop) return 1
  if (hasAlignedOpacity(stops)) return stops.opacities[index].alpha
  return alphaAt(stops, stop.offset)
}

/**
 * Inserts a color stop at `offset` using the gradient's current color and opacity there,
 * so the look does not change. Returns the new stops and the index of the inserted stop.
 */
export function insertStop(
  stops: GradientStops,
  offset: number,
): { stops: GradientStops; index: number } {
  const value = clamp(offset, 0, 1)
  const aligned = hasAlignedOpacity(stops)
  const colors = [...stops.colors, { offset: value, color: colorAt(stops, value) }]
  const opacities = aligned
    ? [...stops.opacities, { offset: value, alpha: alphaAt(stops, value) }]
    : stops.opacities
  return sortStops({ colors, opacities }, colors.length - 1)
}

/** Removes color stop `index` (and its aligned opacity stop). Keeps at least two stops. */
export function removeStop(stops: GradientStops, index: number): GradientStops {
  if (stops.colors.length <= 2 || !stops.colors[index]) return stops
  const aligned = hasAlignedOpacity(stops)
  return {
    colors: stops.colors.filter((_, i) => i !== index),
    opacities: aligned ? stops.opacities.filter((_, i) => i !== index) : stops.opacities,
  }
}

/* ----------------------------- Opacity stops ------------------------------ */

export function setOpacityStop(
  stops: GradientStops,
  index: number,
  patch: Partial<OpacityStop>,
): GradientStops {
  return {
    ...stops,
    opacities: stops.opacities.map((s, i) =>
      i === index
        ? {
            offset: patch.offset === undefined ? s.offset : clamp(patch.offset, 0, 1),
            alpha: patch.alpha === undefined ? s.alpha : clamp(patch.alpha, 0, 1),
          }
        : s,
    ),
  }
}

export function insertOpacityStop(
  stops: GradientStops,
  offset: number,
): { stops: GradientStops; index: number } {
  const value = clamp(offset, 0, 1)
  const inserted = { offset: value, alpha: alphaAt(stops, value) }
  const opacities = sortedByOffset([...stops.opacities, inserted])
  return { stops: { ...stops, opacities }, index: opacities.indexOf(inserted) }
}

export function removeOpacityStop(stops: GradientStops, index: number): GradientStops {
  if (stops.opacities.length <= 2) return stops
  return { ...stops, opacities: stops.opacities.filter((_, i) => i !== index) }
}

/**
 * Makes `stops` (another keyframe of an animated gradient) structurally compatible with `next`
 * after an edit added opacity stops at the playhead, without changing its look: keyframes are
 * interpolated index by index, so every keyframe must hold the same number of opacity stops.
 * Returns `stops` unchanged when it already matches (or cannot be matched).
 */
export function matchOpacityStructure(stops: GradientStops, next: GradientStops): GradientStops {
  if (stops.opacities.length === next.opacities.length) return stops
  if (
    stops.opacities.length === 0 &&
    hasAlignedOpacity(next) &&
    stops.colors.length === next.colors.length
  ) {
    // Opacity was added to every color stop: fully opaque stops at this keyframe's own offsets.
    return { ...stops, opacities: stops.colors.map((c) => ({ offset: c.offset, alpha: 1 })) }
  }
  let out = stops
  for (const o of next.opacities) {
    if (out.opacities.length >= next.opacities.length) break
    if (!out.opacities.some((x) => Math.abs(x.offset - o.offset) <= ALIGN_EPSILON))
      out = insertOpacityStop(out, o.offset).stops
  }
  return out
}

function mirrorStops<T extends { offset: number }>(list: readonly T[]): T[] {
  return sortedByOffset(list.map((s) => ({ ...s, offset: round(1 - s.offset) })))
}

/** Mirrors the gradient (offset → 1 − offset), keeping ascending order. */
export function reverseStops(stops: GradientStops): GradientStops {
  return { colors: mirrorStops(stops.colors), opacities: mirrorStops(stops.opacities) }
}

/* -------------------------------------------------------------------------- */
/*                        Structural edits on keyframes                       */
/* -------------------------------------------------------------------------- */

/**
 * Applies a structural edit (insert/remove) to every keyframe value of an animated gradient.
 * `edit` receives each keyframe's stops and must return the new stops; the result keeps the
 * same stop count across keyframes as long as `edit` is structural only.
 */
export function mapGradientValues(
  values: readonly (readonly number[])[],
  count: number,
  edit: (stops: GradientStops) => GradientStops,
): number[][] {
  return values.map((v) => serializeStops(edit(parseStops(v, count))))
}
