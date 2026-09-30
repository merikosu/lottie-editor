import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { hexToRgba, rgbToHsl, rgbaToHex } from '@/lib/color'
import { extractColorUsages, extractGradients } from '@/lottie/colors'
import type { Animation, ShapeItem } from '@/lottie/types'
import { applyBrandPlan, chromaOf, isNeutralColor, mapToBrand, planBrandColors } from '../lib/brand'

const rgb = (hex: string) => hexToRgba(hex)!
const arr = (hex: string) => {
  const c = rgb(hex)
  return [c.r, c.g, c.b, 1]
}

function fill(hex: string): ShapeItem {
  return { ty: 'fl', c: { a: 0, k: arr(hex) }, o: { a: 0, k: 100 }, r: 1 } as ShapeItem
}

function stroke(hex: string): ShapeItem {
  return { ty: 'st', c: { a: 0, k: arr(hex) }, o: { a: 0, k: 100 }, w: { a: 0, k: 2 } } as ShapeItem
}

/** A linear gradient fill with the given stops (evenly spaced). */
function gradient(hexes: string[]): ShapeItem {
  const k: number[] = []
  hexes.forEach((h, i) => {
    const c = rgb(h)
    k.push(hexes.length === 1 ? 0 : i / (hexes.length - 1), c.r, c.g, c.b)
  })
  return {
    ty: 'gf',
    o: { a: 0, k: 100 },
    r: 1,
    s: { a: 0, k: [0, 0] },
    e: { a: 0, k: [100, 0] },
    t: 1,
    g: { p: hexes.length, k: { a: 0, k } },
  } as unknown as ShapeItem
}

function doc(items: ShapeItem[]): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ind: 1,
        nm: 'Shapes',
        ip: 0,
        op: 30,
        st: 0,
        ks: {},
        shapes: [{ ty: 'gr', it: [...items, { ty: 'tr' }] } as unknown as ShapeItem],
      },
    ],
  } as unknown as Animation
}

const hexOf = (c: { r: number; g: number; b: number }) => rgbaToHex({ ...c, a: 1 })

describe('neutral colors', () => {
  it('treats grays, near-black and near-white as neutral', () => {
    for (const hex of ['#ffffff', '#000000', '#808080', '#3a3f4a', '#f4f6f8', '#0b0b0d']) {
      expect(isNeutralColor(rgb(hex)), hex).toBe(true)
    }
  })

  it('treats vivid and dark saturated colors as chromatic', () => {
    for (const hex of ['#0b99fc', '#ff5722', '#2e1db7', '#cff0ff', '#4a6fa5']) {
      expect(isNeutralColor(rgb(hex)), hex).toBe(false)
    }
    expect(chromaOf(rgb('#ff0000'))).toBe(1)
  })
})

describe('mapToBrand', () => {
  it('maps the anchor exactly onto the brand color', () => {
    const anchor = rgb('#0b99fc')
    for (const brand of ['#ff5722', '#12a150', '#7c3aed', '#fde047']) {
      expect(hexOf(mapToBrand(anchor, anchor, rgb(brand)))).toBe(brand)
    }
  })

  it('keeps tints lighter and shades darker than the brand color', () => {
    const anchor = rgb('#0b99fc')
    const brand = rgb('#ff5722')
    const tint = mapToBrand(rgb('#cff0ff'), anchor, brand)
    const shade = mapToBrand(rgb('#0a4f86'), anchor, brand)
    const lb = rgbToHsl(brand).l
    expect(rgbToHsl(tint).l).toBeGreaterThan(lb + 0.2)
    expect(rgbToHsl(shade).l).toBeLessThan(lb - 0.1)
    // The hue follows the brand color.
    expect(Math.abs(rgbToHsl(tint).h - rgbToHsl(brand).h)).toBeLessThan(15)
  })

  it('keeps black and white fixed points of the lightness map', () => {
    const anchor = rgb('#0b99fc')
    const brand = rgb('#ff5722')
    // A fully saturated color with the anchor hue at the extremes of lightness.
    expect(rgbToHsl(mapToBrand({ r: 0.995, g: 0.998, b: 1 }, anchor, brand)).l).toBeGreaterThan(
      0.99,
    )
    expect(rgbToHsl(mapToBrand({ r: 0, g: 0.004, b: 0.008 }, anchor, brand)).l).toBeLessThan(0.01)
  })

  it('turns a family gray for a neutral brand color', () => {
    const c = mapToBrand(rgb('#60bfef'), rgb('#0b99fc'), rgb('#777777'))
    expect(chromaOf(c)).toBeLessThan(0.01)
  })
})

describe('planBrandColors', () => {
  it('leaves neutrals alone and recolors the chromatic family', () => {
    const anim = doc([
      fill('#0b99fc'),
      fill('#0b99fc'),
      stroke('#ffffff'),
      fill('#000000'),
      fill('#60bfef'),
    ])
    const plan = planBrandColors(extractColorUsages(anim), [rgb('#ff5722')])
    expect(plan.families).toHaveLength(1)
    expect(plan.families[0].anchor).toBe('#0b99fc')
    expect(plan.families[0].brand).toBe(0)
    expect([...plan.map.keys()].sort()).toEqual(['#0b99fc', '#60bfef'])
    expect(hexOf(plan.map.get('#0b99fc')!)).toBe('#ff5722')
    expect(plan.changes).toBe(3)
  })

  it('anchors a family on its vivid color, not on a more frequent pale tint', () => {
    const tints = Array.from({ length: 6 }, () => fill('#cff0ff'))
    const anim = doc([...tints, fill('#0b99fc'), fill('#0b99fc'), fill('#0b99fc')])
    const plan = planBrandColors(extractColorUsages(anim), [rgb('#ff5722')])
    expect(plan.families[0].anchor).toBe('#0b99fc')
    // The pale tint stays a pale tint of the brand color.
    expect(rgbToHsl(plan.map.get('#cff0ff')!).l).toBeGreaterThan(0.85)
  })

  it('ranks hue families and gives each brand color its own family', () => {
    const anim = doc([
      fill('#0b99fc'),
      fill('#0b99fc'),
      fill('#0b99fc'),
      fill('#1e88e5'),
      fill('#e53935'),
      fill('#e53935'),
      fill('#43a047'),
    ])
    const plan = planBrandColors(extractColorUsages(anim), [rgb('#111111'), rgb('#ffcc00')])
    expect(plan.families.map((f) => f.anchor)).toEqual(['#0b99fc', '#e53935', '#43a047'])
    expect(plan.families.map((f) => f.brand)).toEqual([0, 1, null])
    // Blue and the neighbouring blue are one family; green keeps its color.
    expect(plan.families[0].colors).toEqual(['#0b99fc', '#1e88e5'])
    expect(plan.map.has('#43a047')).toBe(false)
    expect(hexOf(plan.map.get('#e53935')!)).toBe('#ffcc00')
  })

  it('does nothing without brand colors or chromatic colors', () => {
    const anim = doc([fill('#0b99fc')])
    expect(planBrandColors(extractColorUsages(anim), []).map.size).toBe(0)
    const gray = doc([fill('#ffffff'), fill('#222222')])
    const plan = planBrandColors(extractColorUsages(gray), [rgb('#ff5722')])
    expect(plan.families).toHaveLength(0)
    expect(plan.changes).toBe(0)
  })

  it('uses at most three brand colors', () => {
    const anim = doc([fill('#ff0000'), fill('#00ff00'), fill('#0000ff'), fill('#ffff00')])
    const brand = ['#111111', '#222222', '#333333', '#444444'].map(rgb)
    const plan = planBrandColors(extractColorUsages(anim), brand)
    expect(plan.families.filter((f) => f.brand !== null)).toHaveLength(3)
  })
})

/** Applies one brand color to a copy of `source`. */
function apply(source: Animation, brand: string): Animation {
  const usages = extractColorUsages(source)
  return produce(source, (d) => {
    applyBrandPlan(d, usages, planBrandColors(usages, [rgb(brand)]))
  })
}

describe('applyBrandPlan', () => {
  it('recolors fills, strokes and gradient stops consistently', () => {
    const anim = doc([
      gradient(['#cff0ff', '#0b99fc', '#0a4f86']),
      fill('#0b99fc'),
      fill('#0b99fc'),
      stroke('#ffffff'),
    ])
    const usages = extractColorUsages(anim)
    const plan = planBrandColors(usages, [rgb('#ff5722')])
    const next = produce(anim, (d) => {
      applyBrandPlan(d, usages, plan)
    })
    const after = extractColorUsages(next)
    const fills = after.filter((u) => u.kind === 'fill').map((u) => u.hex)
    expect(fills).toEqual(['#ff5722', '#ff5722'])
    expect(after.find((u) => u.kind === 'stroke')?.hex).toBe('#ffffff')
    const [g] = extractGradients(next)
    const l = g.stops.map((s) => rgbToHsl(s.color).l)
    // The ramp keeps its order (light → brand → dark) and its middle stop is the brand color.
    expect(l[0]).toBeGreaterThan(l[1])
    expect(l[1]).toBeGreaterThan(l[2])
    expect(g.stops[1].hex).toBe('#ff5722')
  })

  it('composes: re-applying from a recolored document matches applying to the original', () => {
    const anim = doc([
      gradient(['#cff0ff', '#0b99fc', '#0a4f86']),
      fill('#0b99fc'),
      fill('#60bfef'),
    ])
    const direct = extractColorUsages(apply(anim, '#7c3aed'))
    const twice = extractColorUsages(apply(apply(anim, '#12a150'), '#7c3aed'))
    expect(twice).toHaveLength(direct.length)
    direct.forEach((u, i) => {
      const a = u.color
      const b = twice[i].color
      const d = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
      expect(d * 255, u.hex).toBeLessThanOrEqual(3)
    })
  })

  it('keeps opacity', () => {
    const anim = doc([
      {
        ty: 'fl',
        c: { a: 0, k: [...arr('#0b99fc').slice(0, 3), 1] },
        o: { a: 0, k: 40 },
        r: 1,
      } as ShapeItem,
    ])
    const usages = extractColorUsages(anim)
    const next = produce(anim, (d) => {
      applyBrandPlan(d, usages, planBrandColors(usages, [rgb('#ff5722')]))
    })
    const item = (next.layers[0] as unknown as { shapes: { it: { o: { k: number } }[] }[] })
      .shapes[0].it[0]
    expect(item.o.k).toBe(40)
  })
})

describe('idempotence', () => {
  it('a second application of the same brand colors changes nothing', () => {
    const anim = doc([
      gradient(['#cff0ff', '#0b99fc', '#0a4f86']),
      fill('#0b99fc'),
      fill('#60bfef'),
    ])
    const brand = [rgb('#7c3aed')]
    const usages = extractColorUsages(anim)
    const once = produce(anim, (d) => {
      applyBrandPlan(d, usages, planBrandColors(usages, brand))
    })
    const again = planBrandColors(extractColorUsages(once), brand)
    expect(again.changes).toBe(0)
    expect(again.map.size).toBe(0)
  })
})
