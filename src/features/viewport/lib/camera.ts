/**
 * Viewport camera math (pure).
 *
 * The camera is stored as a zoom factor plus the document point shown at the center of the
 * view (`cx`, `cy`, in artboard pixels). Keeping the center (rather than a pixel offset)
 * makes the view stable when the panel is resized or split for "compare": every pane shows
 * the same document point at its center.
 */
import { formatDecimal } from '@/lib/format'
import type { Point, Rect } from './geometry'

export interface Camera {
  zoom: number
  /** Document point at the center of the view (artboard pixels). */
  cx: number
  cy: number
}

export interface Size {
  width: number
  height: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 64

/** Zoom levels used by zoom in / zoom out (Figma-like ladder). */
export const ZOOM_PRESETS: readonly number[] = [
  0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64,
]

/** Zoom-to-selection never zooms further in than this (tiny layers would fill the screen). */
export const MAX_SELECTION_ZOOM = 16

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** True when two zoom factors display the same percentage (within 0.1%). */
export function sameZoom(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(a, b) * 0.001
}

/** Next preset zoom in the given direction; presets within 1% of the current zoom are skipped. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const z = clampZoom(zoom)
  if (direction > 0) {
    for (const p of ZOOM_PRESETS) if (p > z * 1.01) return p
    return MAX_ZOOM
  }
  for (let i = ZOOM_PRESETS.length - 1; i >= 0; i--)
    if (ZOOM_PRESETS[i] < z / 1.01) return ZOOM_PRESETS[i]
  return MIN_ZOOM
}

/** Padding around the artboard when fitting: proportional to the view, 16–48 px. */
export function fitPadding(view: Size): number {
  return Math.round(Math.min(48, Math.max(16, Math.min(view.width, view.height) * 0.06)))
}

/**
 * Camera that shows `rect` (document coordinates) as large as possible inside `view`,
 * centered, with `padding` pixels on every side.
 */
export function fitRect(
  rect: Rect,
  view: Size,
  opts: { padding?: number; maxZoom?: number } = {},
): Camera {
  const padding = opts.padding ?? fitPadding(view)
  const availW = Math.max(1, view.width - padding * 2)
  const availH = Math.max(1, view.height - padding * 2)
  const w = Math.max(rect.width, 1e-6)
  const h = Math.max(rect.height, 1e-6)
  let zoom = clampZoom(Math.min(availW / w, availH / h))
  if (opts.maxZoom !== undefined) zoom = Math.min(zoom, Math.max(MIN_ZOOM, opts.maxZoom))
  return { zoom, cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2 }
}

/** Document point → view pixel (relative to the view's top-left corner). */
export function docToView(cam: Camera, view: Size, p: Point): Point {
  return {
    x: view.width / 2 + (p.x - cam.cx) * cam.zoom,
    y: view.height / 2 + (p.y - cam.cy) * cam.zoom,
  }
}

/** View pixel → document point. */
export function viewToDoc(cam: Camera, view: Size, p: Point): Point {
  return {
    x: cam.cx + (p.x - view.width / 2) / cam.zoom,
    y: cam.cy + (p.y - view.height / 2) / cam.zoom,
  }
}

/** Changes the zoom while keeping the document point under `anchor` (view pixels) in place. */
export function zoomAt(cam: Camera, view: Size, anchor: Point, zoom: number): Camera {
  const next = clampZoom(zoom)
  const doc = viewToDoc(cam, view, anchor)
  return {
    zoom: next,
    cx: doc.x - (anchor.x - view.width / 2) / next,
    cy: doc.y - (anchor.y - view.height / 2) / next,
  }
}

/** Moves the content by (dx, dy) view pixels (dragging right moves the artboard right). */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { zoom: cam.zoom, cx: cam.cx - dx / cam.zoom, cy: cam.cy - dy / cam.zoom }
}

/**
 * Keeps part of the artboard visible: at least `margin` pixels of it (or all of it when it is
 * smaller) must stay inside the view, so the artboard can never be lost off-screen.
 */
export function constrainCamera(cam: Camera, view: Size, doc: Size, margin = 48): Camera {
  const axis = (c: number, viewLen: number, docLen: number) => {
    const z = cam.zoom
    const m = Math.min(margin, docLen * z, viewLen / 2)
    // left = viewLen/2 − c·z must be ≤ viewLen − m; right = left + docLen·z must be ≥ m.
    const lo = (m - viewLen / 2) / z
    const hi = docLen + (viewLen / 2 - m) / z
    if (lo > hi) return docLen / 2
    return Math.min(hi, Math.max(lo, c))
  }
  const cx = axis(cam.cx, view.width, doc.width)
  const cy = axis(cam.cy, view.height, doc.height)
  return cx === cam.cx && cy === cam.cy ? cam : { zoom: cam.zoom, cx, cy }
}

export interface ArtboardLayout {
  /** Artboard position and size in view pixels, snapped to device pixels. */
  left: number
  top: number
  width: number
  height: number
  /** Effective scale after snapping (view pixels per document pixel). */
  scaleX: number
  scaleY: number
}

/** Where the artboard is drawn for a camera, snapped to device pixels for crisp edges. */
export function artboardLayout(cam: Camera, view: Size, doc: Size, dpr = 1): ArtboardLayout {
  const ratio = dpr > 0 ? dpr : 1
  const snap = (v: number) => Math.round(v * ratio) / ratio
  const width = Math.max(1 / ratio, snap(doc.width * cam.zoom))
  const height = Math.max(1 / ratio, snap(doc.height * cam.zoom))
  const left = snap(view.width / 2 - cam.cx * cam.zoom)
  const top = snap(view.height / 2 - cam.cy * cam.zoom)
  return {
    left,
    top,
    width,
    height,
    scaleX: doc.width > 0 ? width / doc.width : cam.zoom,
    scaleY: doc.height > 0 ? height / doc.height : cam.zoom,
  }
}

/** View pixel → document point using a (snapped) artboard layout. */
export function layoutToDoc(layout: ArtboardLayout, p: Point): Point {
  return { x: (p.x - layout.left) / layout.scaleX, y: (p.y - layout.top) / layout.scaleY }
}

/** Document point → view pixel using a (snapped) artboard layout. */
export function docToLayout(layout: ArtboardLayout, p: Point): Point {
  return { x: layout.left + p.x * layout.scaleX, y: layout.top + p.y * layout.scaleY }
}

/* -------------------------------------------------------------------------- */
/*                                    Wheel                                   */
/* -------------------------------------------------------------------------- */

const LINE_HEIGHT = 16
/** Largest zoom change per wheel event (a mouse wheel notch ≈ ×1.25). */
const MAX_STEP = Math.log(1.25)
/** Zoom sensitivity for continuous deltas (trackpad pinch sends small ctrl+wheel deltas). */
const ZOOM_SPEED = 0.01

function deltaToPixels(delta: number, deltaMode: number, page: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT
  if (deltaMode === 2) return delta * page
  return delta
}

/**
 * Zoom factor for a ctrl/⌘ + wheel (or pinch) event: proportional for small trackpad deltas,
 * capped per event so a mouse wheel notch is a comfortable step.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, page = 800): number {
  const dy = deltaToPixels(deltaY, deltaMode, page)
  if (!Number.isFinite(dy) || dy === 0) return 1
  const amount = Math.min(Math.abs(dy) * ZOOM_SPEED, MAX_STEP)
  return Math.exp(dy > 0 ? -amount : amount)
}

/**
 * Pan delta (content movement in view pixels) for a plain wheel event. Shift + vertical wheel
 * scrolls horizontally (Windows mice; macOS already reports deltaX).
 */
export function wheelPanDelta(
  e: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean },
  page = 800,
): { dx: number; dy: number } {
  let dx = deltaToPixels(e.deltaX, e.deltaMode, page)
  let dy = deltaToPixels(e.deltaY, e.deltaMode, page)
  if (e.shiftKey && dx === 0) {
    dx = dy
    dy = 0
  }
  // `|| 0` avoids -0 (content moves opposite to the scroll direction).
  return { dx: -dx || 0, dy: -dy || 0 }
}

/* -------------------------------------------------------------------------- */
/*                                   Display                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whole percents like Figma (1 → "100%", 0.672 → "67%", 64 → "6400%"); below 10% one decimal
 * keeps small steps distinguishable (0.075 → "7.5%", "7,5%" in Russian).
 */
export function formatZoom(zoom: number): string {
  const p = zoom * 100
  if (!Number.isFinite(p)) return '—'
  const rounded = Math.round(p)
  if (p >= 9.95 || Math.abs(p - rounded) < 0.05) return `${rounded}%`
  return `${formatDecimal(Math.round(p * 10) / 10, 1)}%`
}
