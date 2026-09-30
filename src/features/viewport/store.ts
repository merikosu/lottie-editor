/**
 * Viewport state: camera (zoom + center), compare mode, preview status.
 *
 * Lives outside React so commands work from menus and shortcuts, and so the camera survives
 * remounts (switching Canvas → JSON → Canvas keeps the view). The mounted viewport reports its
 * size and registers a measuring API for zoom-to-selection.
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { NodePath } from '@/lottie/path'
import { useDocument } from '@/store/document'
import { useUi } from '@/store/ui'
import {
  MAX_SELECTION_ZOOM,
  clampZoom,
  constrainCamera,
  fitRect,
  panBy,
  stepZoom,
  zoomAt,
  type Camera,
  type Size,
} from './lib/camera'
import { isEmptyRect, type Point, type Rect } from './lib/geometry'

export interface PreviewError {
  /** What went wrong, for people. */
  message: string
  /** Technical detail (the original exception text), when it differs from `message`. */
  detail?: string
  /** Increments for every new error so the banner can re-announce repeated failures. */
  id: number
  /** Load attempt that failed (see PlayerBinding). */
  attempt?: number
}

export interface ViewportState {
  camera: Camera
  /** The camera follows "zoom to fit" (also on resize) until the user zooms or pans. */
  fitted: boolean
  /** Split view: original document next to the edited one. */
  compare: boolean
  /** Size of the edited view in CSS pixels; null while no viewport is mounted. */
  view: Size | null
  /** The edited preview has rendered at least once for the current document. */
  ready: boolean
  /** Last preview failure (cleared by the next successful load). */
  error: PreviewError | null
  /** Document id for which the "expressions are disabled" notice was dismissed. */
  expressionsNoticeDismissed: string | null
}

export const useViewport = create<ViewportState>()(
  subscribeWithSelector((): ViewportState => ({
    camera: { zoom: 1, cx: 0, cy: 0 },
    fitted: true,
    compare: false,
    view: null,
    ready: false,
    error: null,
    expressionsNoticeDismissed: null,
  })),
)

/* -------------------------------------------------------------------------- */
/*                               Measuring API                                */
/* -------------------------------------------------------------------------- */

/** Implemented by the mounted edited view (it can measure the rendered SVG). */
export interface ViewportApi {
  /** Bounds of the nodes in document coordinates at the current frame, or null if unknown. */
  nodeBounds: (paths: readonly NodePath[]) => Rect | null
}

let api: ViewportApi | null = null

export function setViewportApi(next: ViewportApi | null): void {
  api = next
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

function docSize(): Size | null {
  const doc = useDocument.getState().doc
  return doc && doc.w > 0 && doc.h > 0 ? { width: doc.w, height: doc.h } : null
}

function viewCenter(view: Size): Point {
  return { x: view.width / 2, y: view.height / 2 }
}

/** True when a viewport is on screen (commands are disabled otherwise). */
export function isViewportMounted(): boolean {
  return useViewport.getState().view !== null
}

function commit(camera: Camera, fitted = false): void {
  const { view } = useViewport.getState()
  const doc = docSize()
  const next = view && doc && !fitted ? constrainCamera(camera, view, doc) : camera
  useViewport.setState({ camera: next, fitted })
}

/* -------------------------------------------------------------------------- */
/*                                   Actions                                  */
/* -------------------------------------------------------------------------- */

/** Fits the whole artboard in the view (and keeps it fitted on resize). */
export function zoomToFit(): void {
  const { view } = useViewport.getState()
  const doc = docSize()
  if (!doc) return
  if (!view) {
    // Applied when a viewport mounts and reports its size.
    useViewport.setState({ fitted: true })
    return
  }
  commit(fitRect({ x: 0, y: 0, width: doc.width, height: doc.height }, view), true)
}

/** Sets an absolute zoom around a view point (default: the view center). */
export function zoomTo(zoom: number, anchor?: Point): void {
  const { view, camera } = useViewport.getState()
  if (!view) return
  commit(zoomAt(camera, view, anchor ?? viewCenter(view), clampZoom(zoom)))
}

/** Multiplies the zoom around a view point (wheel / pinch). */
export function zoomBy(factor: number, anchor?: Point): void {
  const { camera } = useViewport.getState()
  zoomTo(camera.zoom * factor, anchor)
}

/** Next / previous preset zoom level around the view center. */
export function zoomStep(direction: 1 | -1): void {
  zoomTo(stepZoom(useViewport.getState().camera.zoom, direction))
}

/** Moves the content by (dx, dy) view pixels. */
export function panView(dx: number, dy: number): void {
  const { camera } = useViewport.getState()
  if (dx === 0 && dy === 0) return
  commit(panBy(camera, dx, dy))
}

/** Frames a document rectangle; a zero-size rect only centers the view on it. */
export function zoomToRect(rect: Rect, maxZoom = MAX_SELECTION_ZOOM): void {
  const { view, camera } = useViewport.getState()
  if (!view) return
  if (isEmptyRect(rect)) {
    commit({ zoom: camera.zoom, cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2 })
    return
  }
  commit(fitRect(rect, view, { maxZoom }))
}

/** Frames nodes (zoom to selection / zoom to layer). Returns false when they cannot be measured. */
export function zoomToNodes(paths: readonly NodePath[]): boolean {
  if (!paths.length || !api) return false
  const bounds = api.nodeBounds(paths)
  if (!bounds) return false
  zoomToRect(bounds)
  return true
}

let pendingZoom: readonly NodePath[] | null = null

/** Frames the nodes as soon as the edited view has rendered (e.g. right after switching to it). */
export function requestZoomToNodes(paths: readonly NodePath[]): void {
  pendingZoom = paths
}

/** Called by the edited view when its preview is ready: applies a pending zoom-to-node. */
export function consumePendingZoom(): void {
  const paths = pendingZoom
  pendingZoom = null
  if (paths) zoomToNodes(paths)
}

let zoomGestureUntil = 0

/**
 * Marks a continuous zoom (wheel / pinch) in progress: views CSS-scale their player meanwhile
 * and re-render at the final size once the gesture pauses for `ms`.
 */
export function markZoomGesture(ms: number): void {
  zoomGestureUntil = performance.now() + ms
}

export function isZoomGestureActive(): boolean {
  return performance.now() < zoomGestureUntil
}

export function setCompare(compare: boolean): void {
  useViewport.setState({ compare })
}

export function toggleCompare(): void {
  setCompare(!useViewport.getState().compare)
}

/** Called by the mounted edited view whenever its size changes (null on unmount). */
export function setViewSize(view: Size | null): void {
  const prev = useViewport.getState().view
  if (prev && view && prev.width === view.width && prev.height === view.height) return
  useViewport.setState({ view })
  if (!view) return
  if (useViewport.getState().fitted) zoomToFit()
}

export function setPreviewReady(ready: boolean): void {
  if (useViewport.getState().ready !== ready) useViewport.setState({ ready })
}

let errorId = 0

/**
 * Shows (or clears with null) the preview error. Errors of the same load attempt (`attempt`)
 * keep the first message: follow-up failures are consequences of the first one.
 */
export function setPreviewError(message: string | null, attempt?: number, detail?: string): void {
  const current = useViewport.getState().error
  if (message === null) {
    if (current) useViewport.setState({ error: null })
    return
  }
  if (current && attempt !== undefined && current.attempt === attempt) return
  if (current && attempt === undefined && current.message === message && current.detail === detail)
    return
  const extra = detail && detail !== message ? { detail } : {}
  useViewport.setState({ error: { message, ...extra, id: ++errorId, attempt } })
}

export function dismissExpressionsNotice(docId: string): void {
  useViewport.setState({ expressionsNoticeDismissed: docId })
}

/* -------------------------------------------------------------------------- */
/*                           Keep in sync with the app                         */
/* -------------------------------------------------------------------------- */

// A new document opens fitted, without compare mode and without a stale error.
useDocument.subscribe(
  (s) => s.meta?.id,
  () => {
    useViewport.setState({ fitted: true, compare: false, ready: false, error: null })
    zoomToFit()
  },
)

/** "512x512" → size (null for no document or nonsense). */
function parseSize(key: string): Size | null {
  const [w, h] = key.split('x').map(Number)
  return w > 0 && h > 0 ? { width: w, height: h } : null
}

// The artboard size changed (canvas resize, or its undo): a fitted view stays fitted; a zoomed
// view keeps looking at the same relative spot of the artboard (its center stays its center),
// never at a point the smaller artboard no longer covers.
useDocument.subscribe(
  (s) => (s.doc ? `${s.doc.w}x${s.doc.h}` : ''),
  (next, prev) => {
    if (useViewport.getState().fitted) {
      zoomToFit()
      return
    }
    const from = parseSize(prev)
    const to = parseSize(next)
    if (!from || !to) return
    const { camera } = useViewport.getState()
    commit({
      zoom: camera.zoom,
      cx: (camera.cx / from.width) * to.width,
      cy: (camera.cy / from.height) * to.height,
    })
  },
)

// Publish the zoom for other features (ui store contract).
useViewport.subscribe(
  (s) => s.camera.zoom,
  (zoom) => useUi.setState({ zoom }),
  { fireImmediately: true },
)
