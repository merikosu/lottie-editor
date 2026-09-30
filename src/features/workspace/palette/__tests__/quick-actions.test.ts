import { describe, expect, it } from 'vitest'
import { parseQuickActions, type FrameAction } from '../quick-actions'

const doc = { ip: 0, op: 120, fr: 60 }
const frameOf = (q: string, d = doc) => {
  const [a] = parseQuickActions(q, d)
  return a?.kind === 'frame' ? a : null
}

describe('parseQuickActions: frames', () => {
  it('reads a bare number as a frame', () => {
    expect(frameOf('42')).toEqual<FrameAction>({
      kind: 'frame',
      frame: 42,
      seconds: undefined,
      inRange: true,
      first: 0,
      last: 119,
    })
  })

  it('accepts frame prefixes and suffixes in English and Russian', () => {
    for (const q of ['f42', '42f', '#42', 'frame 42', '42 frames', 'кадр 42', '42 кадр', '42к']) {
      expect(frameOf(q)?.frame, q).toBe(42)
    }
  })

  it('flags frames outside the animation', () => {
    expect(frameOf('120')).toMatchObject({ frame: 120, inRange: false, last: 119 })
    expect(frameOf('5', { ip: 10, op: 50, fr: 30 })).toMatchObject({
      inRange: false,
      first: 10,
      last: 49,
    })
  })

  it('handles fractional in/out points', () => {
    expect(frameOf('0', { ip: 0.5, op: 10.5, fr: 30 })).toMatchObject({
      first: 1,
      last: 10,
      inRange: false,
    })
  })

  it('converts seconds and timecodes with the document frame rate', () => {
    expect(frameOf('1s')).toMatchObject({ frame: 60, seconds: 1 })
    expect(frameOf('0.5 sec')).toMatchObject({ frame: 30, seconds: 0.5 })
    expect(frameOf('1,5 с')).toMatchObject({ frame: 90, seconds: 1.5 })
    expect(frameOf('0:01.5')).toMatchObject({ frame: 90, seconds: 1.5 })
    expect(frameOf('1:00')).toMatchObject({ frame: 3600, inRange: false })
  })

  it('falls back to 30 fps when the frame rate is invalid', () => {
    expect(frameOf('1s', { ip: 0, op: 100, fr: 0 })).toMatchObject({ frame: 30 })
  })

  it('returns nothing without a document or for words', () => {
    expect(parseQuickActions('42', null)).toEqual([])
    expect(parseQuickActions('zoom', doc)).toEqual([])
    expect(parseQuickActions('   ', doc)).toEqual([])
    expect(parseQuickActions('-5', doc)).toEqual([])
  })
})

const speedOf = (q: string) => {
  const [a] = parseQuickActions(q, doc)
  return a?.kind === 'speed' ? a.speed : null
}

describe('parseQuickActions: speed', () => {
  it('reads multipliers', () => {
    expect(speedOf('1.5x')).toBe(1.5)
    expect(speedOf('2×')).toBe(2)
    expect(speedOf('x0.5')).toBe(0.5)
    expect(speedOf('0,75x')).toBe(0.75)
  })

  it('reads the speed keyword with percent or multiplier', () => {
    expect(speedOf('speed 75%')).toBe(0.75)
    expect(speedOf('speed 75')).toBe(0.75)
    expect(speedOf('speed 2')).toBe(2)
    expect(speedOf('скорость 0,5')).toBe(0.5)
    expect(speedOf('Speed: 3x')).toBe(3)
  })

  it('ignores speeds outside the preview range', () => {
    expect(speedOf('100x')).toBeNull()
    expect(speedOf('speed 1%')).toBeNull()
  })
})
