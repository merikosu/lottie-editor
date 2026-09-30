import { beforeEach, describe, expect, it } from 'vitest'
import type { Animation } from '@/lottie/types'
import { closeDocument, loadDocument, useDocument } from '@/store/document'
import { useUi } from '@/store/ui'
import {
  BACKGROUNDS,
  DARK_BACKGROUND,
  LIGHT_BACKGROUND,
  backgroundColor,
  nextBackground,
} from '../backgrounds'
import { MAX_SELECTION_ZOOM, MAX_ZOOM, MIN_ZOOM, docToView } from '../lib/camera'
import {
  consumePendingZoom,
  isViewportMounted,
  panView,
  requestZoomToNodes,
  setCompare,
  setPreviewError,
  setViewSize,
  setViewportApi,
  toggleCompare,
  useViewport,
  zoomStep,
  zoomTo,
  zoomToFit,
  zoomToNodes,
  zoomToRect,
} from '../store'

function doc(w = 512, h = 512): Animation {
  return { v: '5.7.0', fr: 30, ip: 0, op: 60, w, h, layers: [], assets: [] }
}

const view = { width: 1000, height: 600 }

beforeEach(() => {
  setViewportApi(null)
  setViewSize(null)
  closeDocument()
  useViewport.setState({ compare: false, fitted: true, error: null })
  loadDocument(doc(), { fileName: 'a.json' })
})

describe('mounting and fit', () => {
  it('fits when the view reports its size, and commands need a mounted view', () => {
    expect(isViewportMounted()).toBe(false)
    setViewSize(view)
    expect(isViewportMounted()).toBe(true)
    const { camera, fitted } = useViewport.getState()
    expect(fitted).toBe(true)
    expect(camera.cx).toBe(256)
    expect(camera.cy).toBe(256)
    expect(camera.zoom).toBeCloseTo((600 - 72) / 512, 6) // padding: 6% of 600 = 36px per side
  })

  it('stays fitted on resize until the user zooms or pans', () => {
    setViewSize(view)
    setViewSize({ width: 1000, height: 300 })
    expect(useViewport.getState().camera.zoom).toBeCloseTo((300 - 36) / 512, 6)
    zoomTo(2)
    expect(useViewport.getState().fitted).toBe(false)
    setViewSize(view)
    expect(useViewport.getState().camera.zoom).toBe(2)
  })

  it('a new document is fitted again and leaves compare mode', () => {
    setViewSize(view)
    zoomTo(4)
    setCompare(true)
    setPreviewError('boom')
    loadDocument(doc(1920, 1080), { fileName: 'b.json' })
    const s = useViewport.getState()
    expect(s.fitted).toBe(true)
    expect(s.compare).toBe(false)
    expect(s.error).toBeNull()
    expect(s.camera.cx).toBe(960)
  })

  it('resizing the artboard keeps a fitted view fitted', () => {
    setViewSize(view)
    useDocument.setState((st) => ({ doc: st.doc ? { ...st.doc, w: 100, h: 100 } : null }))
    expect(useViewport.getState().camera.cx).toBe(50)
  })

  it('a zoomed view keeps its relative focus when the artboard is resized', () => {
    setViewSize(view)
    zoomTo(1)
    expect(useViewport.getState().camera).toMatchObject({ zoom: 1, cx: 256, cy: 256 })
    useDocument.setState({ doc: doc(1024, 256) })
    expect(useViewport.getState().fitted).toBe(false)
    expect(useViewport.getState().camera).toMatchObject({ zoom: 1, cx: 512, cy: 128 })
    // Looking at the right edge of a wide artboard, then shrinking it: still its right side.
    useViewport.setState({ camera: { zoom: 1, cx: 900, cy: 128 } })
    useDocument.setState({ doc: doc(300, 256) })
    const { cx } = useViewport.getState().camera
    expect(cx).toBeCloseTo((900 / 1024) * 300, 6)
  })

  it('zoomToFit before mounting marks the view to fit later', () => {
    useViewport.setState({ fitted: false })
    zoomToFit()
    expect(useViewport.getState().fitted).toBe(true)
  })
})

describe('zoom and pan', () => {
  beforeEach(() => setViewSize(view))

  it('steps through presets around the view center', () => {
    zoomTo(1)
    zoomStep(1)
    expect(useViewport.getState().camera.zoom).toBe(1.5)
    zoomStep(-1)
    zoomStep(-1)
    expect(useViewport.getState().camera.zoom).toBe(0.75)
  })

  it('clamps zoom to 5%–6400%', () => {
    zoomTo(1e9)
    expect(useViewport.getState().camera.zoom).toBe(MAX_ZOOM)
    zoomTo(0)
    expect(useViewport.getState().camera.zoom).toBe(MIN_ZOOM)
  })

  it('zooms around an anchor point', () => {
    zoomTo(1)
    const cam = useViewport.getState().camera
    const anchor = { x: 100, y: 100 }
    const before = {
      x: cam.cx + (anchor.x - 500) / cam.zoom,
      y: cam.cy + (anchor.y - 300) / cam.zoom,
    }
    zoomTo(3, anchor)
    const after = useViewport.getState().camera
    const p = docToView(after, view, before)
    expect(p.x).toBeCloseTo(100, 6)
    expect(p.y).toBeCloseTo(100, 6)
  })

  it('pans, but never loses the artboard', () => {
    zoomTo(1)
    panView(50, -20)
    const cam = useViewport.getState().camera
    expect(docToView(cam, view, { x: 256, y: 256 })).toEqual({ x: 550, y: 280 })
    panView(100000, 0)
    const left = docToView(useViewport.getState().camera, view, { x: 0, y: 0 })
    expect(left.x).toBeLessThanOrEqual(view.width - 48 + 1e-6)
  })

  it('publishes the zoom to the ui store', () => {
    zoomTo(2)
    expect(useUi.getState().zoom).toBe(2)
  })
})

describe('zoom to nodes', () => {
  beforeEach(() => setViewSize(view))

  it('frames measured bounds, capped for tiny nodes', () => {
    setViewportApi({ nodeBounds: () => ({ x: 100, y: 100, width: 2, height: 2 }) })
    expect(zoomToNodes([['layers', 0]])).toBe(true)
    const cam = useViewport.getState().camera
    expect(cam.zoom).toBe(MAX_SELECTION_ZOOM)
    expect(cam.cx).toBe(101)
  })

  it('centers on a point (null layers) without changing the zoom', () => {
    zoomTo(2)
    setViewportApi({ nodeBounds: () => ({ x: 40, y: 60, width: 0, height: 0 }) })
    zoomToNodes([['layers', 0]])
    const cam = useViewport.getState().camera
    expect(cam.zoom).toBe(2)
    expect([cam.cx, cam.cy]).toEqual([40, 60])
  })

  it('returns false without a measuring view or bounds', () => {
    expect(zoomToNodes([['layers', 0]])).toBe(false)
    setViewportApi({ nodeBounds: () => null })
    expect(zoomToNodes([['layers', 0]])).toBe(false)
    expect(zoomToNodes([])).toBe(false)
  })

  it('applies a pending zoom once the view is ready', () => {
    requestZoomToNodes([['layers', 0]])
    setViewportApi({ nodeBounds: () => ({ x: 0, y: 0, width: 100, height: 50 }) })
    consumePendingZoom()
    expect(useViewport.getState().camera.cx).toBe(50)
    // Consumed: a second call does nothing.
    zoomTo(1)
    consumePendingZoom()
    expect(useViewport.getState().camera.zoom).toBe(1)
  })

  it('zoomToRect ignores calls while unmounted', () => {
    setViewSize(null)
    const before = useViewport.getState().camera
    zoomToRect({ x: 0, y: 0, width: 10, height: 10 })
    expect(useViewport.getState().camera).toBe(before)
  })
})

describe('compare and errors', () => {
  it('toggles compare', () => {
    toggleCompare()
    expect(useViewport.getState().compare).toBe(true)
    toggleCompare()
    expect(useViewport.getState().compare).toBe(false)
  })

  it('keeps the first error of a load attempt and re-announces new attempts', () => {
    setPreviewError('first', 1)
    setPreviewError('consequence', 1)
    const first = useViewport.getState().error
    expect(first?.message).toBe('first')
    setPreviewError('first', 2)
    expect(useViewport.getState().error?.id).not.toBe(first?.id)
    setPreviewError(null)
    expect(useViewport.getState().error).toBeNull()
  })
})

describe('backgrounds', () => {
  it('cycles through all modes', () => {
    let bg = BACKGROUNDS[0]
    const seen = [bg]
    for (let i = 0; i < BACKGROUNDS.length; i++) {
      bg = nextBackground(bg)
      seen.push(bg)
    }
    expect(seen).toEqual(['checker', 'dark', 'light', 'custom', 'checker'])
  })

  it('resolves colors (checker has none, invalid custom colors fall back)', () => {
    expect(backgroundColor('checker', '#123456')).toBeNull()
    expect(backgroundColor('dark', '#123456')).toBe(DARK_BACKGROUND)
    expect(backgroundColor('light', '#123456')).toBe(LIGHT_BACKGROUND)
    expect(backgroundColor('custom', '#ABCDEF')).toBe('#abcdef')
    expect(backgroundColor('custom', 'nope')).toBe(LIGHT_BACKGROUND)
  })
})
