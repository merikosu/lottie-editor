/**
 * Text formats for copying a palette: a HEX list, CSS custom properties or JSON.
 */
import { gradientToCss, type ColorGroup, type GradientGroup } from '@/lottie/colors'

export type PaletteFormat = 'hex' | 'css' | 'json'

/** CSS for a gradient group (linear gradients are shown left to right). */
export function gradientGroupCss(group: GradientGroup): string {
  const { sample } = group
  return gradientToCss(
    sample.stops.map((s) => ({ offset: s.stopOffset ?? 0, color: s.color })),
    sample.opacity,
    sample.type,
  )
}

const round = (v: number) => Math.round(v * 1000) / 1000

/** Formats the palette. Colors keep their panel order; gradients follow in CSS and JSON. */
export function formatPalette(
  colors: readonly ColorGroup[],
  gradients: readonly GradientGroup[],
  format: PaletteFormat,
): string {
  if (format === 'hex') return colors.map((g) => g.hex.toUpperCase()).join('\n')

  if (format === 'css') {
    const lines = colors.map((g, i) => `  --color-${i + 1}: ${g.hex};`)
    gradients.forEach((g, i) => lines.push(`  --gradient-${i + 1}: ${gradientGroupCss(g)};`))
    return `:root {\n${lines.join('\n')}\n}`
  }

  const data = {
    colors: colors.map((g) => ({
      hex: g.hex,
      ...(g.alpha !== undefined ? { alpha: round(g.alpha) } : {}),
      uses: g.count,
      kinds: g.kinds,
      ...(g.members.length > 1 ? { similar: g.members.slice(1) } : {}),
    })),
    gradients: gradients.map((g) => ({
      type: g.sample.type,
      css: gradientGroupCss(g),
      uses: g.count,
      stops: g.sample.stops.map((s) => ({ offset: round(s.stopOffset ?? 0), hex: s.hex })),
      ...(g.sample.opacity.length
        ? {
            opacity: g.sample.opacity.map((o) => ({
              offset: round(o.offset),
              alpha: round(o.alpha),
            })),
          }
        : {}),
    })),
  }
  return JSON.stringify(data, null, 2)
}
