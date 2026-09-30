/**
 * Small pure helpers of the optimizer UI: number precision, the comparison stage geometry and
 * zoom, the shared playhead and number formatting in both languages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import { typicalDecimals } from '../model/numbers'
import { describeBackoffs } from '../ui/backoffs'
import { FrameClock } from '../ui/detail/clock'
import { FIT_VIEW, GAP, PAD, layoutStage, zoomAt } from '../ui/detail/layout'
import { makeFormat } from '../ui/format'

describe('typicalDecimals', () => {
  it('is the median count of decimals of the fractional numbers', () => {
    expect(typicalDecimals('{"a":[1.5,2.25,3.125,4.0625,5.123]}')).toBe(3)
    expect(typicalDecimals('{"a":[1.10,2.2,3.3]}')).toBe(1)
    expect(typicalDecimals('{"a":[1,2,3]}')).toBe(0)
    expect(typicalDecimals('{"x":-0.3333333333,"y":1e-7}')).toBe(10)
  })

  it('ignores base64 data', () => {
    expect(typicalDecimals('{"p":"data:image/png;base64,AAAA1.2345BBBB","k":[1.5]}')).toBe(1)
  })
})

describe('layoutStage', () => {
  const stage = { w: 1000, h: 600 }
  const anim = { w: 512, h: 512 }

  it('fits both artboards side by side at the same scale', () => {
    const l = layoutStage('side', stage, anim, 1, { x: 0, y: 0 })
    expect(l.slots.a.w).toBe(l.slots.b.w)
    expect(l.slots.b.x).toBeCloseTo(l.slots.a.x + l.slots.a.w + GAP)
    expect(l.boards.a).toEqual(l.boards.b)
    // Each half is narrower than it is tall here: the width limits the scale.
    const half = (1000 - PAD.x * 2 - GAP) / 2
    expect(l.scale).toBeCloseTo(Math.min(half, 600 - PAD.top - PAD.bottom) / 512)
    // Centered in its slot.
    expect(l.boards.a.x * 2 + l.boards.a.w).toBeCloseTo(l.slots.a.w)
  })

  it('stacks both artboards in one slot for the swipe and difference views', () => {
    for (const mode of ['swipe', 'difference'] as const) {
      const l = layoutStage(mode, stage, anim, 1, { x: 0, y: 0 })
      expect(l.slots.a).toEqual(l.slots.b)
      expect(l.slots.a.w).toBe(1000 - PAD.x * 2)
    }
  })

  it('zooms around a point, keeping the animation pixel under it in place', () => {
    const l = layoutStage('swipe', stage, anim, 1, { x: 0, y: 0 })
    const point = { x: l.boards.a.x + 100, y: l.boards.a.y + 50 }
    const ax = (point.x - l.boards.a.x) / l.scale
    const ay = (point.y - l.boards.a.y) / l.scale
    const next = zoomAt(l, 2, point)
    const l2 = layoutStage('swipe', stage, anim, next.zoom, next.pan)
    expect(l2.scale).toBeCloseTo(l.scale * 2)
    expect(l2.boards.a.x + ax * l2.scale).toBeCloseTo(point.x)
    expect(l2.boards.a.y + ay * l2.scale).toBeCloseTo(point.y)
  })

  it('clamps the zoom', () => {
    const l = layoutStage('side', stage, anim, 1, { x: 0, y: 0 })
    expect(zoomAt(l, 1000, { x: 0, y: 0 }).zoom).toBe(16)
    expect(zoomAt(l, 0.001, { x: 0, y: 0 }).zoom).toBe(0.25)
    expect(FIT_VIEW).toEqual({ zoom: 1, pan: { x: 0, y: 0 } })
  })
})

describe('FrameClock', () => {
  let now = 0
  let callbacks: FrameRequestCallback[] = []
  beforeEach(() => {
    now = 0
    callbacks = []
    vi.stubGlobal('performance', { now: () => now })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => callbacks.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {
      callbacks = []
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  const tick = (ms: number) => {
    now += ms
    const run = callbacks
    callbacks = []
    for (const cb of run) cb(now)
  }

  it('clamps seeks to the frames that exist (the out point is exclusive)', () => {
    const clock = new FrameClock()
    clock.setRange({ ip: 10, op: 70, fps: 30 })
    clock.seek(5)
    expect(clock.frame).toBe(10)
    clock.seek(200)
    expect(clock.frame).toBe(69)
    clock.step(-5)
    expect(clock.frame).toBe(64)
  })

  it('plays at the frame rate and loops', () => {
    const clock = new FrameClock()
    clock.setRange({ ip: 0, op: 30, fps: 30 })
    const seen: number[] = []
    clock.subscribe((f) => seen.push(f))
    clock.play()
    tick(500)
    expect(clock.frame).toBeCloseTo(15)
    tick(600)
    // 33 frames after the start of a 30-frame animation: frame 3 of the next loop.
    expect(clock.frame).toBeCloseTo(3)
    clock.pause()
    expect(clock.playing).toBe(false)
    expect(seen.length).toBeGreaterThan(2)
  })

  it('starts over when played at the end', () => {
    const clock = new FrameClock()
    clock.setRange({ ip: 0, op: 30, fps: 30 })
    clock.seek(29)
    clock.play()
    expect(clock.frame).toBe(0)
    clock.dispose()
    expect(clock.playing).toBe(false)
  })
})

describe('makeFormat', () => {
  const f = makeFormat('en', en)
  const r = makeFormat('ru', ru)

  it('signs savings with a real minus', () => {
    expect(f.saving(0.238)).toBe('−23.8%')
    expect(f.saving(-0.012)).toBe('+1.2%')
    expect(f.saving(0)).toBe('0.0%')
    expect(r.saving(0.238)).toBe('−23,8 %')
  })

  it('shows tiny shares as "less than" and near-whole ones as whole', () => {
    expect(f.percent(0.0001)).toBe('<0.1%')
    expect(f.percent(0.99996)).toBe('100%')
  })

  it('formats sizes, differences, durations and dimensions', () => {
    expect(f.bytes(2048)).toBe('2.0 KB')
    expect(r.bytes(2048)).toBe('2,0 КБ')
    expect(f.delta(1024)).toBe('−1.0 KB')
    expect(f.delta(-80)).toBe('+80 B')
    expect(f.duration(160)).toBe('160 ms')
    expect(f.duration(1790)).toBe('1.8 s')
    expect(r.duration(160)).toBe('160 мс')
    expect(f.int(1920)).toBe('1920')
    expect(f.px(0.05)).toBe('0.05 px')
  })
})

describe('describeBackoffs', () => {
  it('collapses repeated steps and lists what was turned off', () => {
    const f = makeFormat('en', en)
    expect(
      describeBackoffs(
        [
          { kind: 'imageQuality', from: 0.8, to: 0.95 },
          { kind: 'tolerance', from: 0.2, to: 0.1 },
          { kind: 'tolerance', from: 0.1, to: 0.05 },
          { kind: 'disable', technique: 'paths' },
          { kind: 'disable', technique: 'names' },
        ],
        en,
        f,
      ),
    ).toBe('image quality 80.0% → 95.0%; tolerance 0.2 px → 0.05 px; Paths, Names off')
    expect(
      describeBackoffs([{ kind: 'disable', technique: 'keyframes' }], ru, makeFormat('ru', ru)),
    ).toBe('выключено: Ключевые кадры')
  })
})
