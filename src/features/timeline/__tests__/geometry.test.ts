import { describe, expect, it } from 'vitest'
import { setNumberLocale } from '@/lib/format'
import {
  clampPpf,
  contentWidth,
  fitPpf,
  formatFrame,
  formatTickLabel,
  frameToX,
  MAX_PPF,
  nearestTarget,
  ppfToSlider,
  sliderToPpf,
  snapDelta,
  tickSpec,
  ticksInRange,
  TRACK_PAD,
  uniqueSorted,
  xToFrame,
  zoomLimits,
} from '../geometry'

describe('frame ↔ x', () => {
  it('round-trips and starts after the padding', () => {
    expect(frameToX(10, 10, 4)).toBe(TRACK_PAD)
    expect(frameToX(20, 10, 4)).toBe(TRACK_PAD + 40)
    for (const f of [-5, 0, 12.5, 179])
      expect(xToFrame(frameToX(f, 3, 7.5), 3, 7.5)).toBeCloseTo(f, 9)
  })

  it('sizes the content with padding on both sides', () => {
    expect(contentWidth(0, 60, 10)).toBe(TRACK_PAD * 2 + 600)
    // Degenerate ranges still get one frame of room.
    expect(contentWidth(5, 5, 10)).toBe(TRACK_PAD * 2 + 10)
  })
})

describe('zoom', () => {
  it('fits the whole range into the view', () => {
    const ppf = fitPpf(1000, 0, 100)
    expect(contentWidth(0, 100, ppf)).toBeCloseTo(1000, 6)
    expect(fitPpf(0, 0, 100)).toBeGreaterThan(0)
  })

  it('limits zoom between "fit" and the maximum', () => {
    const limits = zoomLimits(800, 0, 60)
    expect(limits.min).toBeCloseTo(fitPpf(800, 0, 60), 6)
    expect(limits.max).toBe(MAX_PPF)
    expect(clampPpf(0.001, limits)).toBe(limits.min)
    expect(clampPpf(1000, limits)).toBe(MAX_PPF)
    // A very short animation in a wide view: fit exceeds the usual maximum.
    const short = zoomLimits(4000, 0, 2)
    expect(short.min).toBe(MAX_PPF)
    expect(short.max).toBe(MAX_PPF)
  })

  it('maps zoom to a logarithmic slider and back', () => {
    const limits = { min: 2, max: 64 }
    expect(ppfToSlider(2, limits)).toBeCloseTo(0, 9)
    expect(ppfToSlider(64, limits)).toBeCloseTo(100, 9)
    expect(ppfToSlider(8, limits)).toBeCloseTo(40, 9)
    for (const v of [0, 13, 50, 99])
      expect(ppfToSlider(sliderToPpf(v, limits), limits)).toBeCloseTo(v, 9)
    expect(sliderToPpf(50, { min: 5, max: 5 })).toBe(5)
    expect(ppfToSlider(5, { min: 5, max: 5 })).toBe(0)
  })
})

describe('ruler ticks', () => {
  it('keeps labels apart and minor ticks legible (frames)', () => {
    for (const ppf of [0.2, 0.9, 3, 6.4, 19, 40, 96]) {
      const { minor, major } = tickSpec(ppf, 30, 'frames')
      expect(minor * ppf).toBeGreaterThanOrEqual(6)
      expect(major * ppf).toBeGreaterThanOrEqual(52)
      expect(major % minor).toBe(0)
    }
    expect(tickSpec(19, 30, 'frames')).toEqual({ minor: 1, major: 5 })
    expect(tickSpec(96, 30, 'frames')).toEqual({ minor: 1, major: 1 })
  })

  it('puts seconds labels on round times', () => {
    const at30 = tickSpec(3, 30, 'seconds')
    // 1 s = 90 px: labels every second, minor ticks subdivide evenly.
    expect(at30.major).toBe(30)
    expect(at30.major % at30.minor).toBe(0)
    const zoomedOut = tickSpec(0.2, 60, 'seconds')
    expect(zoomedOut.major / 60).toBeGreaterThanOrEqual(5)
    const zoomedIn = tickSpec(90, 60, 'seconds')
    // Never below one frame.
    expect(zoomedIn.major).toBeGreaterThanOrEqual(1)
  })

  it('lists aligned ticks in a range', () => {
    expect(ticksInRange(3, 21, 5)).toEqual([5, 10, 15, 20])
    expect(ticksInRange(0, 10, 5)).toEqual([0, 5, 10])
    expect(ticksInRange(1, 2, 0.5)).toEqual([1, 1.5, 2])
    expect(ticksInRange(10, 0, 5)).toEqual([])
    expect(ticksInRange(0, 10, 0)).toEqual([])
    expect(ticksInRange(-7, 7, 5, 1)).toEqual([-4, 1, 6])
  })

  it('formats labels in frames or seconds', () => {
    expect(formatTickLabel(45, 30, 'frames', 's')).toBe('45')
    expect(formatTickLabel(45, 30, 'seconds', 's')).toBe('1.5s')
    expect(formatTickLabel(0, 30, 'seconds', 'с')).toBe('0с')
    expect(formatTickLabel(90 * 30, 30, 'seconds', 's')).toBe('1:30')
    expect(formatTickLabel(12, 0, 'seconds', 's')).toBe('12')
  })
})

describe('snapping', () => {
  it('finds the nearest target within the threshold', () => {
    expect(nearestTarget(10.4, [0, 10, 20], 0.5)).toBe(10)
    expect(nearestTarget(10.6, [0, 10, 20], 0.5)).toBeNull()
    expect(nearestTarget(15, [10, 20], 5)).toBe(20)
  })

  it('snaps a group by the anchor closest to a target', () => {
    // Anchors 10 and 30 move by 4.6: 34.6 is 0.4 from 35, 14.6 is 0.6 from 15.
    expect(snapDelta([10, 30], 4.6, [15, 35], 1)).toEqual({ delta: 5, target: 35 })
    expect(snapDelta([10], 4, [30], 1)).toEqual({ delta: 4, target: null })
  })

  it('dedupes and formats frames', () => {
    expect(uniqueSorted([3, 1, 2, 1.0000001, 3])).toEqual([1, 2, 3])
    expect(formatFrame(12)).toBe('12')
    expect(formatFrame(12.345)).toBe('12.35')
    expect(formatFrame(-0.001)).toBe('0')
    expect(formatFrame(-2.5)).toBe('-2.5')
  })

  it('uses the decimal comma in Russian', () => {
    setNumberLocale('ru')
    try {
      expect(formatFrame(12.345)).toBe('12,35')
      expect(formatFrame(-0.001)).toBe('0')
      expect(formatTickLabel(45, 30, 'seconds', 'с')).toBe('1,5с')
      expect(formatTickLabel(45, 30, 'frames', 'с')).toBe('45')
    } finally {
      setNumberLocale('en')
    }
  })
})
