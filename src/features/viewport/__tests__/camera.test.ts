import { describe, expect, it } from 'vitest'
import { setNumberLocale } from '@/lib/format'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_PRESETS,
  artboardLayout,
  clampZoom,
  constrainCamera,
  docToLayout,
  docToView,
  fitPadding,
  fitRect,
  formatZoom,
  layoutToDoc,
  panBy,
  sameZoom,
  stepZoom,
  viewToDoc,
  wheelPanDelta,
  wheelZoomFactor,
  zoomAt,
  type Camera,
} from '../lib/camera'

const view = { width: 800, height: 600 }
const doc = { width: 512, height: 512 }

describe('zoom levels', () => {
  it('clamps to 5%–6400% and survives garbage', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(NaN)).toBe(1)
    expect(clampZoom(1.5)).toBe(1.5)
  })

  it('steps through presets, skipping near-equal ones', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
    expect(stepZoom(1.005, 1)).toBe(1.5) // 100.5% ≈ 100%: skip to the next preset
    expect(stepZoom(0.8, 1)).toBe(1)
    expect(stepZoom(0.8, -1)).toBe(0.75)
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
    expect(ZOOM_PRESETS[0]).toBe(MIN_ZOOM)
    expect(ZOOM_PRESETS[ZOOM_PRESETS.length - 1]).toBe(MAX_ZOOM)
  })

  it('compares zooms by displayed percentage', () => {
    expect(sameZoom(1, 1.0005)).toBe(true)
    expect(sameZoom(1, 1.01)).toBe(false)
  })

  it('formats percentages', () => {
    expect(formatZoom(1)).toBe('100%')
    expect(formatZoom(0.125)).toBe('13%')
    expect(formatZoom(1 / 3)).toBe('33%')
    expect(formatZoom(0.672)).toBe('67%')
    expect(formatZoom(0.075)).toBe('7.5%')
    expect(formatZoom(0.0999)).toBe('10%')
    expect(formatZoom(0.05)).toBe('5%')
    expect(formatZoom(64)).toBe('6400%')
    expect(formatZoom(1.2345)).toBe('123%')
    expect(formatZoom(Infinity)).toBe('—')
    setNumberLocale('ru')
    try {
      expect(formatZoom(0.075)).toBe('7,5%')
      expect(formatZoom(1)).toBe('100%')
    } finally {
      setNumberLocale('en')
    }
  })
})

describe('fit', () => {
  it('fits and centers the rect with padding', () => {
    const cam = fitRect({ x: 0, y: 0, width: 512, height: 512 }, view, { padding: 44 })
    expect(cam.cx).toBe(256)
    expect(cam.cy).toBe(256)
    expect(cam.zoom).toBeCloseTo((600 - 88) / 512, 10)
  })

  it('uses the limiting dimension', () => {
    const cam = fitRect({ x: 100, y: 50, width: 1920, height: 1080 }, view, { padding: 0 })
    expect(cam.zoom).toBeCloseTo(800 / 1920, 10)
    expect(cam.cx).toBe(100 + 960)
    expect(cam.cy).toBe(50 + 540)
  })

  it('respects maxZoom and clamps extreme fits', () => {
    expect(fitRect({ x: 0, y: 0, width: 1, height: 1 }, view, { maxZoom: 16 }).zoom).toBe(16)
    expect(fitRect({ x: 0, y: 0, width: 0.001, height: 0.001 }, view).zoom).toBe(MAX_ZOOM)
    expect(fitRect({ x: 0, y: 0, width: 1e7, height: 1e7 }, view).zoom).toBe(MIN_ZOOM)
  })

  it('survives zero-size rects and tiny views', () => {
    const cam = fitRect({ x: 5, y: 5, width: 0, height: 0 }, { width: 10, height: 10 })
    expect(Number.isFinite(cam.zoom)).toBe(true)
    expect(cam.cx).toBe(5)
  })

  it('padding scales with the view but stays within 16–48 px', () => {
    expect(fitPadding({ width: 100, height: 100 })).toBe(16)
    expect(fitPadding({ width: 600, height: 500 })).toBe(30)
    expect(fitPadding({ width: 3000, height: 2000 })).toBe(48)
  })
})

describe('view mapping', () => {
  const cam: Camera = { zoom: 2, cx: 256, cy: 256 }

  it('maps the camera center to the view center', () => {
    expect(docToView(cam, view, { x: 256, y: 256 })).toEqual({ x: 400, y: 300 })
    expect(docToView(cam, view, { x: 0, y: 0 })).toEqual({ x: 400 - 512, y: 300 - 512 })
  })

  it('round-trips view ↔ doc', () => {
    const p = viewToDoc(cam, view, { x: 123, y: 456 })
    const back = docToView(cam, view, p)
    expect(back.x).toBeCloseTo(123, 10)
    expect(back.y).toBeCloseTo(456, 10)
  })

  it('zoomAt keeps the anchor point fixed', () => {
    const anchor = { x: 150, y: 420 }
    const before = viewToDoc(cam, view, anchor)
    const next = zoomAt(cam, view, anchor, 5)
    expect(next.zoom).toBe(5)
    const after = viewToDoc(next, view, anchor)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('zoomAt clamps the zoom', () => {
    expect(zoomAt(cam, view, { x: 0, y: 0 }, 1e6).zoom).toBe(MAX_ZOOM)
  })

  it('panBy moves content with the pointer', () => {
    const next = panBy(cam, 20, -10)
    expect(docToView(next, view, { x: 256, y: 256 })).toEqual({ x: 420, y: 290 })
  })
})

describe('constrainCamera', () => {
  it('leaves visible artboards alone (same instance)', () => {
    const cam: Camera = { zoom: 1, cx: 256, cy: 256 }
    expect(constrainCamera(cam, view, doc)).toBe(cam)
  })

  it('pulls a lost artboard back so a margin stays visible', () => {
    const lost: Camera = { zoom: 1, cx: 5000, cy: -4000 }
    const c = constrainCamera(lost, view, doc, 48)
    const left = docToView(c, view, { x: 0, y: 0 })
    const right = docToView(c, view, { x: 512, y: 512 })
    // The artboard's right edge is ≥ 48px inside the left side, its top ≤ 48px above the bottom.
    expect(right.x).toBeCloseTo(48, 6)
    expect(left.y).toBeCloseTo(600 - 48, 6)
  })

  it('small artboards must stay fully reachable', () => {
    const tiny: Camera = { zoom: 0.05, cx: 100000, cy: 256 }
    const c = constrainCamera(tiny, view, doc, 48)
    const tl = docToView(c, view, { x: 0, y: 0 })
    // 512 * 0.05 = 25.6px wide artboard: all of it stays inside
    expect(tl.x + 25.6).toBeGreaterThanOrEqual(25.6 - 1e-6)
  })
})

describe('artboardLayout', () => {
  it('snaps to device pixels and reports the effective scale', () => {
    const l = artboardLayout(
      { zoom: 1.3333, cx: 256, cy: 256 },
      { width: 801, height: 601 },
      doc,
      2,
    )
    expect(l.width * 2).toBe(Math.round(l.width * 2))
    expect(l.left * 2).toBe(Math.round(l.left * 2))
    expect(l.scaleX).toBeCloseTo(l.width / 512, 12)
  })

  it('maps doc ↔ layout coordinates consistently', () => {
    const l = artboardLayout({ zoom: 2, cx: 256, cy: 256 }, view, doc, 1)
    expect(l.left).toBe(400 - 512)
    const p = layoutToDoc(l, docToLayout(l, { x: 12, y: 34 }))
    expect(p.x).toBeCloseTo(12, 10)
    expect(p.y).toBeCloseTo(34, 10)
  })

  it('never produces a zero-size artboard', () => {
    const l = artboardLayout({ zoom: 0.05, cx: 0, cy: 0 }, view, { width: 1, height: 1 }, 1)
    expect(l.width).toBeGreaterThan(0)
    expect(l.height).toBeGreaterThan(0)
  })
})

describe('wheel', () => {
  it('zooms in on negative deltas and out on positive ones', () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1)
    expect(wheelZoomFactor(10)).toBeLessThan(1)
    expect(wheelZoomFactor(0)).toBe(1)
  })

  it('small trackpad deltas are proportional, mouse notches are capped', () => {
    expect(wheelZoomFactor(-2)).toBeCloseTo(Math.exp(0.02), 10)
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.25, 10)
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(1.25, 10) // lines (Firefox)
    expect(wheelZoomFactor(1000)).toBeCloseTo(1 / 1.25, 10)
  })

  it('pans opposite to the scroll delta; shift turns vertical into horizontal', () => {
    expect(wheelPanDelta({ deltaX: 5, deltaY: 10, deltaMode: 0, shiftKey: false })).toEqual({
      dx: -5,
      dy: -10,
    })
    expect(wheelPanDelta({ deltaX: 0, deltaY: 10, deltaMode: 0, shiftKey: true })).toEqual({
      dx: -10,
      dy: 0,
    })
    expect(wheelPanDelta({ deltaX: 0, deltaY: 1, deltaMode: 1, shiftKey: false })).toEqual({
      dx: 0,
      dy: -16,
    })
    expect(wheelPanDelta({ deltaX: 0, deltaY: 1, deltaMode: 2, shiftKey: false }, 500)).toEqual({
      dx: 0,
      dy: -500,
    })
  })
})
