/**
 * Imperative core of the timeline: horizontal scroll and zoom, the canvas ruler, the 60 fps
 * playhead and every pointer gesture (keyframe drags, layer bars, marquee, scrubbing, work
 * area, markers). React renders rows; per-frame and per-pixel work stays out of React.
 *
 * Coordinates: "content x" is measured from the left edge of the scrollable tracks content
 * (see geometry.ts); `scrollX` is how far that content is scrolled.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { isLocked } from '@/features/layers'
import { chainKey, instanceChainFor, noteInstanceChain } from '@/features/layers/instances'
import { getT, type Dict } from '@/i18n'
import { hasModKey } from '@/lib/platform'
import { uid } from '@/lib/id'
import { getMarkers, markerEnd, moveMarker, setMarkerDuration } from '@/lottie/markers'
import {
  compAssetIndexOf,
  getAt,
  isPathPrefix,
  layerPathOf,
  pathEquals,
  pathKey,
  type NodePath,
} from '@/lottie/path'
import { getKeyframes, type AnyProperty } from '@/lottie/property'
import {
  duplicateKeys,
  moveKeys,
  scaleKeys,
  shiftLayerTime,
  trimLayerIn,
  trimLayerOut,
  type KeyRef,
} from '@/lottie/timeline-ops'
import type { Animation, Layer, Marker } from '@/lottie/types'
import { isPrecompAsset, isPrecompLayer } from '@/lottie/types'
import {
  getDoc,
  isNodeSelected,
  selectNodes,
  undo,
  updateDoc,
  useDocument,
  type Selection,
} from '@/store/document'
import { setFrame, setWorkArea, usePlayback, type WorkArea } from '@/store/playback'
import { mapForPath } from './actions'
import { edgeSpeed, isDragging, startDrag } from './drag'
import {
  clampPpf,
  formatFrame,
  formatTickLabel,
  frameToX,
  KEY_HIT,
  NAMES_MIN_TRACK,
  SNAP_PX,
  snapDelta,
  tickSpec,
  ticksInRange,
  uniqueSorted,
  xToFrame,
  zoomLimits,
} from './geometry'
import { flattenRows, rowKeyTimes, summaryKeys, type FlatRow, type RowsResult } from './model'
import type { TimelineRuntime } from './runtime'
import {
  clearKeySelection,
  isRefSelected,
  indexSelection,
  refKey,
  selectFromTimeline,
  selectKeys,
} from './selection'
import {
  NAMES_WIDTH,
  setExpanded,
  setTimelinePrefs,
  setTimelineView,
  useTimelinePrefs,
  type TimeUnits,
} from './store'

export interface Metrics {
  ip: number
  op: number
  fps: number
  ppf: number
  namesWidth: number
  /** Visible width of the tracks (px). */
  viewWidth: number
  contentWidth: number
  units: TimeUnits
  /** Width of the body's vertical scrollbar (px). */
  scrollbar: number
}

interface RulerColors {
  minor: string
  major: string
  label: string
  font: string
}

const EMPTY_ROWS: RowsResult = { rows: [], height: 0, byKey: new Map() }

/** Snap unless ⌘/Ctrl is held; with snapping off, Shift snaps. */
export function wantsSnap(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  if (hasModKey(e)) return false
  return useTimelinePrefs.getState().snapping || e.shiftKey
}

const sel = (): Selection => useDocument.getState().selection
const round3 = (v: number) => Math.round(v * 1000) / 1000

export interface PropSnapshot {
  path: NodePath
  k: unknown
  a: AnyProperty['a']
}

/** Copies the keyframes of the properties of `refs` (drags re-apply from them every step). */
export function snapshotProps(doc: Animation, refs: readonly KeyRef[]): PropSnapshot[] {
  const seen = new Map<string, PropSnapshot>()
  for (const r of refs) {
    const key = pathKey(r.path)
    if (seen.has(key)) continue
    const prop = getAt<AnyProperty>(doc, r.path)
    if (prop) seen.set(key, { path: r.path, k: prop.k, a: prop.a })
  }
  return [...seen.values()]
}

/** Puts snapshotted keyframes back into a draft (drags re-apply from the start every step). */
export function restoreProps(draft: Animation, snaps: readonly PropSnapshot[]): void {
  for (const s of snaps) {
    const prop = getAt<AnyProperty>(draft, s.path)
    if (!prop) continue
    prop.k = JSON.parse(JSON.stringify(s.k)) as AnyProperty['k']
    if (s.a === undefined) delete prop.a
    else prop.a = s.a
  }
}

export class TimelineController implements TimelineRuntime {
  metrics: Metrics = {
    ip: 0,
    op: 1,
    fps: 30,
    ppf: 4,
    namesWidth: NAMES_WIDTH.initial,
    viewWidth: 0,
    contentWidth: 0,
    units: 'frames',
    scrollbar: 0,
  }
  rowsResult: RowsResult = EMPTY_ROWS
  scrollX = 0

  /** Element that carries the `--sx` scroll variable. */
  main: HTMLElement | null = null
  /** Vertical scroller of the rows. */
  body: HTMLElement | null = null
  /** Focus target for timeline-scoped keys. */
  root: HTMLElement | null = null
  canvas: HTMLCanvasElement | null = null
  /** Wrapper of the playhead head + line (content coordinates). */
  playhead: HTMLElement | null = null

  private pendingScroll: number | null = null
  /** A node to reveal once the rows that contain it have been rendered. */
  private pendingReveal: { path: NodePath; previous: readonly NodePath[] } | null = null
  /** A layer whose rows were just expanded: show them once rendered. */
  private pendingBlock: NodePath | null = null
  private scrollListeners = new Set<() => void>()
  private colors: RulerColors | null = null
  private lastFrame = 0

  /* ------------------------------------------------------------------------ */
  /*                               Sync with React                            */
  /* ------------------------------------------------------------------------ */

  private lastFlatten: RowsResult | undefined

  /** Flattens rows, reusing unchanged row objects from the previous call. */
  flatten(doc: Animation, t: Dict, expanded: Readonly<Record<string, boolean>>): RowsResult {
    const result = flattenRows(doc, t, expanded, this.lastFlatten)
    this.lastFlatten = result
    return result
  }

  /** Connects the DOM elements the controller drives. */
  attach(els: {
    main: HTMLElement | null
    body: HTMLElement | null
    root: HTMLElement | null
  }): void {
    this.main = els.main
    this.body = els.body
    this.root = els.root
  }

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas
    if (canvas) this.drawRuler()
  }

  attachPlayhead(el: HTMLElement | null): void {
    this.playhead = el
    if (el) this.setPlayheadFrame(usePlayback.getState().frame)
  }

  /** Called after every render with the latest metrics and rows. */
  sync(metrics: Metrics, rows: RowsResult): void {
    const prev = this.metrics
    this.metrics = metrics
    this.rowsResult = rows
    const max = Math.max(0, metrics.contentWidth - metrics.viewWidth)
    let x = this.pendingScroll ?? this.scrollX
    this.pendingScroll = null
    x = Math.min(max, Math.max(0, x))
    const changed =
      x !== this.scrollX ||
      prev.ppf !== metrics.ppf ||
      prev.ip !== metrics.ip ||
      prev.viewWidth !== metrics.viewWidth ||
      prev.units !== metrics.units ||
      prev.fps !== metrics.fps
    this.scrollX = x
    this.applyScroll(changed)
    this.setPlayheadFrame(this.lastFrame)
    if (this.pendingReveal) {
      const { path, previous } = this.pendingReveal
      this.pendingReveal = null
      // Nested precomps open one level per render; an open instance stops the walk.
      this.revealPath(path, true, previous)
    }
    if (this.pendingBlock) {
      const path = this.pendingBlock
      this.pendingBlock = null
      const row = rows.rows.find((r) => r.kind === 'layer' && pathEquals(r.model.path, path))
      if (row) this.revealBlock(row)
    }
  }

  /** Reads theme colors for the canvas ruler (call when the theme changes). */
  refreshColors(): void {
    const style = getComputedStyle(document.documentElement)
    const v = (name: string) => style.getPropertyValue(name).trim()
    this.colors = {
      minor: v('--le-line-strong'),
      major: v('--le-fg-faint'),
      label: v('--le-fg-subtle'),
      font: `500 11px ${getComputedStyle(document.body).fontFamily}`,
    }
    this.drawRuler()
  }

  onScroll(listener: () => void): () => void {
    this.scrollListeners.add(listener)
    return () => this.scrollListeners.delete(listener)
  }

  /* ------------------------------------------------------------------------ */
  /*                                Coordinates                               */
  /* ------------------------------------------------------------------------ */

  private tracksLeft(): number {
    return (this.main?.getBoundingClientRect().left ?? 0) + this.metrics.namesWidth
  }

  clientToContentX(clientX: number): number {
    return clientX - this.tracksLeft() + this.scrollX
  }

  clientXToFrame(clientX: number): number {
    return xToFrame(this.clientToContentX(clientX), this.metrics.ip, this.metrics.ppf)
  }

  frameToX(frame: number): number {
    return frameToX(frame, this.metrics.ip, this.metrics.ppf)
  }

  private clientToContentY(clientY: number): number {
    const body = this.body
    if (!body) return clientY
    return clientY - body.getBoundingClientRect().top + body.scrollTop
  }

  /* ------------------------------------------------------------------------ */
  /*                              Scroll and zoom                             */
  /* ------------------------------------------------------------------------ */

  private maxScroll(): number {
    return Math.max(0, this.metrics.contentWidth - this.metrics.viewWidth)
  }

  setScrollX(x: number): void {
    const next = Math.min(this.maxScroll(), Math.max(0, x))
    if (next === this.scrollX) return
    this.scrollX = next
    this.applyScroll(true)
  }

  private applyScroll(redraw: boolean): void {
    this.main?.style.setProperty('--sx', `${-this.scrollX}px`)
    if (redraw) this.drawRuler()
    this.scrollListeners.forEach((l) => l())
  }

  /** Zooms to `ppf`, keeping the frame under `clientX` (or the playhead / center) in place. */
  zoomTo(ppf: number, clientX?: number): void {
    const m = this.metrics
    const limits = zoomLimits(m.viewWidth, m.ip, m.op)
    const next = clampPpf(ppf, limits)
    // Already at a limit: nothing re-renders, so no scroll may stay pending.
    if (Math.abs(next - m.ppf) < 1e-9) return
    let anchor: number
    if (clientX !== undefined) anchor = clientX - this.tracksLeft()
    else {
      const px = this.frameToX(usePlayback.getState().frame) - this.scrollX
      anchor = px >= 0 && px <= m.viewWidth ? px : m.viewWidth / 2
    }
    const frame = xToFrame(anchor + this.scrollX, m.ip, m.ppf)
    this.pendingScroll = frameToX(frame, m.ip, next) - anchor
    setTimelineView({ ppf: next, fit: next <= limits.min * 1.0001 })
  }

  zoomBy(factor: number, clientX?: number): void {
    this.zoomTo(this.metrics.ppf * factor, clientX)
  }

  zoomFit(): void {
    this.pendingScroll = 0
    setTimelineView({ fit: true })
  }

  /** Zooms so the root-frame range [start, end] fills the view (double-click on a layer bar). */
  zoomToRange(start: number, end: number): void {
    const m = this.metrics
    const margin = 24
    const limits = zoomLimits(m.viewWidth, m.ip, m.op)
    const next = clampPpf((m.viewWidth - margin * 2) / Math.max(1, end - start), limits)
    const x = frameToX(start, m.ip, next) - margin
    if (Math.abs(next - m.ppf) < 1e-9) {
      // Same scale: nothing re-renders, so scroll right away.
      this.setScrollX(x)
      return
    }
    this.pendingScroll = x
    setTimelineView({ ppf: next, fit: next <= limits.min * 1.0001 })
  }

  /** Wheel: ⌘/Ctrl (or pinch) zooms around the pointer; horizontal deltas / Shift scroll time. */
  handleWheel(e: WheelEvent, overTracks: boolean): void {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * unit * 0.0025)
      // Over the tracks the frame under the pointer stays put; elsewhere the playhead does.
      this.zoomBy(Math.min(2, Math.max(0.5, factor)), overTracks ? e.clientX : undefined)
      return
    }
    let dx = e.deltaX * unit
    if (e.shiftKey && dx === 0) {
      dx = e.deltaY * unit
      e.preventDefault()
    }
    if (dx !== 0 && overTracks) {
      if (Math.abs(dx) > Math.abs(e.deltaY)) e.preventDefault()
      this.setScrollX(this.scrollX + dx)
    }
  }

  ensureFrameVisible(frame: number, margin = 24): void {
    const x = this.frameToX(frame)
    const { viewWidth } = this.metrics
    if (x < this.scrollX + margin) this.setScrollX(x - margin)
    else if (x > this.scrollX + viewWidth - margin) this.setScrollX(x - viewWidth + margin)
  }

  /** Vertical scroll state of the rows (kept by the body so reveals never force a layout). */
  private bodyView = { top: 0, height: 0 }

  noteBodyView(top: number, height: number): void {
    this.bodyView = { top, height }
  }

  revealRow(row: FlatRow): void {
    const body = this.body
    if (!body) return
    const { top: viewTop, height } = this.bodyView
    const top = row.top
    const bottom = row.top + row.height
    let next: number | null = null
    if (top < viewTop) next = top
    else if (height > 0 && bottom > viewTop + height) next = bottom - height
    if (next === null) return
    this.bodyView = { top: next, height }
    body.scrollTop = next
  }

  /**
   * Scrolls a row and its expanded descendants into view (as much as fits, the row itself
   * first), e.g. a layer whose properties were just revealed.
   */
  revealBlock(row: FlatRow): void {
    const body = this.body
    if (!body) return
    const list = this.rowsResult.rows
    let end = row.top + row.height
    for (
      let i = list.indexOf(row) + 1;
      i > 0 && i < list.length && list[i].depth > row.depth;
      i++
    ) {
      end = list[i].top + list[i].height
    }
    const { top: viewTop, height } = this.bodyView
    if (height <= 0) return
    let next = viewTop
    if (end - row.top >= height || row.top < viewTop) next = row.top
    else if (end > viewTop + height) next = end - height
    if (next === viewTop) return
    this.bodyView = { top: next, height }
    body.scrollTop = next
  }

  /** Shows a layer's rows once the pending expansion has rendered (U, "reveal animated"). */
  revealExpanded(path: NodePath): void {
    this.pendingBlock = path
  }

  rows(): RowsResult {
    return this.rowsResult
  }

  /**
   * Remembers the precomp instance the user works in (shared with the canvas and the layer
   * tree): its timing is used by paste, nudges and the selection bracket.
   */
  notePreferred(row: FlatRow): void {
    const doc = getDoc()
    if (doc && row.chain.length) noteInstanceChain(doc, row.chain)
  }

  /** Forgets per-document state when another document is opened. */
  resetDocument(): void {
    this.lastFlatten = undefined
    this.scrollX = 0
    this.pendingScroll = 0
  }

  focus(): void {
    this.root?.focus({ preventScroll: true })
  }

  focusRows(): void {
    ;(this.body ?? this.root)?.focus({ preventScroll: true })
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Ruler                                  */
  /* ------------------------------------------------------------------------ */

  drawRuler(): void {
    const canvas = this.canvas
    if (!canvas) return
    if (!this.colors) {
      this.refreshColors()
      return
    }
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(width * dpr)
    const h = Math.round(height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const { ip, op, ppf, fps, units } = this.metrics
    const t = getT()
    const spec = tickSpec(ppf, fps, units)
    const from = Math.max(ip, xToFrame(this.scrollX, ip, ppf) - spec.major)
    const to = Math.min(op, xToFrame(this.scrollX + width, ip, ppf) + spec.major)
    const px = (f: number) => Math.round((frameToX(f, ip, ppf) - this.scrollX) * dpr) / dpr
    const hair = 1 / dpr

    // Layout (24px): work-area strip on top, labels, then ticks along the bottom edge.
    ctx.fillStyle = this.colors.minor
    for (const f of ticksInRange(from, to, spec.minor)) {
      if (Math.abs(f / spec.major - Math.round(f / spec.major)) < 1e-6) continue
      ctx.fillRect(px(f), height - 4, Math.max(hair, 1), 4)
    }
    ctx.font = this.colors.font
    ctx.textBaseline = 'alphabetic'
    for (const f of ticksInRange(from, to, spec.major)) {
      const x = px(f)
      ctx.fillStyle = this.colors.major
      ctx.fillRect(x, height - 8, Math.max(hair, 1), 8)
      ctx.fillStyle = this.colors.label
      ctx.fillText(formatTickLabel(f, fps, units, t.common.secondsShort), x + 4, height - 7)
    }
  }

  /* ------------------------------------------------------------------------ */
  /*                                  Playhead                                */
  /* ------------------------------------------------------------------------ */

  setPlayheadFrame(frame: number): void {
    this.lastFrame = frame
    if (this.playhead) this.playhead.style.transform = `translateX(${this.frameToX(frame)}px)`
  }

  /** Frame subscription: moves the playhead and pages the view to follow playback. */
  onFrame(frame: number): void {
    this.setPlayheadFrame(frame)
    if (isDragging() || this.maxScroll() === 0) return
    const x = this.frameToX(frame)
    const { viewWidth } = this.metrics
    if (x >= this.scrollX && x <= this.scrollX + viewWidth) return
    if (usePlayback.getState().playing) this.setScrollX(x - 24)
    else this.ensureFrameVisible(frame)
  }

  /* ------------------------------------------------------------------------ */
  /*                                  Snapping                                */
  /* ------------------------------------------------------------------------ */

  /** Frames keys and bars snap to: playhead, ends, work area, markers, layer ends and keys. */
  snapTargets(
    opts: {
      skipKeys?: (ref: KeyRef) => boolean
      skipLayers?: ReadonlySet<string>
      keys?: boolean
    } = {},
  ): number[] {
    const doc = getDoc()
    const m = this.metrics
    const targets: number[] = [Math.round(usePlayback.getState().frame), m.ip, m.op]
    const wa = usePlayback.getState().workArea
    if (wa) targets.push(wa.start, wa.end)
    if (doc) for (const marker of getMarkers(doc)) targets.push(marker.tm, markerEnd(marker))
    // Every layer row counts, including each open instance of shared precomp content: the same
    // layer sits at another time in every instance.
    for (const row of this.rowsResult.rows) {
      if (row.kind !== 'layer' || !row.map) continue
      const key = pathKey(row.model.path)
      const map = row.map
      if (!opts.skipLayers?.has(key))
        targets.push(map.toRoot(row.model.layer.ip), map.toRoot(row.model.layer.op))
      if (opts.keys === false) continue
      for (const p of row.model.props) {
        getKeyframes(p.prop)?.forEach((kf, index) => {
          if (opts.skipKeys?.({ path: p.path, index })) return
          if (opts.skipLayers?.has(key)) return
          targets.push(map.toRoot(kf.t))
        })
      }
    }
    return uniqueSorted(targets)
  }

  snapThreshold(): number {
    return SNAP_PX / this.metrics.ppf
  }

  /* ------------------------------------------------------------------------ */
  /*                               Keyframe drags                             */
  /* ------------------------------------------------------------------------ */

  /**
   * Pointer down on keyframes (a key, a collapsed summary dot or a segment): selection rules
   * (click replaces, Shift/⌘ toggles), then drag to move (Alt duplicates). One undo step.
   */
  onKeysPointerDown(
    e: ReactPointerEvent,
    row: FlatRow,
    refs: KeyRef[],
    rootTime: number,
    opts: { focus?: NodePath | null; nodes?: NodePath[] } = {},
  ): void {
    if (e.button !== 0 || refs.length === 0) return
    e.stopPropagation()
    e.preventDefault()
    this.focus()
    this.notePreferred(row)
    const index = indexSelection(sel())
    const allSelected = refs.every((r) => isRefSelected(index, r))
    const toggle = e.shiftKey || hasModKey(e)
    let clickReplaces = false
    const select = (mode: 'replace' | 'add' | 'remove') =>
      selectKeys(refs, mode, {
        focus: opts.focus,
        nodes: mode === 'replace' ? opts.nodes : undefined,
      })
    if (toggle) {
      select(allSelected ? 'remove' : 'add')
      if (allSelected) return
    } else if (!allSelected) select('replace')
    else clickReplaces = true

    if (!row.map?.linear) return
    const doc = getDoc()
    if (!doc) return
    const scaleFor = this.scaleResolver(row, doc)
    // Keys of time-remapped content and of locked layers stay selected but do not move.
    const dragRefs = sel().keyframes.filter((r) => scaleFor(r.path) !== null && !isLocked(r.path))
    if (dragRefs.length === 0) {
      if (clickReplaces) select('replace')
      return
    }
    const snaps = snapshotProps(doc, dragRefs)
    const dragged = new Set(dragRefs.map(refKey))
    const targets = this.snapTargets({ skipKeys: (r) => dragged.has(refKey(r)) })
    const startFrame = this.clientXToFrame(e.clientX)
    const coalesceKey = uid('timeline-keys')
    const t = getT().timeline
    // Nothing is committed until the keys actually move (no no-op history entries).
    let last = { delta: 0, dup: false }
    let changed = false

    const apply = (delta: number, dup: boolean) => {
      let next: KeyRef[] = dragRefs
      changed =
        updateDoc(
          dup ? t.history.duplicateKeys : t.history.moveKeys,
          (draft) => {
            restoreProps(draft, snaps)
            if (delta === 0 && !dup) return
            const local = (path: NodePath) => round3(delta / (scaleFor(path) ?? 1))
            next = dup ? duplicateKeys(draft, dragRefs, local) : moveKeys(draft, dragRefs, local)
          },
          // In progress until the pointer is released: one undo step however long it pauses.
          { coalesceKey, final: false, selection: () => ({ ...sel(), keyframes: next }) },
        ) || changed
    }

    startDrag(e, {
      cursor: 'ew-resize',
      onMove: (ev) => {
        const raw = this.clientXToFrame(ev.clientX) - startFrame
        let delta = Math.round(raw)
        let snapped: number | null = null
        if (wantsSnap(ev)) {
          const hit = snapDelta([rootTime], raw, targets, this.snapThreshold())
          if (hit.target !== null) {
            delta = round3(hit.delta)
            snapped = hit.target
          }
        }
        const dup = ev.altKey
        if (last.delta !== delta || last.dup !== dup) {
          last = { delta, dup }
          apply(delta, dup)
        }
        const frame = formatFrame(rootTime + delta)
        setTimelineView({
          feedback: {
            x: ev.clientX,
            y: ev.clientY,
            text: dup
              ? t.drag.duplicate(frame, formatFrame(delta))
              : t.drag.frame(frame, formatFrame(delta)),
          },
          snapFrame: snapped,
        })
      },
      autoScroll: (ev) => this.autoScrollX(ev),
      onEnd: ({ moved, cancelled }) => {
        setTimelineView({ feedback: null, snapFrame: null })
        if (cancelled && moved && changed) this.undoGesture(coalesceKey)
        if (!moved && clickReplaces) select('replace')
      },
    })
  }

  /**
   * Root frames per local frame for a property (precomp stretch), to convert drag deltas.
   * Null for time-remapped content, which cannot be moved by a root-time delta.
   */
  private scaleResolver(anchor: FlatRow, doc: Animation): (path: NodePath) => number | null {
    const byComp = new Map<number | null, number | null>()
    if (anchor.map?.linear) byComp.set(anchor.comp, anchor.map.scale)
    return (path) => {
      const comp = compAssetIndexOf(layerPathOf(path) ?? path)
      if (!byComp.has(comp)) {
        // The instance the user works in (or the first one) sets the time scale.
        const map = mapForPath(doc, path)
        byComp.set(comp, map?.linear ? map.scale : null)
      }
      const scale = byComp.get(comp) ?? null
      return scale === null || scale === 0 || !Number.isFinite(scale) ? null : scale
    }
  }

  /**
   * Esc: the gesture never happened. Its (single) history entry is undone and not kept for
   * redo either — "Redo" must not bring back a drag the user cancelled.
   */
  undoGesture(coalesceKey: string): void {
    const past = useDocument.getState().past
    if (past[past.length - 1]?.coalesceKey !== coalesceKey) return
    const entry = undo()
    const { future } = useDocument.getState()
    if (entry && future[0] === entry) useDocument.setState({ future: future.slice(1) })
  }

  autoScrollX(ev: PointerEvent): boolean {
    const left = this.tracksLeft()
    const speed = edgeSpeed(ev.clientX, left, left + this.metrics.viewWidth)
    if (speed === 0) return false
    const before = this.scrollX
    this.setScrollX(this.scrollX + speed)
    return this.scrollX !== before
  }

  private autoScrollY(ev: PointerEvent): boolean {
    const body = this.body
    if (!body) return false
    const rect = body.getBoundingClientRect()
    const speed = edgeSpeed(ev.clientY, rect.top, rect.bottom, 24, 14)
    if (speed === 0) return false
    const before = body.scrollTop
    body.scrollTop += speed
    return body.scrollTop !== before
  }

  /* ------------------------------------------------------------------------ */
  /*                          Selection bracket (scale)                       */
  /* ------------------------------------------------------------------------ */

  /**
   * Drag an end of the selection bracket to scale the timing of the selected keys around the
   * opposite end (After Effects Alt-drag / Lottie Creator retime, without the modifier clash).
   */
  onBracketPointerDown(e: ReactPointerEvent, side: 'start' | 'end', span: [number, number]): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const doc = getDoc()
    const refs = sel().keyframes.filter((r) => !isLocked(r.path))
    if (!doc || refs.length < 2 || span[1] - span[0] <= 0) return
    const snaps = snapshotProps(doc, refs)
    const dragged = new Set(refs.map(refKey))
    const targets = this.snapTargets({ skipKeys: (r) => dragged.has(refKey(r)) })
    const [start, end] = span
    const pivot = side === 'start' ? end : start
    const moving = side === 'start' ? start : end
    const coalesceKey = uid('timeline-scale')
    const t = getT().timeline
    // The same instance timing the bracket was drawn with (see useSelectionSpan).
    const pivotIn = (path: NodePath) => mapForPath(doc, path)?.toLocal(pivot) ?? pivot
    let lastEdge = moving
    let changed = false

    startDrag(e, {
      threshold: 1,
      cursor: 'ew-resize',
      onMove: (ev) => {
        let edge = Math.round(this.clientXToFrame(ev.clientX))
        let snapped: number | null = null
        if (wantsSnap(ev)) {
          const hit = snapDelta(
            [moving],
            this.clientXToFrame(ev.clientX) - moving,
            targets,
            this.snapThreshold(),
          )
          if (hit.target !== null) {
            edge = round3(moving + hit.delta)
            snapped = hit.target
          }
        }
        // Never flip the selection over its pivot.
        edge = side === 'start' ? Math.min(edge, pivot - 1) : Math.max(edge, pivot + 1)
        const factor = (edge - pivot) / (moving - pivot)
        if (edge !== lastEdge) {
          lastEdge = edge
          let next = refs
          changed =
            updateDoc(
              t.history.scaleKeys,
              (draft) => {
                restoreProps(draft, snaps)
                next = scaleKeys(draft, refs, factor, pivotIn)
              },
              { coalesceKey, final: false, selection: () => ({ ...sel(), keyframes: next }) },
            ) || changed
        }
        setTimelineView({
          feedback: {
            x: ev.clientX,
            y: ev.clientY,
            text: t.drag.scale(String(Math.round(factor * 100))),
          },
          snapFrame: snapped,
        })
      },
      autoScroll: (ev) => this.autoScrollX(ev),
      onEnd: ({ moved, cancelled }) => {
        setTimelineView({ feedback: null, snapFrame: null })
        if (cancelled && moved && changed) this.undoGesture(coalesceKey)
      },
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                                 Layer bars                               */
  /* ------------------------------------------------------------------------ */

  onBarPointerDown(e: ReactPointerEvent, row: FlatRow, mode: 'move' | 'in' | 'out'): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    this.focus()
    this.notePreferred(row)
    const path = row.model.path
    const toggle = e.shiftKey || hasModKey(e)
    const wasSelected = isNodeSelected(sel(), path)
    let clickReplaces = false
    if (toggle) {
      selectFromTimeline(() => selectNodes([path], 'toggle'))
      if (wasSelected) return
    } else if (!wasSelected) selectFromTimeline(() => selectNodes([path], 'replace'))
    else clickReplaces = true

    const doc = getDoc()
    // A locked layer can be selected here, not dragged.
    if (!doc || !row.map?.linear || isLocked(path)) return
    // Every selected (unlocked) layer moves together; each converts the delta with its own time scale.
    const items: { path: NodePath; scale: number; ip: number; op: number }[] = []
    const seen = new Set<string>()
    for (const node of sel().nodes) {
      const key = pathKey(node)
      if (seen.has(key)) continue
      const layerRow = pathEquals(node, path)
        ? row
        : this.rowsResult.rows.find((r) => r.kind === 'layer' && pathEquals(r.model.path, node))
      const layer = getAt<Layer>(doc, node)
      if (!layerRow?.map?.linear || !layer || layerRow.kind !== 'layer' || isLocked(node)) continue
      seen.add(key)
      items.push({ path: node, scale: layerRow.map.scale || 1, ip: layer.ip, op: layer.op })
    }
    if (items.length === 0) return
    const grabbed = row.model.layer
    const map = row.map
    const anchors =
      mode === 'move'
        ? [map.toRoot(grabbed.ip), map.toRoot(grabbed.op)]
        : mode === 'in'
          ? [map.toRoot(grabbed.ip)]
          : [map.toRoot(grabbed.op)]
    const targets = this.snapTargets({ skipLayers: seen })
    const startFrame = this.clientXToFrame(e.clientX)
    const coalesceKey = uid('timeline-layer')
    const t = getT().timeline
    const applied = new Map<string, number>()
    let lastDelta: number | null = null
    let changed = false

    const apply = (delta: number) => {
      const label =
        mode === 'move' ? t.history.moveLayer : mode === 'in' ? t.history.trimIn : t.history.trimOut
      changed =
        updateDoc(
          label,
          (draft) => {
            for (const item of items) {
              const layer = getAt<Layer>(draft, item.path)
              if (!layer) continue
              const local = round3(delta / item.scale)
              if (mode === 'move') {
                // Incremental: shifting keyframes has no collisions, so no restore is needed.
                const key = pathKey(item.path)
                shiftLayerTime(layer, local - (applied.get(key) ?? 0))
                applied.set(key, local)
              } else if (mode === 'in') trimLayerIn(layer, item.ip + local)
              else trimLayerOut(layer, item.op + local)
            }
          },
          { coalesceKey, final: false },
        ) || changed
    }

    startDrag(e, {
      cursor: mode === 'move' ? 'grabbing' : 'ew-resize',
      onMove: (ev) => {
        const raw = this.clientXToFrame(ev.clientX) - startFrame
        let delta = Math.round(raw)
        let snapped: number | null = null
        if (wantsSnap(ev)) {
          const hit = snapDelta(anchors, raw, targets, this.snapThreshold())
          if (hit.target !== null) {
            delta = round3(hit.delta)
            snapped = hit.target
          }
        }
        // Keep at least one visible frame on the grabbed layer (others clamp themselves).
        if (mode === 'in') delta = Math.min(delta, map.toRoot(grabbed.op) - 1 - anchors[0])
        if (mode === 'out') delta = Math.max(delta, map.toRoot(grabbed.ip) + 1 - anchors[0])
        if (delta !== lastDelta) {
          lastDelta = delta
          apply(delta)
        }
        const d = formatFrame(delta)
        const text =
          mode === 'move'
            ? t.drag.layer(formatFrame(anchors[0] + delta), formatFrame(anchors[1] + delta), d)
            : mode === 'in'
              ? t.drag.inPoint(formatFrame(anchors[0] + delta), d)
              : t.drag.outPoint(formatFrame(anchors[0] + delta), d)
        setTimelineView({ feedback: { x: ev.clientX, y: ev.clientY, text }, snapFrame: snapped })
      },
      autoScroll: (ev) => this.autoScrollX(ev),
      onEnd: ({ moved, cancelled }) => {
        setTimelineView({ feedback: null, snapFrame: null })
        if (cancelled && moved && changed) this.undoGesture(coalesceKey)
        if (!moved && clickReplaces) selectFromTimeline(() => selectNodes([path], 'replace'))
      },
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Marquee                                */
  /* ------------------------------------------------------------------------ */

  /** Keyframe refs whose glyphs lie inside a content-space rectangle. */
  private keysInRect(x0: number, x1: number, y0: number, y1: number): KeyRef[] {
    const out: KeyRef[] = []
    const pad = KEY_HIT / 2 - 2
    for (const row of this.rowsResult.rows) {
      if (row.top + row.height < y0 || row.top > y1) continue
      const center = row.top + row.height / 2
      if (center + 5 < y0 || center - 5 > y1) continue
      const map = row.map
      if (!map) continue
      const inside = (t: number) => {
        const x = this.frameToX(map.toRoot(t))
        return x + pad >= x0 && x - pad <= x1
      }
      if (row.kind === 'property' && row.node?.kind === 'property') {
        const node = row.node
        getKeyframes(node.prop)?.forEach((kf, index) => {
          if (inside(kf.t)) out.push({ path: node.path, index })
        })
      } else if (!row.expanded) {
        const props =
          row.kind === 'layer' ? row.model.props : row.node?.kind === 'group' ? row.node.props : []
        for (const s of summaryKeys(props)) if (inside(s.t)) out.push(...s.refs)
      }
    }
    const seen = new Set<string>()
    return out.filter((r) => {
      const k = refKey(r)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }

  /** Pointer down on empty track space: marquee-select keyframes (Shift/⌘ adds); click clears. */
  onTrackPointerDown(e: ReactPointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    this.focus()
    const additive = e.shiftKey || hasModKey(e)
    const base = additive ? sel().keyframes : []
    const start = { x: this.clientToContentX(e.clientX), y: this.clientToContentY(e.clientY) }
    const startScroll = { x: this.scrollX, y: this.body?.scrollTop ?? 0 }
    const update = (ev: PointerEvent) => {
      const cur = { x: this.clientToContentX(ev.clientX), y: this.clientToContentY(ev.clientY) }
      const x0 = Math.min(start.x, cur.x)
      const x1 = Math.max(start.x, cur.x)
      const y0 = Math.min(start.y, cur.y)
      const y1 = Math.max(start.y, cur.y)
      const found = this.keysInRect(x0, x1, y0, y1)
      const keys = new Set(base.map(refKey))
      selectKeys([...base, ...found.filter((r) => !keys.has(refKey(r)))], 'replace', {
        keepNodes: true,
        focus: null,
      })
      // The rectangle is drawn in client space: convert back through the current scroll.
      const dx = this.scrollX - startScroll.x
      const dy = (this.body?.scrollTop ?? 0) - startScroll.y
      const sx = e.clientX - dx
      const sy = e.clientY - dy
      setTimelineView({
        marquee: {
          left: Math.min(sx, ev.clientX),
          top: Math.min(sy, ev.clientY),
          width: Math.abs(ev.clientX - sx),
          height: Math.abs(ev.clientY - sy),
        },
      })
    }
    startDrag(e, {
      onMove: update,
      autoScroll: (ev) => {
        const x = this.autoScrollX(ev)
        const y = this.autoScrollY(ev)
        return x || y
      },
      onEnd: ({ moved }) => {
        setTimelineView({ marquee: null })
        if (!moved) {
          if (!additive) clearKeySelection()
          return
        }
        // Settle: select the owners of the keys (inspector context), like a click would.
        selectKeys(sel().keyframes, 'replace')
      },
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                            Ruler and work area                           */
  /* ------------------------------------------------------------------------ */

  /** Click jumps, drag scrubs (Shift snaps to keys, markers and in/out points). */
  onRulerPointerDown(e: ReactPointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    this.focus()
    let targets: number[] | null = null
    const scrub = (ev: { clientX: number; shiftKey: boolean }) => {
      let frame = this.clientXToFrame(ev.clientX)
      if (ev.shiftKey) {
        targets ??= this.snapTargets()
        const hit = snapDelta([frame], 0, targets, this.snapThreshold())
        if (hit.target !== null) frame = hit.target
      }
      setFrame(frame, { allowSubframe: false })
    }
    setTimelineView({ scrubbing: true })
    scrub(e)
    startDrag(e, {
      threshold: 0,
      cursor: 'ew-resize',
      onMove: scrub,
      autoScroll: (ev) => this.autoScrollX(ev),
      onEnd: () => setTimelineView({ scrubbing: false }),
    })
  }

  onWorkAreaPointerDown(e: ReactPointerEvent, part: 'start' | 'end' | 'body'): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const m = this.metrics
    const initial: WorkArea = usePlayback.getState().workArea ?? { start: m.ip, end: m.op }
    const targets = this.snapTargets()
    const startFrame = this.clientXToFrame(e.clientX)
    const t = getT().timeline
    const anchors =
      part === 'start'
        ? [initial.start]
        : part === 'end'
          ? [initial.end]
          : [initial.start, initial.end]
    startDrag(e, {
      threshold: 2,
      cursor: part === 'body' ? 'grabbing' : 'ew-resize',
      onMove: (ev) => {
        const raw = this.clientXToFrame(ev.clientX) - startFrame
        let delta = Math.round(raw)
        if (wantsSnap(ev)) {
          const hit = snapDelta(anchors, raw, targets, this.snapThreshold())
          if (hit.target !== null) delta = Math.round(hit.delta)
        }
        let { start, end } = initial
        if (part === 'start') start = Math.min(Math.max(m.ip, start + delta), end - 1)
        else if (part === 'end') end = Math.max(Math.min(m.op, end + delta), start + 1)
        else {
          const length = end - start
          start = Math.min(Math.max(m.ip, start + delta), m.op - length)
          end = start + length
        }
        setWorkArea({ start, end })
        setTimelineView({
          feedback: {
            x: ev.clientX,
            y: ev.clientY,
            text: t.drag.workArea(formatFrame(start), formatFrame(end - 1)),
          },
        })
      },
      autoScroll: (ev) => this.autoScrollX(ev),
      onEnd: () => setTimelineView({ feedback: null }),
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Markers                                */
  /* ------------------------------------------------------------------------ */

  onMarkerPointerDown(e: ReactPointerEvent, index: number, part: 'flag' | 'end'): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    this.focus()
    const doc = getDoc()
    const marker: Marker | undefined = doc ? getMarkers(doc)[index] : undefined
    if (!doc || !marker) return
    const original = JSON.parse(JSON.stringify(getMarkers(doc))) as Marker[]
    const targets = this.snapTargets().filter((f) => f !== marker.tm && f !== markerEnd(marker))
    const startFrame = this.clientXToFrame(e.clientX)
    const coalesceKey = uid('timeline-marker')
    const t = getT().timeline
    const anchor = part === 'flag' ? marker.tm : markerEnd(marker)
    let lastDelta = 0
    let changed = false

    startDrag(e, {
      cursor: 'ew-resize',
      onMove: (ev) => {
        const raw = this.clientXToFrame(ev.clientX) - startFrame
        let delta = Math.round(raw)
        let snapped: number | null = null
        if (wantsSnap(ev)) {
          const hit = snapDelta([anchor], raw, targets, this.snapThreshold())
          if (hit.target !== null) {
            delta = round3(hit.delta)
            snapped = hit.target
          }
        }
        if (part === 'end') delta = Math.max(delta, marker.tm - anchor)
        if (delta !== lastDelta) {
          lastDelta = delta
          changed =
            updateDoc(
              part === 'flag' ? t.history.moveMarker : t.history.markerDuration,
              (draft) => {
                draft.markers = JSON.parse(JSON.stringify(original)) as Marker[]
                if (part === 'flag') moveMarker(draft, index, marker.tm + delta)
                else setMarkerDuration(draft, index, anchor + delta - marker.tm)
              },
              { coalesceKey, final: false },
            ) || changed
        }
        const text =
          part === 'flag'
            ? t.drag.frame(formatFrame(marker.tm + delta), formatFrame(delta))
            : t.drag.duration(formatFrame(anchor + delta - marker.tm))
        setTimelineView({ feedback: { x: ev.clientX, y: ev.clientY, text }, snapFrame: snapped })
      },
      autoScroll: (ev) => this.autoScrollX(ev),
      onEnd: ({ moved, cancelled }) => {
        setTimelineView({ feedback: null, snapFrame: null })
        if (cancelled && moved && changed) this.undoGesture(coalesceKey)
        if (!moved && !cancelled) setFrame(marker.tm)
      },
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                            Resizing and scrollbar                        */
  /* ------------------------------------------------------------------------ */

  onNamesResizePointerDown(e: ReactPointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    const start = this.metrics.namesWidth
    const total = (this.main?.clientWidth ?? 0) - this.metrics.scrollbar
    const max = Math.max(NAMES_WIDTH.min, Math.min(NAMES_WIDTH.max, total - NAMES_MIN_TRACK))
    startDrag(e, {
      threshold: 0,
      cursor: 'col-resize',
      onMove: (_ev, { dx }) =>
        setTimelinePrefs({
          namesWidth: Math.round(Math.min(max, Math.max(NAMES_WIDTH.min, start + dx))),
        }),
      onEnd: () => {},
    })
  }

  onScrollThumbPointerDown(e: ReactPointerEvent, trackWidth: number, thumbWidth: number): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const start = this.scrollX
    const ratio = this.maxScroll() / Math.max(1, trackWidth - thumbWidth)
    startDrag(e, {
      threshold: 0,
      onMove: (_ev, { dx }) => this.setScrollX(start + dx * ratio),
      onEnd: () => {},
    })
  }

  /**
   * Scrolls to the row of a node (`reveal-node`, selections made elsewhere). A node inside a
   * collapsed precomp opens the instance showing it — preferably the one the user works in
   * (see @/features/layers/instances), or one of `previous` (e.g. the precomp layer the user
   * drilled into on the canvas) — level by level, then scrolls once its rows exist. Without
   * `expand` (or when that instance is open already) it scrolls to the instance row.
   */
  revealPath(path: NodePath, expand = true, previous: readonly NodePath[] = []): void {
    const doc = getDoc()
    const chain = doc ? (instanceChainFor(doc, path) ?? []) : []
    const prefer = [...chain, ...previous]
    const row = this.findLayerRow(path, chain)
    // Open the working instance even when the node is visible in another one.
    const inChain = !!row && (chain.length === 0 || row.chainKey === chainKey(chain))
    if (row && (inChain || !expand)) {
      this.revealRow(row)
      return
    }
    const instance = this.findInstanceRow(path, prefer)
    if (!instance) {
      if (row) this.revealRow(row)
      return
    }
    if (!expand || instance.expanded) {
      this.revealRow(row && !chain.length ? row : instance)
      return
    }
    this.pendingReveal = { path, previous }
    setExpanded([instance.key], true)
  }

  /**
   * The precomp layer row to open to show `path`: rows whose composition contains the node's
   * (directly or through nested precomps), one of `prefer` first (only ones not yet open when
   * something is), else the innermost.
   */
  private findInstanceRow(path: NodePath, prefer: readonly NodePath[]): FlatRow | undefined {
    const doc = getDoc()
    const asset = compAssetIndexOf(layerPathOf(path) ?? path)
    const target = asset === null ? undefined : doc?.assets?.[asset]?.id
    if (!doc || target === undefined) return undefined
    const reaches = new Map<string, boolean>()
    const leadsTo = (id: string, seen: ReadonlySet<string>): boolean => {
      if (id === target) return true
      const known = reaches.get(id)
      if (known !== undefined) return known
      if (seen.has(id)) return false
      const comp = doc.assets?.find((a) => a.id === id)
      const next = new Set(seen).add(id)
      const found =
        !!comp &&
        isPrecompAsset(comp) &&
        comp.layers.some((l) => isPrecompLayer(l) && leadsTo(l.refId, next))
      reaches.set(id, found)
      return found
    }
    const candidates = this.rowsResult.rows.filter(
      (r) =>
        r.kind === 'layer' &&
        isPrecompLayer(r.model.layer) &&
        leadsTo(r.model.layer.refId, new Set()),
    )
    const preferred = new Set(prefer.map(pathKey))
    // Nested instances: the deepest preferred row that is still closed is the next level to open.
    let chosen: FlatRow | undefined
    for (const r of candidates) {
      if (!preferred.has(pathKey(r.model.path))) continue
      if (!r.chain.every((p) => preferred.has(pathKey(p)))) continue
      if (!chosen || (chosen.expanded && !r.expanded) || r.depth > chosen.depth) chosen = r
    }
    if (chosen) return chosen
    let innermost: FlatRow | undefined
    for (const r of candidates) if (!innermost || r.depth > innermost.depth) innermost = r
    return innermost
  }

  /**
   * The visible row of a layer path (or of the layer holding a node), preferring the one under
   * the instance chain `chain` when the layer is shown by several open precomp instances.
   */
  findLayerRow(path: NodePath, chain: readonly NodePath[] = []): FlatRow | undefined {
    const key = chainKey(chain)
    let first: FlatRow | undefined
    for (const r of this.rowsResult.rows) {
      if (r.kind !== 'layer' || !isPathPrefix(r.model.path, path)) continue
      if (r.model.path.length > path.length) continue
      if (r.chainKey === key) return r
      first ??= r
    }
    return first
  }

  /** Key times of every row (for J/K without a selection). */
  allRowTimes(): number[] {
    return this.rowsResult.rows.flatMap(rowKeyTimes)
  }
}
