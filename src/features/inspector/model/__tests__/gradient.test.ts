import { describe, expect, it } from 'vitest'
import {
  alphaAt,
  colorAt,
  cssGradient,
  hasAlignedOpacity,
  insertOpacityStop,
  insertStop,
  mapGradientValues,
  matchOpacityStructure,
  parseStops,
  removeOpacityStop,
  removeStop,
  serializeStops,
  setOpacityStop,
  setStopAlpha,
  setStopColor,
  setStopOffset,
  sortStops,
  stopAlpha,
} from '../gradient'

// test.json "Gradient_lnRotIlmmE": 5 color stops + 5 aligned opacity stops.
const ALIGNED = [
  0, 1, 0.745, 0.553, 0.198, 1, 0.812, 0.625, 0.396, 1, 0.878, 0.698, 0.698, 1, 0.925, 0.739, 1, 1,
  0.973, 0.78, 0, 0.5, 0.198, 0.75, 0.396, 1, 0.698, 1, 1, 1,
]
const TWO = [0, 1, 0, 0, 1, 0, 0, 1]

describe('parse / serialize', () => {
  it('parses color and opacity stops', () => {
    const s = parseStops(ALIGNED, 5)
    expect(s.colors).toHaveLength(5)
    expect(s.colors[1]).toEqual({ offset: 0.198, color: [1, 0.812, 0.625] })
    expect(s.opacities).toHaveLength(5)
    expect(s.opacities[0]).toEqual({ offset: 0, alpha: 0.5 })
    expect(hasAlignedOpacity(s)).toBe(true)
  })
  it('round-trips exactly', () => {
    expect(serializeStops(parseStops(ALIGNED, 5))).toEqual(ALIGNED)
    expect(serializeStops(parseStops(TWO, 2))).toEqual(TWO)
  })
  it('tolerates a count larger than the data', () => {
    const s = parseStops(TWO, 9)
    expect(s.colors).toHaveLength(2)
    expect(s.opacities).toEqual([])
  })
  it('detects unaligned opacity stops', () => {
    const s = parseStops([...TWO, 0.5, 0.2, 1, 1], 2)
    expect(s.opacities).toEqual([
      { offset: 0.5, alpha: 0.2 },
      { offset: 1, alpha: 1 },
    ])
    expect(hasAlignedOpacity(s)).toBe(false)
  })
})

describe('sampling', () => {
  const s = parseStops(TWO, 2)
  it('interpolates colors and clamps outside the stops', () => {
    expect(colorAt(s, 0.5)).toEqual([0.5, 0, 0.5])
    expect(colorAt(s, -1)).toEqual([1, 0, 0])
    expect(colorAt(s, 2)).toEqual([0, 0, 1])
  })
  it('handles unsorted stops', () => {
    const rev = parseStops([1, 0, 0, 1, 0, 1, 0, 0], 2)
    expect(colorAt(rev, 0.25)).toEqual([0.75, 0, 0.25])
  })
  it('interpolates opacity (1 without opacity stops)', () => {
    expect(alphaAt(s, 0.3)).toBe(1)
    const withAlpha = parseStops([...TWO, 0, 0, 1, 1], 2)
    expect(alphaAt(withAlpha, 0.25)).toBeCloseTo(0.25)
  })
  it('builds a CSS preview with every offset', () => {
    const css = cssGradient(parseStops([...TWO, 0, 0, 0.5, 1], 2))
    expect(css).toBe(
      'linear-gradient(90deg, rgba(255, 0, 0, 0) 0%, rgba(128, 0, 128, 1) 50%, rgba(0, 0, 255, 1) 100%)',
    )
  })
  it('duplicates a single stop to fill the bar', () => {
    expect(cssGradient({ colors: [{ offset: 0.5, color: [0, 0, 0] }], opacities: [] })).toBe(
      'linear-gradient(90deg, rgba(0, 0, 0, 1) 50%, rgba(0, 0, 0, 1) 100%)',
    )
  })
})

describe('editing color stops', () => {
  it('moves aligned opacity stops with their color stop', () => {
    const s = setStopOffset(parseStops(ALIGNED, 5), 1, 0.3)
    expect(s.colors[1].offset).toBe(0.3)
    expect(s.opacities[1].offset).toBe(0.3)
    expect(hasAlignedOpacity(s)).toBe(true)
  })
  it('clamps offsets', () => {
    expect(setStopOffset(parseStops(TWO, 2), 0, -3).colors[0].offset).toBe(0)
  })
  it('sorts stops and tracks the moved index', () => {
    const moved = setStopOffset(parseStops(ALIGNED, 5), 0, 0.5)
    const { stops, index } = sortStops(moved, 0)
    expect(stops.colors.map((c) => c.offset)).toEqual([0.198, 0.396, 0.5, 0.698, 1])
    expect(index).toBe(2)
    // The opacity stop travelled with it.
    expect(stops.opacities[2]).toEqual({ offset: 0.5, alpha: 0.5 })
  })
  it('sets colors without touching other stops', () => {
    const s = setStopColor(parseStops(TWO, 2), 1, [0, 1, 0])
    expect(s.colors[1].color).toEqual([0, 1, 0])
    expect(s.colors[0].color).toEqual([1, 0, 0])
  })
  it('inserts a stop keeping the look', () => {
    const { stops, index } = insertStop(parseStops(TWO, 2), 0.5)
    expect(index).toBe(1)
    expect(stops.colors[1]).toEqual({ offset: 0.5, color: [0.5, 0, 0.5] })
  })
  it('inserts aligned opacity stops too', () => {
    const { stops } = insertStop(parseStops(ALIGNED, 5), 0.1)
    expect(stops.colors).toHaveLength(6)
    expect(stops.opacities).toHaveLength(6)
    expect(hasAlignedOpacity(stops)).toBe(true)
    expect(stops.opacities[1].alpha).toBeCloseTo(0.5 + (0.25 * 0.1) / 0.198)
  })
  it('removes stops but keeps at least two', () => {
    const s = removeStop(parseStops(ALIGNED, 5), 2)
    expect(s.colors).toHaveLength(4)
    expect(s.opacities).toHaveLength(4)
    expect(removeStop(parseStops(TWO, 2), 0).colors).toHaveLength(2)
  })
})

describe('stop opacity', () => {
  it('creates aligned opacity stops when there are none', () => {
    const s = setStopAlpha(parseStops(TWO, 2), 1, 0.4)
    expect(s.opacities).toEqual([
      { offset: 0, alpha: 1 },
      { offset: 1, alpha: 0.4 },
    ])
    expect(stopAlpha(s, 1)).toBe(0.4)
  })
  it('edits aligned opacity stops in place', () => {
    const s = setStopAlpha(parseStops(ALIGNED, 5), 0, 1)
    expect(s.opacities[0].alpha).toBe(1)
    expect(stopAlpha(s, 0)).toBe(1)
  })
  it('adds an opacity stop at the color stop offset when unaligned', () => {
    const base = parseStops([...TWO, 0.5, 0.2, 1, 1], 2)
    expect(stopAlpha(base, 0)).toBeCloseTo(0.2)
    const s = setStopAlpha(base, 0, 0.9)
    expect(s.opacities).toEqual([
      { offset: 0, alpha: 0.9 },
      { offset: 0.5, alpha: 0.2 },
      { offset: 1, alpha: 1 },
    ])
  })
  it('edits, inserts and removes independent opacity stops', () => {
    let s = parseStops([...TWO, 0, 1, 1, 0], 2)
    s = setOpacityStop(s, 1, { alpha: 0.5, offset: 2 })
    expect(s.opacities[1]).toEqual({ offset: 1, alpha: 0.5 })
    const inserted = insertOpacityStop(s, 0.5)
    expect(inserted.index).toBe(1)
    expect(inserted.stops.opacities[1].alpha).toBeCloseTo(0.75)
    expect(removeOpacityStop(inserted.stops, 1).opacities).toHaveLength(2)
    expect(removeOpacityStop(s, 0).opacities).toHaveLength(2)
  })
})

describe('mapGradientValues', () => {
  it('applies a structural edit to every keyframe value', () => {
    const k0 = TWO
    const k1 = [0, 0, 1, 0, 1, 1, 1, 1]
    const out = mapGradientValues([k0, k1], 2, (s) => insertStop(s, 0.5).stops)
    expect(out[0]).toEqual([0, 1, 0, 0, 0.5, 0.5, 0, 0.5, 1, 0, 0, 1])
    expect(out[1]).toEqual([0, 0, 1, 0, 0.5, 0.5, 1, 0.5, 1, 1, 1, 1])
    expect(out.every((v) => v.length === 12)).toBe(true)
  })
})

describe('matchOpacityStructure', () => {
  it('gives other keyframes opaque aligned stops when opacity was added to every color stop', () => {
    const current = parseStops(TWO, 2)
    const next = setStopAlpha(current, 1, 0.25)
    const other = parseStops([0, 0, 0, 1, 0.8, 1, 1, 1], 2)
    const matched = matchOpacityStructure(other, next)
    expect(matched.opacities).toEqual([
      { offset: 0, alpha: 1 },
      { offset: 0.8, alpha: 1 },
    ])
    expect(serializeStops(matched)).toHaveLength(serializeStops(next).length)
  })
  it('inserts the new unaligned opacity stops, keeping the look', () => {
    const base = {
      colors: parseStops(TWO, 2).colors,
      opacities: [
        { offset: 0, alpha: 1 },
        { offset: 1, alpha: 0.5 },
      ],
    }
    const next = insertOpacityStop(base, 0.5).stops
    const other = {
      ...base,
      opacities: [
        { offset: 0, alpha: 0.2 },
        { offset: 1, alpha: 0.6 },
      ],
    }
    const matched = matchOpacityStructure(other, next)
    expect(matched.opacities).toHaveLength(3)
    expect(matched.opacities[1].offset).toBe(0.5)
    expect(matched.opacities[1].alpha).toBeCloseTo(alphaAt(other, 0.5))
  })
  it('leaves keyframes that already match alone', () => {
    const s = parseStops(ALIGNED, 5)
    expect(matchOpacityStructure(s, s)).toBe(s)
  })
})
