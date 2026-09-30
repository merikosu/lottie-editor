/**
 * Geometry of the comparison stage (pure): where each player's slot and artboard go for a mode,
 * the stage size, the animation size, the zoom (1 = fit) and the pan offset.
 */
import type { CompareMode } from '../../model/settings'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface StageLayout {
  /** Clipping areas of the original (a) and optimized (b) players, in stage pixels. */
  slots: { a: Rect; b: Rect }
  /** Artboard of each player, relative to its slot. */
  boards: { a: Rect; b: Rect }
  /** Screen pixels per animation pixel. */
  scale: number
  /** Scale at zoom 1 (fit). */
  fitScale: number
}

/** Space around the artboards; the top keeps room for the labels. */
export const PAD = { x: 24, top: 40, bottom: 24 }
/** Gap between the two artboards side by side. */
export const GAP = 16

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 16

/** Zoom (1 = fit) and pan (stage pixels) of the comparison. */
export interface View {
  zoom: number
  pan: { x: number; y: number }
}

export const FIT_VIEW: View = { zoom: 1, pan: { x: 0, y: 0 } }

function fit(area: { w: number; h: number }, size: { w: number; h: number }): number {
  if (size.w <= 0 || size.h <= 0 || area.w <= 0 || area.h <= 0) return 1
  return Math.min(area.w / size.w, area.h / size.h)
}

/** Lays out the artboards. Side by side, each half gets the same scale (both fit their half). */
export function layoutStage(
  mode: CompareMode,
  stage: { w: number; h: number },
  anim: { w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
): StageLayout {
  const inner = {
    x: PAD.x,
    y: PAD.top,
    w: Math.max(0, stage.w - PAD.x * 2),
    h: Math.max(0, stage.h - PAD.top - PAD.bottom),
  }
  const side = mode === 'side'
  const slotW = side ? Math.max(0, (inner.w - GAP) / 2) : inner.w
  const a: Rect = { x: inner.x, y: inner.y, w: slotW, h: inner.h }
  const b: Rect = side ? { x: inner.x + slotW + GAP, y: inner.y, w: slotW, h: inner.h } : { ...a }
  const fitScale = fit({ w: slotW, h: inner.h }, anim)
  const scale = fitScale * zoom
  const w = anim.w * scale
  const h = anim.h * scale
  const board: Rect = { x: (slotW - w) / 2 + pan.x, y: (inner.h - h) / 2 + pan.y, w, h }
  return { slots: { a, b }, boards: { a: board, b: { ...board } }, scale, fitScale }
}

/**
 * Zooms around a point of the slot (e.g. the cursor): the animation pixel under it stays put.
 * Returns the new zoom and pan.
 */
export function zoomAt(
  layout: StageLayout,
  nextZoom: number,
  point: { x: number; y: number },
): { zoom: number; pan: { x: number; y: number } } {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  const board = layout.boards.a
  const slot = layout.slots.a
  // Animation-space position under the point, before zooming.
  const ax = (point.x - board.x) / layout.scale
  const ay = (point.y - board.y) / layout.scale
  const scale = layout.fitScale * z
  const w = (board.w / layout.scale) * scale
  const h = (board.h / layout.scale) * scale
  // Where the centered board would sit without pan, then the pan that keeps (ax, ay) under the point.
  const cx = (slot.w - w) / 2
  const cy = (slot.h - h) / 2
  return { zoom: z, pan: { x: point.x - ax * scale - cx, y: point.y - ay * scale - cy } }
}
