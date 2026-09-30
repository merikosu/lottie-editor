import { describe, expect, it } from 'vitest'
import { currentFormat, designArea, formatCanvas } from '../lib/formats'

describe('canvas formats', () => {
  it('adds space on one axis to reach the aspect ratio', () => {
    const square = { w: 512, h: 512 }
    expect(formatCanvas(square, 'landscape')).toEqual({ w: 910, h: 512 })
    expect(formatCanvas(square, 'portrait')).toEqual({ w: 512, h: 910 })
    expect(formatCanvas(square, 'social')).toEqual({ w: 512, h: 640 })
    expect(formatCanvas(square, 'square')).toEqual(square)
    const wide = { w: 1920, h: 1080 }
    expect(formatCanvas(wide, 'square')).toEqual({ w: 1920, h: 1920 })
    expect(formatCanvas(wide, 'landscape')).toEqual(wide)
  })

  it('finds the design area inside a formatted canvas', () => {
    const original = { w: 512, h: 512 }
    expect(designArea(original, { w: 910, h: 512 })).toEqual({ w: 512, h: 512 })
    expect(designArea(original, { w: 512, h: 910 })).toEqual({ w: 512, h: 512 })
    // Scaled uniformly: the area scales with it.
    expect(designArea(original, { w: 1024, h: 1820 })).toEqual({ w: 1024, h: 1024 })
  })

  it('switches between formats without growing the canvas', () => {
    const original = { w: 512, h: 512 }
    let canvas = formatCanvas(designArea(original, original), 'landscape')
    canvas = formatCanvas(designArea(original, canvas), 'portrait')
    expect(canvas).toEqual({ w: 512, h: 910 })
    canvas = formatCanvas(designArea(original, canvas), 'original')
    expect(canvas).toEqual(original)
  })

  it('recognizes the current format', () => {
    const original = { w: 800, h: 600 }
    expect(currentFormat(original, original)).toBe('original')
    expect(currentFormat(original, { w: 800, h: 800 })).toBe('square')
    expect(currentFormat(original, { w: 1067, h: 600 })).toBe('landscape')
    expect(currentFormat(original, { w: 700, h: 300 })).toBeNull()
  })
})
