/**
 * Imperative controller of one viewport pane (the edited view, or the original in compare
 * mode). Everything that changes at pointer/frame rate lives here instead of React state:
 *
 *  - camera → artboard position/size (device-pixel snapped); during wheel/pinch zooms the
 *    player is CSS-scaled and re-rendered at the final size once the gesture pauses
 *  - player loads (coalesced), frame rendering, canvas renderer sizing (bounded backing store)
 *  - selection overlay (edited pane), redrawn right after each rendered frame
 *  - pointer input: hover, click / ⌘-click / Shift-click selection, double-click drill-down,
 *    dragging layers (move-gesture.ts) and the marquee, context-menu targeting, Space /
 *    middle-button panning, wheel pan and ⌘/pinch zoom
 */
import {
  instanceChainFor,
  noteInstanceChain,
  noteInstancesInStack,
} from '@/features/layers/instances'
import { previewDocument, subscribeActiveThemeRules } from '@/features/themes/preview'
import { getT } from '@/i18n'
import { emit } from '@/lib/events'
import { formatNumber } from '@/lib/format'
import { hasModKey } from '@/lib/platform'
import { getAt, isLayerPath, pathEquals, type NodePath } from '@/lottie/path'
import { findPrecomp } from '@/lottie/traverse'
import type { Animation, Layer } from '@/lottie/types'
import { isPrecompLayer, isTextLayer } from '@/lottie/types'
import { nodePathsFromElement } from '@/player/prepare'
import {
  clearSelection,
  isNodeSelected,
  selectNodes,
  useDocument,
  type DocumentState,
} from '@/store/document'
import { pause, subscribeFrame, usePlayback } from '@/store/playback'
import { usePrefs } from '@/store/prefs'
import { setHoverNode, useUi } from '@/store/ui'
import {
  artboardLayout,
  docToLayout,
  layoutToDoc,
  wheelPanDelta,
  wheelZoomFactor,
  type ArtboardLayout,
  type Size,
} from './lib/camera'
import { describePreviewError } from './lib/errors'
import {
  quadIntersectsRect,
  rectFromPoints,
  type Point,
  type Quad,
  type Rect,
} from './lib/geometry'
import { hitGizmo, pointInQuad, resizeCursor, rotateCursor, type GizmoHit } from './lib/gizmo'
import { drillDown, hitStack, pickFromStack, type HitMode } from './lib/hit'
import { moveOwner } from './lib/move'
import { isLockedOnCanvas } from './locks'
import { MoveGesture, type DragReadout } from './move-gesture'
import { Overlay, measureNodeShapes, measureNodesBounds } from './overlay'
import { TransformGesture, type TransformGrab, type TransformReadout } from './transform-gesture'
import { PlayerBinding } from './player-binding'
import { isSpaceHeld, markSpacePanUsed, setPointerOverViewport, subscribeSpace } from './space-pan'
import {
  consumePendingZoom,
  isZoomGestureActive,
  markZoomGesture,
  panView,
  setPreviewError,
  setPreviewReady,
  setViewSize,
  setViewportApi,
  useViewport,
  zoomBy,
  zoomTo,
} from './store'

export type PaneKind = 'edited' | 'original'

export interface PaneElements {
  /** Pane container: receives pointer input, clips the artboard. */
  root: HTMLElement
  /** Positioned by the camera; shows the preview background and outline. */
  artboard: HTMLDivElement
  /** LottiePlayer host inside the artboard. */
  host: HTMLDivElement
  /** Selection overlay (edited pane only). */
  overlay?: SVGSVGElement | null
  /** Cursor position readout. */
  cursor?: HTMLElement | null
  /** Readout next to the pointer while dragging layers (their new position). */
  readout?: HTMLElement | null
}

/** Delay after the last wheel/pinch zoom step before re-rendering at the final size. */
const ZOOM_SETTLE_MS = 140
/** Canvas renderer backing store limits (beyond them the bitmap is CSS-scaled). */
const CANVAS_MAX_PIXELS = 4096 * 4096
const CANVAS_MAX_SIDE = 8192
/** Pointer travel (px) that turns a press into a drag (shorter presses are clicks). */
const DRAG_THRESHOLD = 3
/**
 * Preview reloads while dragging layers: ~30 fps at most (each reload with a changed motion
 * path leaves a curve in lottie-web's permanent bezier cache).
 */
const DRAG_RELOAD_INTERVAL = 33
/** Dragged layers snap to the artboard's edges and center within this distance (screen px). */
const SNAP_DISTANCE = 6

interface HostSize {
  width: number
  height: number
}

/** What a press hit: the node a click would select, and the tagged paths under the pointer. */
interface Hit {
  node: NodePath
  /** Tagged nodes under the pointer, outermost first. */
  stack: NodePath[]
}

interface Press {
  x: number
  y: number
  pointerId: number
  moved: boolean
  marquee: boolean
  /** Shift or ⌘/Ctrl: the marquee adds to the selection. */
  additive: boolean
  shift: boolean
  /** ⌘/Ctrl: the deepest node is targeted. */
  deep: boolean
  hit: Hit | null
  /** A gizmo handle or rotate zone: a drag resizes or rotates, a click does nothing. */
  grab: TransformGrab | null
  /** Inside the selection's box: a drag moves the selection, a click selects as usual. */
  inside: boolean
}

/** Text of the readout next to the pointer: the value, and a quieter detail. */
interface ReadoutText {
  main: string
  detail?: string
}

/** Numbers of the drag readout: one decimal at most, like the inspector's fields. */
const readoutNumber = (v: number) => formatNumber(v, 1)

/** Readout of a move: the new position of one node, or the offset of several. */
function moveReadout(readout: DragReadout): ReadoutText {
  const t = getT().viewport
  const signed = (v: number) => (v > 0 ? `+${readoutNumber(v)}` : readoutNumber(v))
  return {
    main:
      readout.kind === 'position'
        ? t.dragPosition(readoutNumber(readout.x), readoutNumber(readout.y))
        : t.dragOffset(signed(readout.dx), signed(readout.dy)),
  }
}

/** Readout of a resize (box size in composition pixels, then the scale) or a rotation. */
function transformReadout(readout: TransformReadout): ReadoutText {
  const t = getT().viewport
  const num = readoutNumber
  if (readout.kind === 'rotate') return { main: t.readoutAngle(num(readout.angle)) }
  const [sx, sy] = readout.scale
  const uniform = num(sx) === num(sy)
  return {
    main: t.readoutSize(num(readout.width), num(readout.height)),
    detail: t.readoutScale(num(sx), uniform ? null : num(sy)),
  }
}

function preventMiddleButton(e: MouseEvent): void {
  if (e.button === 1) e.preventDefault()
}

/**
 * Floating chrome inside a pane (chips, the error banner) is marked `data-pane-chrome`: pointer
 * input that starts there belongs to those controls, not to the canvas (no selection, marquee
 * or pointer capture that would swallow their clicks).
 */
function isChromeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-pane-chrome]') !== null
}

/** WebKit's non-standard pinch event (Safari on macOS). */
interface SafariGestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

export class PaneController {
  private readonly els: PaneElements
  private readonly kind: PaneKind
  private readonly binding: PlayerBinding
  private readonly overlay: Overlay | null
  private readonly disposers: Array<() => void> = []
  private readonly resizeObserver: ResizeObserver
  private docId: string | null
  private view: Size = { width: 0, height: 0 }
  private layout: ArtboardLayout | null = null
  private host: HostSize | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private overlayRaf = 0
  private pan: { x: number; y: number; pointerId: number } | null = null
  /**
   * Left button press: a click, a move of the layer under the pointer (`hit`) once it drags,
   * or a marquee when it started on empty canvas.
   */
  private press: Press | null = null
  /** Dragging layers (edited pane, SVG renderer). */
  private readonly mover = new MoveGesture()
  /** Resizing or rotating the selected node with the gizmo's handles. */
  private readonly transformer = new TransformGesture()
  /** Readout parts (created on first use): the value and its detail. */
  private readoutParts: { main: HTMLSpanElement; detail: HTMLSpanElement } | null = null
  /** Marquee in progress: start in document coordinates (stable while zooming), end in view pixels. */
  private marquee: { start: Point; end: Point; additive: boolean; hits: NodePath[] } | null = null
  private marqueeCache: { frame: number; doc: Animation; quads: Quad[][] } | null = null
  private marqueeRaf = 0
  private pointer: { x: number; y: number } | null = null
  /** Zoom when a Safari pinch started (its scale is relative to the start). */
  private gestureZoom: number | null = null
  private ownsHover = false
  /** False while a newly opened document loads (the previous file is hidden). */
  private contentVisible = true
  private destroyed = false

  constructor(els: PaneElements, kind: PaneKind) {
    this.els = els
    this.kind = kind
    this.docId = useDocument.getState().meta?.id ?? null
    const prefs = usePrefs.getState()
    this.binding = new PlayerBinding({
      host: els.host,
      renderer: prefs.renderer,
      runExpressions: prefs.runExpressions,
      interactive: kind === 'edited',
      // Solo paths refer to the edited document: the original is always shown whole.
      solo: kind === 'edited' ? useUi.getState().soloNodes : undefined,
      // The theme chosen in the Themes section is previewed on the edited canvas only.
      present: kind === 'edited' ? previewDocument : undefined,
      onReady: (clean) => this.onPlayerReady(clean),
      onError: (err, attempt) => this.onPlayerError(err, attempt),
    })
    this.overlay = kind === 'edited' && els.overlay ? new Overlay(els.overlay) : null

    this.resizeObserver = new ResizeObserver(() => this.measure())
    this.resizeObserver.observe(els.root)
    this.measure()
    this.subscribe()
    this.listen()

    // Before the first load: a synchronous "ready" may already apply a pending zoom-to-node.
    if (kind === 'edited') setViewportApi({ nodeBounds: (paths) => this.nodeBounds(paths) })
    this.binding.request(this.sourceDoc(), true)
  }

  destroy(): void {
    this.destroyed = true
    this.resizeObserver.disconnect()
    for (const dispose of this.disposers.splice(0)) dispose()
    if (this.settleTimer !== null) clearTimeout(this.settleTimer)
    if (this.overlayRaf) cancelAnimationFrame(this.overlayRaf)
    if (this.marqueeRaf) cancelAnimationFrame(this.marqueeRaf)
    this.mover.cancel()
    this.transformer.cancel()
    this.clearOwnHover()
    this.overlay?.destroy()
    this.binding.destroy()
    if (this.kind === 'edited') {
      setViewportApi(null)
      setViewSize(null)
    }
  }

  /** Reloads the preview (error banner "Try again"). */
  reload(): void {
    this.binding.reload()
  }

  /* ------------------------------------------------------------------------ */
  /*                               Subscriptions                              */
  /* ------------------------------------------------------------------------ */

  private sourceDoc(): Animation | null {
    const s = useDocument.getState()
    return this.kind === 'edited' ? s.doc : (s.original ?? s.doc)
  }

  private isInteractive(): boolean {
    return this.kind === 'edited' && this.binding.renderer === 'svg'
  }

  private subscribe(): void {
    const d = this.disposers
    const selectSource = (s: DocumentState) => (this.kind === 'edited' ? s.doc : s.original)
    d.push(useDocument.subscribe(selectSource, (doc, prev) => this.onSourceChanged(doc, prev)))
    if (this.kind === 'edited') {
      d.push(subscribeActiveThemeRules(() => this.binding.request(this.sourceDoc(), true)))
    }
    d.push(
      useViewport.subscribe(
        (s) => s.camera,
        () => this.applyLayout(false),
      ),
    )
    d.push(
      usePrefs.subscribe((s, prev) => {
        if (s.renderer === prev.renderer && s.runExpressions === prev.runExpressions) return
        const options = { renderer: s.renderer, runExpressions: s.runExpressions }
        if (s.renderer === prev.renderer) {
          this.binding.configure(options)
          return
        }
        this.clearOwnHover()
        // Size the host for the new renderer BEFORE it loads: the canvas backing store is capped,
        // and a canvas created at a deep zoom's full size would not even be allocated.
        this.binding.configure(options, false)
        this.host = null
        this.applyLayout(true)
        this.binding.reload()
      }),
    )
    d.push(
      subscribeFrame((frame) => {
        this.binding.renderFrame(frame)
        // Same tick as the render: outlines never lag behind animated layers.
        if (this.overlay) this.drawOverlay()
      }),
    )
    if (this.overlay) {
      d.push(
        useDocument.subscribe(
          (s) => s.selection,
          () => this.invalidateOverlay(),
        ),
      )
      d.push(
        useUi.subscribe((s, prev) => {
          if (s.hoverNode !== prev.hoverNode || s.highlightNodes !== prev.highlightNodes)
            this.invalidateOverlay()
          if (s.soloNodes !== prev.soloNodes) this.binding.configure({ solo: s.soloNodes })
        }),
      )
    }
    d.push(
      subscribeSpace((held) => {
        // A pan in progress keeps its grabbing cursor until the button is released.
        if (!this.pan) this.setPanCursor(held ? 'ready' : null)
      }),
    )
    d.push(this.watchPixelRatio())
  }

  /**
   * Moving the window to a display with another pixel ratio changes device-pixel snapping, and
   * the canvas renderer picks its ratio at load time: re-layout and reload it.
   */
  private watchPixelRatio(): () => void {
    let query: MediaQueryList | null = null
    const onChange = () => {
      this.host = null
      this.applyLayout(true)
      if (this.binding.renderer === 'canvas') this.binding.reload()
      listen()
    }
    const listen = () => {
      query?.removeEventListener('change', onChange)
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      query.addEventListener('change', onChange)
    }
    listen()
    return () => query?.removeEventListener('change', onChange)
  }

  private onSourceChanged(doc: Animation | null, prev: Animation | null): void {
    // Something else edited the document during a drag (undo, another panel): the drag is void.
    if (this.mover.active && doc !== this.mover.base) this.cancelMove(false)
    if (this.transformer.active && doc !== this.transformer.base) this.cancelTransform(false)
    const id = useDocument.getState().meta?.id ?? null
    const newDocument = id !== this.docId
    this.docId = id
    if (!doc) return
    if (newDocument) {
      // Another file: don't keep showing the previous one while this one loads.
      this.binding.forgetLastGood()
      this.setContentVisible(false)
    }
    // A new document loads at once; edits of the same document are coalesced (drags). Steps of
    // a gesture in progress (an open history entry, just updated) may wait for a pause.
    const s = useDocument.getState()
    const last = s.past[s.past.length - 1]
    const continuous =
      !!last && last.closed === false && s.future.length === 0 && Date.now() - last.time < 1000
    this.binding.request(doc, newDocument || this.kind === 'original', undefined, continuous)
    if (!prev || prev.w !== doc.w || prev.h !== doc.h) this.applyLayout(true)
  }

  private setContentVisible(visible: boolean): void {
    this.contentVisible = visible
    this.els.host.style.visibility = visible ? '' : 'hidden'
    if (!visible) this.overlay?.clear()
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Layout                                 */
  /* ------------------------------------------------------------------------ */

  private measure(): void {
    const rect = this.els.root.getBoundingClientRect()
    const next = { width: Math.round(rect.width), height: Math.round(rect.height) }
    if (next.width === this.view.width && next.height === this.view.height) return
    this.view = next
    if (next.width === 0 || next.height === 0) return
    // The edited pane drives the shared camera (fit on resize); compare panes have equal sizes.
    if (this.kind === 'edited') setViewSize(next)
    this.applyLayout(true)
  }

  /** Positions the artboard for the current camera. `commit` re-renders the player at the final size. */
  private applyLayout(commit: boolean): void {
    const doc = this.sourceDoc()
    if (this.destroyed || !doc || this.view.width === 0 || this.view.height === 0) return
    const dpr = window.devicePixelRatio || 1
    const layout = artboardLayout(
      useViewport.getState().camera,
      this.view,
      { width: doc.w, height: doc.h },
      dpr,
    )
    const prev = this.layout
    this.layout = layout
    const { artboard } = this.els
    artboard.style.transform = `translate(${layout.left}px, ${layout.top}px)`
    if (!prev || prev.width !== layout.width || prev.height !== layout.height) {
      artboard.style.width = `${layout.width}px`
      artboard.style.height = `${layout.height}px`
    }

    if (commit || !this.host || !isZoomGestureActive()) {
      this.commitHost()
    } else {
      // Mid-gesture: scale the current rendering, re-render once the gesture pauses.
      this.scaleHost()
      if (this.settleTimer !== null) clearTimeout(this.settleTimer)
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null
        this.commitHost()
        this.invalidateOverlay()
      }, ZOOM_SETTLE_MS)
    }
    this.invalidateOverlay()
  }

  /** Size the player renders at: the artboard size, bounded for the canvas renderer. */
  private targetHostSize(layout: ArtboardLayout): HostSize {
    if (this.binding.renderer !== 'canvas') return { width: layout.width, height: layout.height }
    const dpr = window.devicePixelRatio || 1
    const longest = Math.max(layout.width, layout.height) * dpr
    const factor = Math.min(
      1,
      Math.sqrt(CANVAS_MAX_PIXELS / Math.max(1, layout.width * layout.height * dpr * dpr)),
      CANVAS_MAX_SIDE / Math.max(1, longest),
    )
    return {
      width: Math.max(1, Math.round(layout.width * factor)),
      height: Math.max(1, Math.round(layout.height * factor)),
    }
  }

  private commitHost(): void {
    const layout = this.layout
    if (!layout || this.destroyed) return
    const size = this.targetHostSize(layout)
    const changed = !this.host || this.host.width !== size.width || this.host.height !== size.height
    this.host = size
    if (changed) {
      this.els.host.style.width = `${size.width}px`
      this.els.host.style.height = `${size.height}px`
    }
    this.scaleHost()
    // The canvas renderer does not observe its container: re-allocate and redraw.
    if (changed && this.binding.renderer === 'canvas') this.binding.player.resize()
  }

  /** CSS-scales the player from its rendered size to the artboard size. */
  private scaleHost(): void {
    const layout = this.layout
    const size = this.host
    if (!layout || !size) return
    const sx = layout.width / size.width
    const sy = layout.height / size.height
    const scaled = Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4
    this.els.host.style.transform = scaled ? `scale(${sx}, ${sy})` : ''
  }

  /* ------------------------------------------------------------------------ */
  /*                                 Player events                            */
  /* ------------------------------------------------------------------------ */

  private onPlayerReady(clean: boolean): void {
    if (this.destroyed) return
    if (!this.contentVisible) this.setContentVisible(true)
    this.syncCanvasSize()
    if (this.kind === 'edited') {
      setPreviewReady(true)
      if (clean) setPreviewError(null)
      consumePendingZoom()
    }
    this.invalidateOverlay()
  }

  /** A canvas created while a zoom was settling has a stale size: resize it to the host. */
  private syncCanvasSize(): void {
    if (this.binding.renderer !== 'canvas' || !this.host) return
    const canvas = this.binding.player.element?.querySelector('canvas')
    const dpr = window.devicePixelRatio || 1
    if (canvas && Math.abs(canvas.width - this.host.width * dpr) > 1) this.binding.player.resize()
  }

  private onPlayerError(error: Error, attempt: number): void {
    if (this.kind !== 'edited') {
      console.warn('The original preview failed to render', error)
      return
    }
    const t = getT().viewport
    const { kind, detail } = describePreviewError(error)
    setPreviewError(
      kind === 'data' ? t.errorInvalidData : detail || t.unknownError,
      attempt,
      detail,
    )
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Overlay                                */
  /* ------------------------------------------------------------------------ */

  private invalidateOverlay(): void {
    if (!this.overlay || this.overlayRaf) return
    this.overlayRaf = requestAnimationFrame(() => {
      this.overlayRaf = 0
      this.drawOverlay()
    })
  }

  private drawOverlay(): void {
    const overlay = this.overlay
    if (!overlay || this.destroyed) return
    if (this.overlayRaf) {
      cancelAnimationFrame(this.overlayRaf)
      this.overlayRaf = 0
    }
    const s = useDocument.getState()
    const layout = this.layout
    if (!s.doc || !layout || !this.binding.player.isReady || !this.contentVisible) {
      overlay.clear()
      return
    }
    const ui = useUi.getState()
    overlay.draw({
      doc: s.doc,
      frame: usePlayback.getState().frame,
      layout,
      svg: this.binding.renderer === 'svg' ? this.binding.player.svg : null,
      selection: s.selection.nodes,
      hover: ui.hoverNode,
      highlight: ui.highlightNodes,
      marquee: this.marquee
        ? {
            rect: rectFromPoints(docToLayout(layout, this.marquee.start), this.marquee.end),
            hits: this.marquee.hits,
          }
        : null,
      drag: this.mover.overlay ?? this.transformer.overlay,
    })
  }

  /** Document-space bounds of nodes at the current frame (zoom to selection / layer). */
  private nodeBounds(paths: readonly NodePath[]): Rect | null {
    const doc = useDocument.getState().doc
    if (!doc) return null
    const svg = this.binding.renderer === 'svg' ? this.binding.player.svg : null
    return measureNodesBounds(doc, paths, usePlayback.getState().frame, svg)
  }

  /* ------------------------------------------------------------------------ */
  /*                                    Input                                 */
  /* ------------------------------------------------------------------------ */

  private listen(): void {
    const root = this.els.root
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      root.addEventListener(type, handler, opts)
      this.disposers.push(() => root.removeEventListener(type, handler, opts))
    }
    on('pointerenter', () => setPointerOverViewport(true))
    on('pointerleave', (e) => this.onPointerLeave(e))
    on('pointerdown', (e) => this.onPointerDown(e))
    on('pointermove', (e) => this.onPointerMove(e))
    on('pointerup', (e) => this.onPointerUp(e))
    // The browser took the pointer away: a drag keeps what it did so far.
    on('pointercancel', () => {
      this.endPan()
      this.cancelMarquee()
      this.finishMove()
      this.finishTransform()
    })
    on('lostpointercapture', () => {
      this.endPan()
      this.cancelMarquee()
      this.finishMove()
      this.finishTransform()
    })
    on('wheel', (e) => this.onWheel(e), { passive: false })
    on('dblclick', (e) => this.onDoubleClick(e))
    on('contextmenu', (e) => this.onContextMenu(e))
    // Middle button: no autoscroll, no Linux primary-selection paste.
    on('mousedown', preventMiddleButton)
    on('auxclick', preventMiddleButton)
    // Safari reports trackpad pinches as GestureEvents (other browsers send ctrl+wheel).
    const onGesture = (e: Event) => this.onGesture(e as SafariGestureEvent)
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      root.addEventListener(type, onGesture)
      this.disposers.push(() => root.removeEventListener(type, onGesture))
    }
    const onModifier = (e: KeyboardEvent) => {
      // Shift (axis lock), ⌘/Ctrl (no snapping) and Alt (copies) apply at once while dragging.
      const modifier =
        e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt'
      if (modifier && this.mover.active && this.pointer) {
        if (e.key === 'Alt') e.preventDefault()
        this.updateMove(this.pointer.x, this.pointer.y, e.shiftKey, hasModKey(e), e.altKey)
        return
      }
      if (modifier && this.transformer.active && this.pointer) {
        if (e.key === 'Alt') e.preventDefault()
        this.updateTransform(this.pointer.x, this.pointer.y, e.shiftKey, hasModKey(e), e.altKey)
        return
      }
      // ⌘/Ctrl pressed or released while hovering switches between layer and deep hover.
      if ((e.key === 'Meta' || e.key === 'Control') && this.pointer && !this.pan && !this.press) {
        this.updateHover(this.pointer.x, this.pointer.y, hasModKey(e))
      }
    }
    // Esc cancels a marquee or a drag (before the global "deselect" shortcut sees it).
    const onEscape = (e: KeyboardEvent) => {
      const busy = this.marquee || this.mover.active || this.transformer.active
      if (e.key !== 'Escape' || !busy) return
      e.preventDefault()
      e.stopPropagation()
      this.cancelMarquee()
      this.cancelMove(true)
      this.cancelTransform(true)
    }
    // Any gesture ends with a release (timeline drags, scrubs, pickers): a preview load that a
    // big file deferred while it ran is due.
    const onRelease = () => this.binding.endGesture()
    window.addEventListener('keydown', onModifier)
    window.addEventListener('keyup', onModifier)
    window.addEventListener('keydown', onEscape, true)
    window.addEventListener('pointerup', onRelease, true)
    window.addEventListener('pointercancel', onRelease, true)
    this.disposers.push(() => {
      window.removeEventListener('keydown', onModifier)
      window.removeEventListener('keyup', onModifier)
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('pointerup', onRelease, true)
      window.removeEventListener('pointercancel', onRelease, true)
    })
  }

  private localPoint(e: { clientX: number; clientY: number }) {
    const rect = this.els.root.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private onPointerDown(e: PointerEvent): void {
    if (isChromeTarget(e.target)) return
    // Take focus from inspector fields etc. so shortcuts apply to the canvas.
    if (document.activeElement !== this.els.root) this.els.root.focus({ preventScroll: true })
    if (e.button === 1 || (e.button === 0 && isSpaceHeld())) {
      e.preventDefault()
      markSpacePanUsed()
      this.pan = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      this.els.root.setPointerCapture(e.pointerId)
      this.setPanCursor('active')
      this.hideCursor()
      this.clearOwnHover()
      return
    }
    if (e.button !== 0) return
    const deep = hasModKey(e)
    const base = {
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      moved: false,
      additive: e.shiftKey || deep,
      shift: e.shiftKey,
      deep,
    }
    // The gizmo's handles come first: grabbing one never selects what is under it.
    const gizmo = this.gizmoAt(e.clientX, e.clientY)
    if (gizmo && gizmo.kind !== 'inside') {
      this.press = { ...base, marquee: false, hit: null, grab: gizmo, inside: false }
      // The handle stays where it was grabbed (keys are written at this frame).
      pause()
      this.clearOwnHover()
      this.els.root.setPointerCapture(e.pointerId)
      return
    }
    // A drag inside the selection moves it; one that starts on a layer moves that layer; on
    // empty canvas it draws a marquee.
    const inside = gizmo !== null || this.insideSelection(e.clientX, e.clientY)
    const hit = this.isInteractive()
      ? this.pickAt(e.clientX, e.clientY, deep ? 'deep' : 'root')
      : null
    const marquee = this.isInteractive() && hit === null && !inside
    this.press = { ...base, marquee, hit, grab: null, inside }
    // Keep receiving the drag (move or marquee) when the pointer leaves the canvas.
    if (this.isInteractive()) this.els.root.setPointerCapture(e.pointerId)
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pan) {
      const dx = e.clientX - this.pan.x
      const dy = e.clientY - this.pan.y
      this.pan.x = e.clientX
      this.pan.y = e.clientY
      panView(dx, dy)
      return
    }
    this.pointer = { x: e.clientX, y: e.clientY }
    // The button was released where we did not see it: that press (and its drag) is over.
    if (e.buttons === 0) {
      this.press = null
      this.finishMove()
      this.finishTransform()
    }
    if (!this.press && isChromeTarget(e.target)) {
      // Over a chip or the banner: nothing on the canvas is targeted.
      this.hideCursor()
      this.clearOwnHover()
      this.setGizmoCursor(null)
      return
    }
    this.updateCursor(e)
    if (this.press) {
      const press = this.press
      if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD) {
        press.moved = true
        if (press.grab) this.beginTransform(press, press.grab)
        else if (press.marquee) this.beginMarquee(press)
        else if (press.inside && !(press.deep && press.hit)) {
          // ⌘ still picks the deepest node under the pointer, as outside the selection.
          if (!this.beginMoveSelection(press) && press.hit) this.beginMove(press, press.hit)
        } else if (press.hit) this.beginMove(press, press.hit)
      }
      if (this.marquee) {
        this.marquee.end = this.localPoint(e)
        this.scheduleMarquee()
      }
      if (this.mover.active)
        this.updateMove(e.clientX, e.clientY, e.shiftKey, hasModKey(e), e.altKey)
      if (this.transformer.active)
        this.updateTransform(e.clientX, e.clientY, e.shiftKey, hasModKey(e), e.altKey)
      return
    }
    this.updateHover(e.clientX, e.clientY, hasModKey(e))
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pan) {
      this.endPan()
      return
    }
    const press = this.press
    this.press = null
    if (this.marquee) {
      this.finishMarquee()
      return
    }
    if (this.mover.active) {
      this.finishMove()
      return
    }
    if (this.transformer.active) {
      this.finishTransform()
      return
    }
    // A click on a handle does nothing (it never selects what is under it).
    if (press && !press.moved && !press.grab && e.button === 0) this.click(e, press.inside)
  }

  private onPointerLeave(e: PointerEvent): void {
    setPointerOverViewport(false)
    if (this.pan) return
    this.pointer = null
    this.hideCursor()
    this.clearOwnHover()
    if (!this.transformer.active) this.setGizmoCursor(null)
    if (e.buttons === 0) this.press = null
  }

  private endPan(): void {
    if (!this.pan) return
    const { pointerId } = this.pan
    this.pan = null
    if (this.els.root.hasPointerCapture(pointerId)) this.els.root.releasePointerCapture(pointerId)
    this.setPanCursor(isSpaceHeld() ? 'ready' : null)
  }

  /* ------------------------------------------------------------------------ */
  /*                                Moving layers                             */
  /* ------------------------------------------------------------------------ */

  /** Document point under a client point (current camera). */
  private docPoint(clientX: number, clientY: number): Point | null {
    return this.layout ? layoutToDoc(this.layout, this.localPoint({ clientX, clientY })) : null
  }

  /**
   * A press on a layer turned into a drag: move the selection when the press grabbed a selected
   * node (or something inside one), otherwise select what was hit (Shift adds) and move that.
   */
  private beginMove(press: Press, hit: Hit): void {
    const doc = useDocument.getState().doc
    const start = this.docPoint(press.x, press.y)
    if (!doc || !start) return
    const selection = useDocument.getState().selection
    // Shared precomp content is edited through the instance under the pointer.
    noteInstancesInStack(doc, hit.stack)
    const grabbed = press.deep
      ? isNodeSelected(selection, hit.node)
      : selection.nodes.some((n) => {
          const owner = moveOwner(doc, n)
          return hit.stack.some((p) => pathEquals(p, n) || (owner !== null && pathEquals(p, owner)))
        })
    if (!grabbed) selectNodes([hit.node], press.shift ? 'add' : 'replace')
    const paths = useDocument.getState().selection.nodes
    if (!this.mover.begin(paths, start, hit.stack, this.binding.player.svg)) return
    this.startedDrag(press)
  }

  /**
   * A press inside the selection's box turned into a drag: the selection moves as it is, even
   * when the press was on another layer or on empty pixels (Figma). False when it cannot move.
   */
  private beginMoveSelection(press: Press): boolean {
    const doc = useDocument.getState().doc
    const start = this.docPoint(press.x, press.y)
    if (!doc || !start) return false
    const paths = useDocument.getState().selection.nodes
    // Shared precomp content moves in the instance it is drawn with handles in.
    this.noteShownInstances(doc)
    const hint = paths.flatMap((p) => instanceChainFor(doc, p) ?? [])
    if (!this.mover.begin(paths, start, hint, this.binding.player.svg)) return false
    this.startedDrag(press)
    return true
  }

  /**
   * Gestures on the selection edit shared precomp content in the instance it is shown in: from
   * now on the user works there (the layer tree and the timeline follow).
   */
  private noteShownInstances(doc: Animation): void {
    for (const { chain } of this.overlay?.shownInstances ?? []) noteInstanceChain(doc, chain)
  }

  private startedDrag(press: Press): void {
    this.clearOwnHover()
    this.setGizmoCursor(null)
    if (!this.els.root.hasPointerCapture(press.pointerId))
      this.els.root.setPointerCapture(press.pointerId)
    this.invalidateOverlay()
  }

  /** `constrain`: dominant axis only (Shift); `free`: no snapping (⌘/Ctrl); `copy`: Alt. */
  private updateMove(
    clientX: number,
    clientY: number,
    constrain: boolean,
    free: boolean,
    copy: boolean,
  ): void {
    const point = this.docPoint(clientX, clientY)
    if (!point || !this.mover.active || !this.layout) return
    const preview = this.mover.update(
      point,
      constrain,
      free ? null : SNAP_DISTANCE / this.layout.scaleX,
      copy,
    )
    this.setDragCursor(this.mover.duplicating ? 'copy' : 'move')
    // Guides can change without the position changing (Shift pressed at a snapped spot).
    this.invalidateOverlay()
    const readout = this.mover.readout
    this.showReadout(clientX, clientY, readout && moveReadout(readout))
    if (preview) this.binding.request(preview, false, DRAG_RELOAD_INTERVAL, true)
  }

  /**
   * Writes the drag to the document. The last preview already shows it: the written document
   * renders the same and keeps that player (no reload hitch at the end of a drag on big files).
   */
  private finishMove(): void {
    if (!this.mover.active) return
    this.mover.finish()
    this.setDragCursor(null)
    this.showReadout(0, 0, null)
    this.binding.request(useDocument.getState().doc, false, DRAG_RELOAD_INTERVAL)
    this.invalidateOverlay()
  }

  /** Drops a drag; `restore` shows the document as it is again (it was not changed). */
  private cancelMove(restore: boolean): void {
    if (!this.mover.active) return
    this.mover.cancel()
    this.setDragCursor(null)
    this.showReadout(0, 0, null)
    this.press = null
    if (restore) this.binding.restore(useDocument.getState().doc)
    this.invalidateOverlay()
  }

  /* ------------------------------------------------------------------------ */
  /*                          Resizing and rotating (gizmo)                    */
  /* ------------------------------------------------------------------------ */

  /** What the gizmo has under a client point (null: nothing, or no gizmo to grab). */
  private gizmoAt(clientX: number, clientY: number): GizmoHit | null {
    const view = this.overlay?.gizmo
    if (!view || this.kind !== 'edited' || isSpaceHeld()) return null
    return hitGizmo(view.quad, this.localPoint({ clientX, clientY }))
  }

  /** True when a client point is inside the box of a selected node (as drawn). */
  private insideSelection(clientX: number, clientY: number): boolean {
    if (!this.overlay || !this.isInteractive()) return false
    const p = this.localPoint({ clientX, clientY })
    return this.overlay.selectionQuads.some((q) => pointInQuad(q, p))
  }

  private beginTransform(press: Press, grab: TransformGrab): void {
    const gizmo = this.overlay?.gizmo
    const start = this.docPoint(press.x, press.y)
    const doc = useDocument.getState().doc
    if (!gizmo || !start || !doc) return
    if (!this.transformer.begin(grab, gizmo, start, this.binding.player.svg)) return
    this.noteShownInstances(doc)
    this.clearOwnHover()
    if (!this.els.root.hasPointerCapture(press.pointerId))
      this.els.root.setPointerCapture(press.pointerId)
    this.invalidateOverlay()
  }

  /** `keepProportions`: Shift; `free`: no snapping (⌘/Ctrl); `alt`: about the anchor / center. */
  private updateTransform(
    clientX: number,
    clientY: number,
    keepProportions: boolean,
    free: boolean,
    alt: boolean,
  ): void {
    const point = this.docPoint(clientX, clientY)
    const layout = this.layout
    if (!point || !layout || !this.transformer.active) return
    const preview = this.transformer.update(
      point,
      { shift: keepProportions, alt },
      free ? null : SNAP_DISTANCE / layout.scaleX,
      // A side never gets thinner than a screen pixel.
      1 / layout.scaleX,
    )
    this.updateTransformCursor()
    // Guides and pivot markers can change without the values changing.
    this.invalidateOverlay()
    const readout = this.transformer.readout
    this.showReadout(clientX, clientY, readout && transformReadout(readout))
    if (preview) this.binding.request(preview, false, DRAG_RELOAD_INTERVAL, true)
  }

  /** The cursor follows the handle's direction as the box turns or flips under the pointer. */
  private updateTransformCursor(): void {
    const grab = this.transformer.grab
    const overlay = this.transformer.overlay
    const layout = this.layout
    const quad = overlay?.geometry.outlines[0]?.quad
    if (!grab || !quad || !layout) return
    const view = quad.map((p) => docToLayout(layout, p)) as unknown as Quad
    this.setGizmoCursor(
      grab.kind === 'resize' ? resizeCursor(view, grab.handle) : rotateCursor(view, grab.corner),
    )
  }

  /** Writes the gesture to the document (one undo step); the last preview already shows it. */
  private finishTransform(): void {
    if (!this.transformer.active) return
    this.transformer.finish()
    this.showReadout(0, 0, null)
    this.binding.request(useDocument.getState().doc, false, DRAG_RELOAD_INTERVAL)
    this.refreshGizmoCursor()
    this.invalidateOverlay()
  }

  /** Drops the gesture; `restore` shows the document as it is again (it was not changed). */
  private cancelTransform(restore: boolean): void {
    if (!this.transformer.active) return
    this.transformer.cancel()
    this.showReadout(0, 0, null)
    this.press = null
    if (restore) this.binding.restore(useDocument.getState().doc)
    this.refreshGizmoCursor()
    this.invalidateOverlay()
  }

  /** After a gesture: the cursor of what is under the pointer once the overlay is redrawn. */
  private refreshGizmoCursor(): void {
    this.setGizmoCursor(null)
    requestAnimationFrame(() => {
      if (this.destroyed || this.transformer.active || !this.pointer) return
      this.updateGizmoHover(this.pointer.x, this.pointer.y)
    })
  }

  /**
   * Hover over the gizmo: the cursor of what a press would grab. True when the pointer is on a
   * handle or rotate zone (nothing on the canvas is targeted there).
   */
  private updateGizmoHover(clientX: number, clientY: number): boolean {
    const hit = this.gizmoAt(clientX, clientY)
    const view = this.overlay?.gizmo
    if (!hit || hit.kind === 'inside' || !view) {
      this.setGizmoCursor(null)
      return false
    }
    this.setGizmoCursor(
      hit.kind === 'resize'
        ? resizeCursor(view.quad, hit.handle)
        : rotateCursor(view.quad, hit.corner),
    )
    return true
  }

  private setGizmoCursor(cursor: string | null): void {
    const style = this.els.root.style
    const next = cursor ?? ''
    if (style.cursor !== next) style.cursor = next
  }

  /** The value being dragged, next to the pointer (like the timeline's drag readouts). */
  private showReadout(clientX: number, clientY: number, readout: ReadoutText | null): void {
    const el = this.els.readout
    if (!el) return
    if (!readout) {
      if (!el.hidden) el.hidden = true
      return
    }
    if (!this.readoutParts) {
      const main = document.createElement('span')
      const detail = document.createElement('span')
      detail.className = 'ml-2 text-fg-muted'
      el.replaceChildren(main, detail)
      this.readoutParts = { main, detail }
    }
    const { main, detail } = this.readoutParts
    if (main.textContent !== readout.main) main.textContent = readout.main
    const extra = readout.detail ?? ''
    if (detail.textContent !== extra) detail.textContent = extra
    detail.hidden = !extra
    if (el.hidden) el.hidden = false
    // Below-right of the pointer; flipped to the other side near the pane's edges.
    const p = this.localPoint({ clientX, clientY })
    const { offsetWidth: w, offsetHeight: h } = el
    const x = p.x + 14 + w > this.view.width - 8 ? p.x - 10 - w : p.x + 14
    const y = p.y + 18 + h > this.view.height - 8 ? p.y - 10 - h : p.y + 18
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Marquee                                */
  /* ------------------------------------------------------------------------ */

  private beginMarquee(press: { x: number; y: number; additive: boolean }): void {
    const layout = this.layout
    if (!layout) return
    const start = this.localPoint({ clientX: press.x, clientY: press.y })
    this.marquee = {
      start: layoutToDoc(layout, start),
      end: start,
      additive: press.additive,
      hits: [],
    }
    this.marqueeCache = null
    this.clearOwnHover()
  }

  private scheduleMarquee(): void {
    if (this.marqueeRaf) return
    this.marqueeRaf = requestAnimationFrame(() => {
      this.marqueeRaf = 0
      if (!this.marquee) return
      this.marquee.hits = this.marqueeHits()
      this.drawOverlay()
    })
  }

  /** Root layers with rendered shapes inside the marquee (locked layers excluded). */
  private marqueeHits(): NodePath[] {
    const m = this.marquee
    const layout = this.layout
    const doc = useDocument.getState().doc
    const svg = this.binding.player.svg
    if (!m || !layout || !doc || !svg) return []
    const rect = rectFromPoints(m.start, layoutToDoc(layout, m.end))
    const frame = usePlayback.getState().frame
    // Boxes only change with the frame or the document: measure every layer once per change.
    if (!this.marqueeCache || this.marqueeCache.frame !== frame || this.marqueeCache.doc !== doc) {
      this.marqueeCache = {
        frame,
        doc,
        quads: doc.layers.map((_, i) => measureNodeShapes(['layers', i], svg)),
      }
    }
    const hits: NodePath[] = []
    this.marqueeCache.quads.forEach((quads, i) => {
      const path: NodePath = ['layers', i]
      if (quads.some((q) => quadIntersectsRect(q, rect)) && !isLockedOnCanvas(path)) hits.push(path)
    })
    return hits
  }

  private finishMarquee(): void {
    const additive = this.marquee?.additive ?? false
    const hits = this.marqueeHits()
    this.cancelMarquee()
    if (hits.length) selectNodes(hits, additive ? 'add' : 'replace')
    else if (!additive) clearSelection()
  }

  private cancelMarquee(): void {
    if (!this.marquee) return
    this.marquee = null
    this.marqueeCache = null
    this.press = null
    if (this.marqueeRaf) cancelAnimationFrame(this.marqueeRaf)
    this.marqueeRaf = 0
    this.invalidateOverlay()
  }

  private onGesture(e: SafariGestureEvent): void {
    e.preventDefault()
    if (e.type === 'gesturestart') this.gestureZoom = useViewport.getState().camera.zoom
    else if (e.type === 'gestureend') this.gestureZoom = null
    else if (this.gestureZoom !== null && Number.isFinite(e.scale)) {
      markZoomGesture(ZOOM_SETTLE_MS)
      zoomTo(this.gestureZoom * e.scale, this.localPoint(e))
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()
    const page = this.view.height || 800
    if (e.ctrlKey || e.metaKey) {
      // Pinch / ⌘-wheel: zoom around the cursor; re-render crisply once the gesture pauses.
      markZoomGesture(ZOOM_SETTLE_MS)
      zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode, page), this.localPoint(e))
    } else {
      const { dx, dy } = wheelPanDelta(e, page)
      panView(dx, dy)
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                             Hit-testing / selection                      */
  /* ------------------------------------------------------------------------ */

  /** Tagged node paths under a client point, outermost first (SVG renderer only). */
  private stackAt(clientX: number, clientY: number): NodePath[] {
    if (!this.isInteractive()) return []
    const svg = this.binding.player.svg
    const el = svg ? document.elementFromPoint(clientX, clientY) : null
    if (!svg || !el || !svg.contains(el)) return []
    return hitStack(nodePathsFromElement(el, svg))
  }

  private pick(clientX: number, clientY: number, mode: HitMode): NodePath | null {
    return this.pickAt(clientX, clientY, mode)?.node ?? null
  }

  /** The node a click at a client point targets, with the tagged paths under the pointer. */
  private pickAt(clientX: number, clientY: number, mode: HitMode): Hit | null {
    const stack = this.stackAt(clientX, clientY)
    const picked = pickFromStack(stack, mode, isLockedOnCanvas)
    if (picked) return { node: picked, stack }
    if (stack.length === 0) return null
    // The top hit is locked: clicks pass through to the content underneath.
    const svg = this.binding.player.svg
    if (!svg) return null
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (el === svg || !svg.contains(el)) continue
      const below = hitStack(nodePathsFromElement(el, svg))
      const node = pickFromStack(below, mode, isLockedOnCanvas)
      if (node) return { node, stack: below }
    }
    return null
  }

  private updateHover(clientX: number, clientY: number, deep: boolean): void {
    if (this.kind !== 'edited' || this.pan || this.mover.active || this.transformer.active) return
    if (isSpaceHeld()) return
    // Over a handle: a press resizes or rotates the selection, it does not pick what is below.
    if (this.updateGizmoHover(clientX, clientY)) {
      this.clearOwnHover()
      return
    }
    const target = this.pick(clientX, clientY, deep ? 'deep' : 'root')
    if (!target) {
      this.clearOwnHover()
      return
    }
    if (!pathEquals(useUi.getState().hoverNode, target)) setHoverNode(target)
    this.ownsHover = true
  }

  private clearOwnHover(): void {
    if (!this.ownsHover) return
    this.ownsHover = false
    if (useUi.getState().hoverNode) setHoverNode(null)
  }

  /** `inside`: the click is inside the selection's box, where empty pixels keep the selection. */
  private click(e: PointerEvent, inside: boolean): void {
    // Hit-testing needs the SVG renderer: with Canvas, clicks select nothing (see toolbar hint).
    if (!this.isInteractive()) return
    const hit = this.pickAt(e.clientX, e.clientY, hasModKey(e) ? 'deep' : 'root')
    const doc = useDocument.getState().doc
    // The layer tree and the timeline show shared precomp content under the clicked instance.
    if (hit && doc) noteInstancesInStack(doc, hit.stack)
    if (hit) selectNodes([hit.node], e.shiftKey ? 'toggle' : 'replace')
    else if (!e.shiftKey && !inside) clearSelection()
  }

  private onDoubleClick(e: MouseEvent): void {
    if (isChromeTarget(e.target)) return
    // Handles are for dragging: a double-click there does not drill into what is below.
    const gizmo = this.gizmoAt(e.clientX, e.clientY)
    if (gizmo && gizmo.kind !== 'inside') return
    const doc = useDocument.getState().doc
    const stack = this.stackAt(e.clientX, e.clientY)
    if (!doc || !stack.length || stack.some(isLockedOnCanvas)) return
    const selection = useDocument.getState().selection
    const selectedIndex = stack.findLastIndex((p) => isNodeSelected(selection, p))
    const current = selectedIndex >= 0 ? stack[selectedIndex] : null
    const layer = current && isLayerPath(current) ? getAt<Layer>(doc, current) : undefined
    // Double-click on the selected text layer edits its text.
    if (current && layer && isTextLayer(layer)) {
      emit('edit-text', { path: current })
      return
    }
    let next = drillDown(stack, selection.nodes)
    // A precomp without a hittable child here: enter its first layer.
    if (!next && layer && isPrecompLayer(layer)) {
      const precomp = findPrecomp(doc, layer.refId)
      if (precomp && precomp.asset.layers.length > 0) next = ['assets', precomp.index, 'layers', 0]
    }
    if (!next) return
    noteInstancesInStack(doc, stack)
    selectNodes([next])
  }

  private onContextMenu(e: MouseEvent): void {
    if (isChromeTarget(e.target)) {
      // No canvas menu over chips (Radix skips opening when the event is default-prevented).
      e.preventDefault()
      return
    }
    // Right-click selects the node under the pointer first (Figma), keeping a multi-selection;
    // on a handle the menu is the selection's.
    if (this.kind !== 'edited') return
    const gizmo = this.gizmoAt(e.clientX, e.clientY)
    if (gizmo && gizmo.kind !== 'inside') return
    const hit = this.pickAt(e.clientX, e.clientY, hasModKey(e) ? 'deep' : 'root')
    const doc = useDocument.getState().doc
    if (hit && doc) noteInstancesInStack(doc, hit.stack)
    if (hit && !isNodeSelected(useDocument.getState().selection, hit.node)) selectNodes([hit.node])
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Chrome                                 */
  /* ------------------------------------------------------------------------ */

  private updateCursor(e: PointerEvent): void {
    const el = this.els.cursor
    const layout = this.layout
    const doc = this.sourceDoc()
    if (!el || !layout || !doc) return
    const p = layoutToDoc(layout, this.localPoint(e))
    if (p.x < 0 || p.y < 0 || p.x >= doc.w || p.y >= doc.h) {
      this.hideCursor()
      return
    }
    el.textContent = getT().viewport.cursor(Math.floor(p.x), Math.floor(p.y))
    if (el.hidden) el.hidden = false
  }

  private hideCursor(): void {
    const el = this.els.cursor
    if (el && !el.hidden) el.hidden = true
  }

  /** Cursor while dragging layers: the copy cursor tells an Alt-drag leaves the originals. */
  private setDragCursor(state: 'move' | 'copy' | null): void {
    if (state) this.els.root.dataset.drag = state
    else delete this.els.root.dataset.drag
  }

  private setPanCursor(state: 'ready' | 'active' | null): void {
    if (state) {
      this.els.root.dataset.pan = state
      // The hand wins over a handle's cursor (an inline style would hide it).
      this.setGizmoCursor(null)
    } else delete this.els.root.dataset.pan
  }
}
