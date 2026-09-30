import { describe, expect, it } from 'vitest'
import {
  ESTIMATE_BUDGET_MS,
  MAX_AREA,
  MAX_SIDE,
  samplesWithinBudget,
  frameFileName,
  gifDelays,
  gifFps,
  gifRepeat,
  lastFrameOf,
  outputFrameCount,
  presetScale,
  rangeSeconds,
  resolveRange,
  resolveSize,
  sampleTimes,
  spreadIndices,
} from '../plan'

describe('resolveRange', () => {
  const doc = { ip: 0, op: 60 }

  it('uses the whole animation by default', () => {
    expect(resolveRange(doc, { start: 10, end: 20 }, 'all')).toEqual({ start: 0, end: 60 })
  })

  it('uses the work area when asked for', () => {
    expect(resolveRange(doc, { start: 10, end: 20 }, 'workArea')).toEqual({ start: 10, end: 20 })
  })

  it('falls back to the whole animation without a work area', () => {
    expect(resolveRange(doc, null, 'workArea')).toEqual({ start: 0, end: 60 })
  })

  it('clamps the work area to the animation', () => {
    expect(resolveRange({ ip: 5, op: 50 }, { start: 0, end: 80 }, 'workArea')).toEqual({
      start: 5,
      end: 50,
    })
  })

  it('ignores an empty or inverted work area', () => {
    expect(resolveRange(doc, { start: 30, end: 30 }, 'workArea')).toEqual({ start: 0, end: 60 })
    expect(resolveRange(doc, { start: 70, end: 90 }, 'workArea')).toEqual({ start: 0, end: 60 })
  })
})

describe('frame sampling', () => {
  it('renders every frame at the composition rate', () => {
    expect(sampleTimes({ start: 0, end: 5 }, 30, 30)).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps the start offset of a work area', () => {
    expect(sampleTimes({ start: 10, end: 13 }, 30, 30)).toEqual([10, 11, 12])
  })

  it('renders half frames when exporting faster than the composition', () => {
    expect(sampleTimes({ start: 0, end: 3 }, 30, 60)).toEqual([0, 0.5, 1, 1.5, 2, 2.5])
  })

  it('skips evenly when exporting slower than the composition', () => {
    expect(sampleTimes({ start: 0, end: 60 }, 30, 24).slice(0, 5)).toEqual([0, 1.25, 2.5, 3.75, 5])
    expect(outputFrameCount({ start: 0, end: 60 }, 30, 24)).toBe(48)
  })

  it('snaps float noise to whole frames', () => {
    const times = sampleTimes({ start: 0, end: 179 }, 60, 30)
    for (const t of times) expect(Number.isInteger(t)).toBe(true)
    expect(times).toHaveLength(90)
  })

  it('repeats the range', () => {
    expect(sampleTimes({ start: 0, end: 3 }, 30, 30, 3)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2])
  })

  it('always produces at least one frame', () => {
    expect(sampleTimes({ start: 0, end: 0.2 }, 30, 30)).toEqual([0])
  })

  it('reports duration and the last frame', () => {
    expect(rangeSeconds({ start: 0, end: 179 }, 60)).toBeCloseTo(2.9833, 3)
    expect(lastFrameOf({ start: 0, end: 60 })).toBe(59)
    expect(lastFrameOf({ start: 0, end: 59.5 })).toBe(59)
  })

  it('spreads sample indices over the whole range', () => {
    expect(spreadIndices(100, 5)).toEqual([0, 25, 50, 74, 99])
    expect(spreadIndices(3, 8)).toEqual([0, 1, 2])
    expect(spreadIndices(10, 1)).toEqual([0])
    expect(spreadIndices(0, 4)).toEqual([])
  })
})

describe('resolveSize', () => {
  const square = { w: 512, h: 512 }

  it('applies scale presets', () => {
    expect(resolveSize(square, { preset: '2x', width: 0, height: 0 })).toEqual({
      width: 1024,
      height: 1024,
      adjusted: false,
    })
    expect(resolveSize(square, { preset: '0.5x', width: 0, height: 0 })).toMatchObject({
      width: 256,
      height: 256,
    })
  })

  it('scales the short side for resolution presets', () => {
    expect(resolveSize(square, { preset: '1080p', width: 0, height: 0 })).toMatchObject({
      width: 1080,
      height: 1080,
    })
    expect(
      resolveSize({ w: 1920, h: 1080 }, { preset: '720p', width: 0, height: 0 }),
    ).toMatchObject({ width: 1280, height: 720 })
    expect(
      resolveSize({ w: 1080, h: 1920 }, { preset: '1080p', width: 0, height: 0 }),
    ).toMatchObject({ width: 1080, height: 1920 })
    expect(presetScale('4k', 400, 300)).toBeCloseTo(7.2)
  })

  it('uses custom sizes as given', () => {
    expect(resolveSize(square, { preset: 'custom', width: 640, height: 360 })).toEqual({
      width: 640,
      height: 360,
      adjusted: false,
    })
  })

  it('rounds down to even sizes for video', () => {
    expect(
      resolveSize({ w: 513, h: 301 }, { preset: '1x', width: 0, height: 0 }, { even: true }),
    ).toEqual({
      width: 512,
      height: 300,
      adjusted: true,
    })
    expect(
      resolveSize(square, { preset: '1x', width: 0, height: 0 }, { even: true }).adjusted,
    ).toBe(false)
  })

  it('keeps sizes within the canvas limits and the aspect ratio', () => {
    const big = resolveSize({ w: 4000, h: 1000 }, { preset: '4x', width: 0, height: 0 })
    expect(big.adjusted).toBe(true)
    expect(big.width).toBeLessThanOrEqual(MAX_SIDE)
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_AREA)
    expect(big.width / big.height).toBeCloseTo(4, 1)
    const area = resolveSize(square, { preset: 'custom', width: 8000, height: 8000 })
    expect(area.width * area.height).toBeLessThanOrEqual(MAX_AREA)
  })

  it('never returns an empty size', () => {
    expect(resolveSize({ w: 0, h: -5 }, { preset: '1x', width: 0, height: 0 })).toMatchObject({
      width: 512,
      height: 512,
    })
    expect(resolveSize(square, { preset: 'custom', width: Number.NaN, height: 0 })).toMatchObject({
      width: 512,
      height: 512,
    })
    expect(
      resolveSize({ w: 1, h: 1 }, { preset: '0.5x', width: 0, height: 0 }, { even: true }),
    ).toMatchObject({
      width: 2,
      height: 2,
    })
  })
})

describe('GIF timing', () => {
  it('alternates delays so 30 fps stays exact', () => {
    const delays = gifDelays(30, 30)
    expect(delays.slice(0, 6)).toEqual([3, 4, 3, 3, 4, 3])
    expect(delays.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('keeps 24 fps exact', () => {
    const delays = gifDelays(24, 24)
    expect(delays.slice(0, 6)).toEqual([4, 4, 5, 4, 4, 4])
    expect(delays.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('caps the frame rate at 50 fps (2 cs)', () => {
    expect(gifFps(60)).toBe(50)
    expect(gifDelays(5, 60)).toEqual([2, 2, 2, 2, 2])
    expect(gifDelays(4, 25)).toEqual([4, 4, 4, 4])
  })

  it('maps play counts to the loop extension', () => {
    expect(gifRepeat(0)).toBe(0)
    expect(gifRepeat(1)).toBe(-1)
    expect(gifRepeat(3)).toBe(2)
    expect(gifRepeat(1e9)).toBe(65535)
  })
})

describe('frameFileName', () => {
  it('pads to at least four digits', () => {
    expect(frameFileName('bounce', 7, 60)).toBe('bounce_0007.png')
  })

  it('pads to the largest index', () => {
    expect(frameFileName('a', 5, 12_000)).toBe('a_00005.png')
    expect(frameFileName('a', 11_999, 12_000)).toBe('a_11999.png')
  })
})

describe('estimate sampling', () => {
  it('takes every sample for cheap frames and fewer for heavy ones', () => {
    expect(samplesWithinBudget(5, 2, 3)).toBe(3)
    expect(samplesWithinBudget(300, 2, 3)).toBe(2)
    expect(samplesWithinBudget(450, 4, 3)).toBe(1)
    expect(samplesWithinBudget(5000, 4, 3)).toBe(1)
    expect(samplesWithinBudget(0, 4, 3)).toBe(3)
    expect(samplesWithinBudget(100, 1, 20, ESTIMATE_BUDGET_MS)).toBe(12)
  })
})
