/**
 * The graph editor's imperative core: draws the curves on a canvas (sampled per pixel column,
 * redrawn once per animation frame after any change) and runs its gestures: key drags in time
 * and value, bezier / influence-speed handle drags, marquee, panning and wheel zoom.
 *
 * Time is the timeline's (same zoom, scroll, ruler grid and snapping); the value axis fits the
 * curves unless the user zoomed or panned it. Every drag is one undo step and Esc cancels it.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { isLocked } from '@/features/layers'
import { getT } from '@/i18n'
import { formatDecimal } from '@/lib/format'
import { uid } from '@/lib/id'
import { roundTo } from '@/lib/math'
import { hasModKey, isMac } from '@/lib/platform'
import { insertKeyframe, findKeyframeAt } from '@/lottie/keyframes'
import { getAt, pathKey, setAt, type NodePath } from '@/lottie/path'
import { getKeyframes, type AnyProperty } from '@/lottie/property'
import { moveKeys, normalizeLegacyKeys, type KeyRef } from '@/lottie/timeline-ops'
import { getDoc, updateDoc, useDocument } from '@/store/document'
import { setFrame } from '@/store/playback'
import { mapForPath } from '../actions'
import { restoreProps, snapshotProps, wantsSnap, type TimelineController } from '../controller'
import { startDrag } from '../drag'
import { formatFrame, snapDelta, tickSpec, ticksInRange, TRACK_PAD } from '../geometry'
import {
  clearKeySelection,
  indexSelection,
  isRefSelected,
  refKey,
  selectKeys,
  type SelectionIndex,
} from '../selection'
import { setTimelineView, useTimelineView } from '../store'
import { hasPerDimEase, setKeyComponents, writeEase } from './edit'
import {
  dragDecimals,
  easeWithSpeed,
  fitRange,
  polylineDistance,
  sameSpeed,
  stepDecimals,
  valueTicks,
} from './math'
import {
  AXIS_COLORS,
  CURVE_COLORS,
  displaySpeed,
  propPrefix,
  segmentSpeed,
  valuesAt,
  type GraphCurve,
  type GraphModel,
  type GraphProp,
} from './model'
import {
  channelChange,
  channelEase,
  ColumnCache,
  curveGeometry,
  curveHandles,
  easeForHandleDrag,
  sideSpeed,
  speedEditable,
  valueEditable,
  type CurveGeometry,
  type GraphViewport,
  type HandleGeometry,
} from './sample'
import { asGraphSelection, pinGraph, setGraphDims, setHoverCurve, useGraphState } from './state'

/** Plot insets: room above the curves and above the timeline's horizontal scrollbar. */
const PLOT_TOP = 16
const PLOT_BOTTOM = 20
const KEY_SIZE = 7
const HANDLE_RADIUS = 3.5
const HIT_KEY = 7
const HIT_HANDLE = 7
const HIT_CURVE = 4

const round3 = (v: number) => Math.round(v * 1000) / 1000

interface Palette {
  grid: string
  zero: string
  label: string
  surface: string
  accent: string
  accentFg: string
  muted: string
  font: string
  tokens: Map<string, string>
}

export type GraphHit =
  | { kind: 'handle'; curve: GraphCurve; handle: HandleGeometry }
  | { kind: 'key'; curve: GraphCurve; index: number; x: number; y: number }
  /**
   * `seg`: the segment under the pointer (-1 before the first key, last key index after);
   * `outside`: on the flat part before the first or after the last key.
   */
  | {
      kind: 'curve'
      curve: GraphCurve
      seg: number
      frame: number
      x: number
      y: number
      outside: boolean
    }

/** Parts of the hover readout (a small label next to the pointer), `[data-part]` children. */
interface ReadoutParts {
  root: HTMLElement
  swatch: HTMLElement
  label: HTMLElement
  value: HTMLElement
  meta: HTMLElement
}

function readoutParts(root: HTMLElement | null): ReadoutParts | null {
  if (!root) return null
  const part = (name: string) => root.querySelector<HTMLElement>(`[data-part="${name}"]`)
  const [swatch, label, value, meta] = ['swatch', 'label', 'value', 'meta'].map(part)
  return swatch && label && value && meta ? { root, swatch, label, value, meta } : null
}

interface ValueEdit {
  path: NodePath
  index: number
  dims: number[]
  from: number[]
  /** Stored units per axis unit. */
  perAxis: number[]
  decimals: number[]
  /** Color channels stay within 0..1. */
  unit: boolean
}

/** New stored value of one dimension of a value drag. */
function editedValue(edit: ValueEdit, i: number, dn: number): number {
  const v = roundTo(edit.from[i] + dn * edit.perAxis[i], edit.decimals[i])
  return edit.unit ? Math.min(1, Math.max(0, v)) : v
}

function sameHit(a: GraphHit | null, b: GraphHit | null): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind || a.curve.id !== b.curve.id) return false
  if (a.kind === 'handle' && b.kind === 'handle')
    return a.handle.key === b.handle.key && a.handle.side === b.handle.side
  if (a.kind === 'key' && b.kind === 'key') return a.index === b.index
  return a.kind === 'curve'
}

export class GraphController {
  readonly timeline: TimelineController
  canvas: HTMLCanvasElement | null = null
  private readout: ReadoutParts | null = null
  private width = 0
  private height = 0
  model: GraphModel | null = null
  private palette: Palette | null = null
  private raf = 0
  /** Axis range held while a drag runs (a fit would move the curves under the pointer). */
  private frozen: [number, number] | null = null
  private hover: GraphHit | null = null
  private geometry: CurveGeometry[] = []
  private handles: { curve: GraphCurve; handle: HandleGeometry }[] = []
  private disposers: (() => void)[] = []
  private metricsSeen: TimelineController['metrics'] | null = null

  constructor(timeline: TimelineController) {
    this.timeline = timeline
  }

  /* ------------------------------------------------------------------------ */
  /*                                 Lifecycle                                */
  /* ------------------------------------------------------------------------ */

  attach(canvas: HTMLCanvasElement | null, readout: HTMLElement | null): void {
    this.canvas = canvas
    this.readout = readoutParts(readout)
    this.disposers.forEach((d) => d())
    this.disposers = []
    if (!canvas) return
    // Redraw on horizontal scroll, selection, pinned dims, legend hover and range changes.
    this.disposers.push(
      this.timeline.onScroll(() => this.invalidate()),
      useDocument.subscribe(
        (s) => s.selection,
        () => this.invalidate(),
      ),
      useGraphState.subscribe(() => this.invalidate()),
      useTimelineView.subscribe((s, prev) => {
        if (s.graphFit !== prev.graphFit || s.graphRange !== prev.graphRange) this.invalidate()
      }),
    )
    this.invalidate()
  }

  detach(): void {
    this.attach(null, null)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.invalidate()
  }

  setModel(model: GraphModel): void {
    this.model = model
    this.invalidate()
  }

  /** The timeline's zoom, scroll range or names column changed (time axis moves). */
  onMetrics(metrics: TimelineController['metrics']): void {
    if (metrics !== this.metricsSeen) {
      this.metricsSeen = metrics
      this.invalidate()
    }
  }

  /** Reads theme colors (call when the theme changes). */
  refreshColors(): void {
    const root = getComputedStyle(document.documentElement)
    const v = (name: string) => root.getPropertyValue(name).trim()
    const tokens = new Map<string, string>()
    for (const name of [...AXIS_COLORS, ...CURVE_COLORS]) tokens.set(name, v(name))
    this.palette = {
      grid: v('--le-line-subtle'),
      zero: v('--le-line-strong'),
      label: v('--le-fg-subtle'),
      surface: v('--le-surface-1'),
      accent: v('--le-accent'),
      accentFg: v('--le-accent-fg'),
      muted: v('--le-fg-faint'),
      font: `500 10px ${getComputedStyle(document.body).fontFamily}`,
      tokens,
    }
    this.invalidate()
  }

  invalidate(): void {
    if (this.raf || !this.canvas) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.draw()
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                               Axes and view                              */
  /* ------------------------------------------------------------------------ */

  private plotHeight(): number {
    return Math.max(1, this.height - PLOT_TOP - PLOT_BOTTOM)
  }

  /** Range of the curves (axis units), padded for flat curves. */
  fittedRange(): [number, number] {
    const m = this.model
    if (!m || !(m.max >= m.min)) return [0, 1]
    return fitRange(m.min, m.max)
  }

  /** Visible axis range: frozen during drags, the user's range, or the fit. */
  range(): [number, number] {
    if (this.frozen) return this.frozen
    const view = useTimelineView.getState()
    if (!view.graphFit && view.graphRange) return view.graphRange
    return this.fittedRange()
  }

  viewport(): GraphViewport {
    const { ip, ppf } = this.timeline.metrics
    const sx = this.timeline.scrollX
    const [min, max] = this.range()
    const top = PLOT_TOP
    const h = this.plotHeight()
    const span = max - min || 1
    return {
      width: this.width,
      x: (f) => TRACK_PAD + (f - ip) * ppf - sx,
      frame: (x) => ip + (x + sx - TRACK_PAD) / ppf,
      y: (n) => top + ((max - n) / span) * h,
      n: (y) => max - ((y - top) / h) * span,
    }
  }

  /** Sets the user's value range (stops following the curves). */
  private setRange(range: [number, number]): void {
    const span = range[1] - range[0]
    if (!(span > 1e-9) || !Number.isFinite(span) || span > 1e12) return
    setTimelineView({ graphFit: false, graphRange: range })
  }

  /** Follow the curves again. */
  fit(): void {
    setTimelineView({ graphFit: true, graphRange: null })
  }

  /* ------------------------------------------------------------------------ */
  /*                                  Drawing                                 */
  /* ------------------------------------------------------------------------ */

  /** The curve drawn on top: hovered in the legend or on the canvas. */
  private hotCurve(): string | null {
    return useGraphState.getState().hoverCurve ?? this.hover?.curve.id ?? null
  }

  /**
   * Hovering a legend entry asks to single a curve out: the others fade. Hovering on the canvas
   * only thickens the curve (fading everything whenever the pointer crosses a curve is noisy).
   */
  private focusCurve(): string | null {
    const legend = useGraphState.getState().hoverCurve
    return legend !== null && legend !== (this.hover?.curve.id ?? null) ? legend : null
  }

  /** Keys of a curve whose points are selected (per-dimension selection in the value graph). */
  private selectedKeys(curve: GraphCurve, index: SelectionIndex): Set<number> {
    const keys = index.keys.get(curve.prop.key)
    if (!keys || keys.size === 0) return new Set()
    if (this.model?.mode === 'value' && curve.dim !== null) {
      const dims = useGraphState.getState().dims?.[curve.prop.key]
      if (dims && !dims.includes(curve.dim)) return new Set()
    }
    return keys
  }

  private draw(): void {
    const canvas = this.canvas
    const width = this.width
    const height = this.height
    if (!canvas || width <= 0 || height <= 0) return
    if (!this.palette) this.refreshColors()
    const palette = this.palette!
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
    this.geometry = []
    this.handles = []
    const model = this.model
    if (!model || model.curves.length === 0) return

    const vp = this.viewport()
    const labels = this.drawGrid(ctx, vp, palette)

    const columns = new ColumnCache(vp)
    const geometry = model.curves.map((c) => curveGeometry(c, model.mode, vp, model.fps, columns))
    this.geometry = geometry
    const hot = this.hotCurve()
    const focus = this.focusCurve()
    const selection = indexSelection(useDocument.getState().selection)

    for (const geo of geometry)
      if (geo.curve.id !== hot) this.drawCurve(ctx, geo, palette, hot, focus)
    const hotGeo = geometry.find((g) => g.curve.id === hot)
    if (hotGeo) this.drawCurve(ctx, hotGeo, palette, hot, focus)

    for (const geo of geometry) {
      if (!geo.curve.prop.editable) continue
      const keys = this.selectedKeys(geo.curve, selection)
      if (keys.size === 0) continue
      for (const handle of curveHandles(geo.curve, model.mode, vp, model.fps, keys))
        this.handles.push({ curve: geo.curve, handle })
    }
    this.drawHandles(ctx, palette)
    for (const geo of geometry) this.drawKeys(ctx, geo, palette, selection, focus)
    this.drawLabels(ctx, labels, palette)
  }

  /** Grid lines; returns the value labels (drawn last, over the curves). */
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    vp: GraphViewport,
    palette: Palette,
  ): [number, string][] {
    const { ip, op, ppf, fps, units } = this.timeline.metrics
    const width = this.width
    // Time: the ruler's labelled ticks.
    const spec = tickSpec(ppf, fps, units)
    ctx.fillStyle = palette.grid
    const from = Math.max(ip, vp.frame(0) - spec.major)
    const to = Math.min(op, vp.frame(width) + spec.major)
    for (const f of ticksInRange(from, to, spec.major)) {
      ctx.fillRect(Math.round(vp.x(f)), 0, 1, this.height)
    }
    // Value: nice steps, zero a little stronger.
    const [min, max] = this.range()
    const { step, values } = valueTicks(min, max, this.plotHeight())
    const normalized = !!this.model?.normalize
    const decimals = stepDecimals(normalized ? step * 100 : step)
    const labels: [number, string][] = []
    for (const v of values) {
      const y = Math.round(vp.y(v))
      ctx.fillStyle = v === 0 && !normalized ? palette.zero : palette.grid
      ctx.fillRect(0, y, width, 1)
      if (y < 12 || y > this.height - 4) continue
      labels.push([
        y,
        normalized ? `${formatDecimal(v * 100, decimals)}%` : formatDecimal(v, decimals),
      ])
    }
    return labels
  }

  /** Value labels at the left edge, with a knockout halo so they read over curves and keys. */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    labels: [number, string][],
    palette: Palette,
  ): void {
    ctx.font = palette.font
    ctx.textBaseline = 'bottom'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = palette.surface
    ctx.fillStyle = palette.label
    for (const [y, text] of labels) {
      ctx.strokeText(text, 5, y - 2)
      ctx.fillText(text, 5, y - 2)
    }
  }

  private drawCurve(
    ctx: CanvasRenderingContext2D,
    geo: CurveGeometry,
    palette: Palette,
    hot: string | null,
    focus: string | null,
  ): void {
    const color = palette.tokens.get(geo.curve.color) || palette.label
    const isHot = hot === geo.curve.id
    const dim = focus !== null && focus !== geo.curve.id ? 0.35 : 1
    const fade = geo.curve.prop.editable ? 1 : 0.6
    ctx.strokeStyle = color
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const line of geo.lines) {
      const pts = line.pts
      if (pts.length < 4) continue
      ctx.globalAlpha = (line.outside ? 0.35 : 1) * dim * fade
      ctx.lineWidth = line.outside ? 1 : isHot ? 2 : 1.5
      ctx.beginPath()
      ctx.moveTo(pts[0], pts[1])
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
      ctx.stroke()
    }
    if (geo.jumps.length) {
      ctx.globalAlpha = 0.65 * dim * fade
      ctx.lineWidth = 1
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      for (const [x, y0, y1] of geo.jumps) {
        ctx.moveTo(Math.round(x) + 0.5, y0)
        ctx.lineTo(Math.round(x) + 0.5, y1)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.globalAlpha = 1
  }

  private drawHandles(ctx: CanvasRenderingContext2D, palette: Palette): void {
    if (this.handles.length === 0) return
    ctx.strokeStyle = palette.accent
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    for (const { handle } of this.handles) {
      ctx.moveTo(handle.ax, handle.ay)
      ctx.lineTo(handle.x, handle.y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    const hover = this.hover?.kind === 'handle' ? this.hover : null
    for (const { curve, handle } of this.handles) {
      const hovered =
        !!hover &&
        hover.curve.id === curve.id &&
        hover.handle.key === handle.key &&
        hover.handle.side === handle.side
      ctx.beginPath()
      ctx.arc(handle.x, handle.y, HANDLE_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = hovered ? palette.accent : palette.surface
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = palette.accent
      ctx.stroke()
    }
  }

  private drawKeys(
    ctx: CanvasRenderingContext2D,
    geo: CurveGeometry,
    palette: Palette,
    selection: SelectionIndex,
    focus: string | null,
  ): void {
    const curve = geo.curve
    const color = palette.tokens.get(curve.color) || palette.label
    const selected = this.selectedKeys(curve, selection)
    const editable = curve.prop.editable
    const faded = focus !== null && focus !== curve.id
    const hover = this.hover?.kind === 'key' && this.hover.curve.id === curve.id ? this.hover : null
    const half = KEY_SIZE / 2
    for (const k of geo.keys) {
      const isSelected = selected.has(k.index)
      const isHover = hover?.index === k.index
      ctx.globalAlpha = faded && !isSelected ? 0.5 : 1
      if (k.inY !== undefined) {
        // Speed graph: the incoming speed, where it differs from the outgoing one.
        ctx.beginPath()
        ctx.arc(k.x, k.inY, 2, 0, Math.PI * 2)
        ctx.fillStyle = isSelected ? palette.accent : color
        ctx.fill()
      }
      const left = Math.round(k.x - half)
      const top = Math.round(k.y - half)
      if (isSelected) {
        ctx.fillStyle = palette.accent
        ctx.fillRect(left, top, KEY_SIZE, KEY_SIZE)
        ctx.strokeStyle = palette.accentFg
        ctx.globalAlpha *= 0.9
        ctx.lineWidth = 1
        ctx.strokeRect(left + 0.5, top + 0.5, KEY_SIZE - 1, KEY_SIZE - 1)
        continue
      }
      ctx.fillStyle = isHover && editable ? color : palette.surface
      ctx.fillRect(left, top, KEY_SIZE, KEY_SIZE)
      ctx.strokeStyle = editable ? color : palette.muted
      ctx.lineWidth = 1
      ctx.strokeRect(left + 0.5, top + 0.5, KEY_SIZE - 1, KEY_SIZE - 1)
    }
    ctx.globalAlpha = 1
  }

  /* ------------------------------------------------------------------------ */
  /*                                Hit testing                               */
  /* ------------------------------------------------------------------------ */

  /** What is under a point of the canvas (handles above keys above curves). */
  hitTest(x: number, y: number, handles = true): GraphHit | null {
    let best: GraphHit | null = null
    let bestDist = HIT_HANDLE
    for (let i = handles ? this.handles.length - 1 : -1; i >= 0; i--) {
      const { curve, handle } = this.handles[i]
      const d = Math.hypot(x - handle.x, y - handle.y)
      if (d <= bestDist) {
        best = { kind: 'handle', curve, handle }
        bestDist = d
      }
    }
    if (best) return best
    bestDist = HIT_KEY
    const hot = this.hotCurve()
    // The hot curve wins ties: it is drawn on top.
    const ordered = [...this.geometry].sort(
      (a, b) => Number(a.curve.id === hot) - Number(b.curve.id === hot),
    )
    for (const geo of ordered) {
      for (const k of geo.keys) {
        const d = Math.min(
          Math.hypot(x - k.x, y - k.y),
          k.inY !== undefined ? Math.hypot(x - k.x, y - k.inY) : Infinity,
        )
        if (d <= bestDist) {
          best = { kind: 'key', curve: geo.curve, index: k.index, x: k.x, y: k.y }
          bestDist = d
        }
      }
    }
    if (best) return best
    bestDist = HIT_CURVE
    let found: { geo: CurveGeometry; d: number; outside: boolean } | null = null
    for (const geo of ordered) {
      for (const line of geo.lines) {
        const d = polylineDistance(x, y, line.pts)
        if (d <= bestDist) {
          found = { geo, d, outside: line.outside }
          bestDist = d
        }
      }
    }
    if (!found) return null
    const curve = found.geo.curve
    const frame = this.viewport().frame(x)
    const map = curve.prop.map
    let seg = -1
    if (map) {
      curve.prop.kfs.forEach((kf, i) => {
        if (map.toRoot(kf.t) <= frame) seg = i
      })
    }
    return { kind: 'curve', curve, seg, frame, x, y, outside: found.outside }
  }

  private localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect()
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 }
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Hover                                  */
  /* ------------------------------------------------------------------------ */

  onPointerMove(e: ReactPointerEvent): void {
    if (e.buttons !== 0) return
    const { x, y } = this.localPoint(e)
    const hit = this.hitTest(x, y)
    this.showReadout(hit, x, y)
    if (sameHit(hit, this.hover)) return
    this.hover = hit
    setHoverCurve(hit?.curve.id ?? null)
    this.invalidate()
  }

  onPointerLeave(): void {
    this.showReadout(null, 0, 0)
    if (!this.hover) return
    this.hover = null
    setHoverCurve(null)
    this.invalidate()
  }

  private curveName(curve: GraphCurve): string {
    const p = curve.prop
    const layers = new Set(this.model?.props.map((q) => q.owner)).size > 1
    const prefix = propPrefix(p, layers)
    const base = prefix ? `${prefix} › ${p.label}` : p.label
    return curve.dimLabel ? `${base} ${curve.dimLabel}` : base
  }

  /** Formats a display value of a curve with its unit (speeds per second). */
  private formatValue(curve: GraphCurve, display: number): string {
    const p = curve.prop
    const t = getT().timeline.graph
    if (this.model?.mode === 'speed') {
      const decimals = Math.abs(display) < 10 ? 2 : Math.abs(display) < 100 ? 1 : 0
      return `${formatDecimal(display, decimals)}${t.perSecond(p.unit)}`
    }
    return `${formatDecimal(display, Math.max(p.precision, 1))}${p.unit}`
  }

  private showReadout(hit: GraphHit | null, x: number, y: number): void {
    const r = this.readout
    if (!r) return
    const model = this.model
    if (!hit || !model) {
      r.root.style.display = 'none'
      return
    }
    const t = getT().timeline.graph
    const curve = hit.curve
    const p = curve.prop
    const dim = curve.dim ?? 0
    let value = ''
    let meta = ''
    if (hit.kind === 'handle') {
      const { handle } = hit
      const seg = handle.seg
      const ease = channelEase(seg, model.mode === 'value' ? dim : curve.dim)
      const influence = handle.side === 'out' ? ease.x1 : 1 - ease.x2
      const speed = sideSpeed(seg, model.mode === 'value' ? dim : curve.dim, handle.side, ease)
      value = t.influence(formatDecimal(influence * 100, 1))
      meta = t.speedOf(this.speedText(p, speed))
    } else if (hit.kind === 'key') {
      const kf = p.kfs[hit.index]
      const root = p.map ? p.map.toRoot(kf.t) : kf.t
      meta = t.atFrame(formatFrame(root))
      if (model.mode === 'value')
        value = this.formatValue(curve, (p.keyValues[hit.index][dim] ?? 0) * p.factor)
      else {
        const seg = p.segments[hit.index] ?? p.segments[hit.index - 1]
        const speed = seg ? segmentSpeed(seg, curve.dim, p.segments[hit.index] ? 0 : 1) : 0
        value = this.formatValue(curve, displaySpeed(p, speed, model.fps))
      }
    } else {
      const map = p.map
      if (!map) return
      const local = map.toLocal(hit.frame)
      meta = t.atFrame(formatFrame(Math.round(hit.frame * 10) / 10))
      if (model.mode === 'value') {
        value = this.formatValue(curve, (valuesAt(p, local)[dim] ?? 0) * p.factor)
      } else {
        const seg = p.segments.find((s) => s.t0 <= local && local < s.t1)
        const speed = seg ? segmentSpeed(seg, curve.dim, (local - seg.t0) / (seg.t1 - seg.t0)) : 0
        value = this.formatValue(curve, displaySpeed(p, speed, model.fps))
      }
    }
    const palette = this.palette
    r.swatch.style.background = palette?.tokens.get(curve.color) ?? ''
    r.label.textContent = hit.kind === 'handle' ? '' : this.curveName(curve)
    r.label.style.display = hit.kind === 'handle' ? 'none' : ''
    r.value.textContent = value
    r.meta.textContent = meta
    r.root.style.display = 'flex'
    // Next to the pointer; flipped to the left near the right edge.
    const box = r.root.getBoundingClientRect()
    const left = x + 14 + box.width > this.width ? x - 14 - box.width : x + 14
    const top = Math.max(2, y - 30)
    r.root.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  private speedText(p: GraphProp, storedSpeed: number): string {
    const display = displaySpeed(p, storedSpeed, this.model?.fps ?? 30)
    const decimals = Math.abs(display) < 10 ? 2 : Math.abs(display) < 100 ? 1 : 0
    return `${formatDecimal(display, decimals)}${getT().timeline.graph.perSecond(p.unit)}`
  }

  /* ------------------------------------------------------------------------ */
  /*                                 Selection                                */
  /* ------------------------------------------------------------------------ */

  /** Keeps the shown curves while the graph changes the selection. */
  private pin(): void {
    const doc = getDoc()
    if (doc && this.model)
      pinGraph(
        doc,
        this.model.props.map((p) => p.path),
      )
  }

  /** Selects key points: keyframes, plus the dimension they were picked on (value graph). */
  private selectPoints(
    refs: readonly KeyRef[],
    p: GraphProp,
    dim: number | null,
    mode: 'replace' | 'add' | 'remove',
  ): void {
    this.pin()
    asGraphSelection(() => {
      const hadKeys = useDocument
        .getState()
        .selection.keyframes.some((k) => pathKey(k.path) === p.key)
      selectKeys(refs, mode, { focus: p.path })
      const current = useGraphState.getState().dims
      let next = current
      if (mode === 'replace') next = dim === null ? null : { [p.key]: [dim] }
      else if (mode === 'add' && dim !== null) {
        const own = current?.[p.key]
        if (own) next = { ...current, [p.key]: [...new Set([...own, dim])] }
        else if (!hadKeys) next = { ...current, [p.key]: [dim] }
      }
      setGraphDims(next)
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                                 Gestures                                 */
  /* ------------------------------------------------------------------------ */

  onPointerDown(e: ReactPointerEvent): void {
    if (e.button === 1) {
      e.preventDefault()
      this.pan(e)
      return
    }
    if (e.button !== 0) return
    e.preventDefault()
    this.timeline.focus()
    const { x, y } = this.localPoint(e)
    const hit = this.hitTest(x, y)
    this.showReadout(null, 0, 0)
    // The flat extensions before the first and after the last key are not draggable.
    if (!hit || (hit.kind === 'curve' && hit.outside)) {
      this.marquee(e, x, y)
      return
    }
    if (hit.kind === 'handle') {
      this.dragHandle(e, hit)
      return
    }
    this.dragKeys(e, hit, x, y)
  }

  /** Keys and segments: click selects (Shift/⌘ toggles), drag moves in time and value. */
  private dragKeys(
    e: ReactPointerEvent,
    hit: Exclude<GraphHit, { kind: 'handle' }>,
    x0: number,
    y0: number,
  ): void {
    const model = this.model
    const doc = getDoc()
    if (!model || !doc) return
    const curve = hit.curve
    const p = curve.prop
    const last = p.kfs.length - 1
    const refs: KeyRef[] =
      hit.kind === 'key'
        ? [{ path: p.path, index: hit.index }]
        : hit.seg < 0
          ? [{ path: p.path, index: 0 }]
          : hit.seg >= last
            ? [{ path: p.path, index: last }]
            : [
                { path: p.path, index: hit.seg },
                { path: p.path, index: hit.seg + 1 },
              ]
    const dim = model.mode === 'value' ? curve.dim : null
    const index = indexSelection(useDocument.getState().selection)
    const ownDims = useGraphState.getState().dims?.[p.key]
    const pointSelected = (r: KeyRef) =>
      isRefSelected(index, r) && (dim === null || !ownDims || ownDims.includes(dim))
    const allSelected = refs.every(pointSelected)
    const toggle = e.shiftKey || hasModKey(e)
    let clickReplaces = false
    const select = (mode: 'replace' | 'add' | 'remove') => this.selectPoints(refs, p, dim, mode)
    if (toggle) {
      select(allSelected ? 'remove' : 'add')
      if (allSelected) return
    } else if (!allSelected) select('replace')
    else clickReplaces = true
    if (!p.editable) return

    const scaleOf = (path: NodePath): number | null => {
      const own = model.props.find((q) => q.key === pathKey(path))
      const map = own ? own.map : mapForPath(doc, path)
      if (!map?.linear) return null
      return map.scale !== 0 && Number.isFinite(map.scale) ? map.scale : null
    }
    const moving = useDocument
      .getState()
      .selection.keyframes.filter((r) => scaleOf(r.path) !== null && !isLocked(r.path))
    if (moving.length === 0) {
      if (clickReplaces) select('replace')
      return
    }
    const snaps = snapshotProps(doc, moving)
    const dragged = new Set(moving.map(refKey))
    const targets = this.timeline.snapTargets({ skipKeys: (r) => dragged.has(refKey(r)) })
    const anchorIndex = refs[0].index
    const anchorRoot = p.map!.toRoot(p.kfs[anchorIndex].t)
    const [min, max] = this.range()
    this.frozen = [min, max]
    const axisPerPx = (max - min) / this.plotHeight()
    const plan = model.mode === 'value' ? this.valuePlan(moving, axisPerPx) : []
    const grabbed = plan.find(
      (edit) =>
        edit.index === anchorIndex && pathKey(edit.path) === p.key && edit.dims.includes(dim ?? 0),
    )
    const startFrame = this.viewport().frame(x0)
    const coalesceKey = uid('graph-keys')
    const tl = getT().timeline
    const label = model.mode === 'value' ? tl.history.graphEditKeys : tl.history.moveKeys
    let lastMove = { delta: 0, dn: 0 }
    let changed = false

    const apply = (delta: number, dn: number) => {
      let next: KeyRef[] = moving
      changed =
        updateDoc(
          label,
          (draft) => {
            restoreProps(draft, snaps)
            if (dn !== 0) {
              for (const edit of plan) {
                const prop = getAt<AnyProperty>(draft, edit.path)
                if (!prop) continue
                normalizeLegacyKeys(prop)
                const kf = getKeyframes(prop)?.[edit.index]
                if (!kf) continue
                setKeyComponents(
                  kf,
                  new Map(edit.dims.map((d, i) => [d, editedValue(edit, i, dn)])),
                )
              }
            }
            if (delta !== 0) {
              next = moveKeys(draft, moving, (path) => round3(delta / (scaleOf(path) ?? 1)))
            }
          },
          {
            coalesceKey,
            final: false,
            selection: () => ({ ...useDocument.getState().selection, keyframes: next }),
          },
        ) || changed
    }

    startDrag(e, {
      onMove: (ev) => {
        const { x, y } = this.localPoint(ev)
        const dx = x - x0
        const dy = y - y0
        let axis: 'both' | 'time' | 'value' = 'both'
        if (model.mode === 'speed' || plan.length === 0) axis = 'time'
        else if (ev.shiftKey) axis = Math.abs(dx) >= Math.abs(dy) ? 'time' : 'value'
        let delta = 0
        let snapped: number | null = null
        if (axis !== 'value') {
          const raw = this.viewport().frame(x) - startFrame
          delta = Math.round(raw)
          if (wantsSnap(ev)) {
            const s = snapDelta([anchorRoot], raw, targets, this.timeline.snapThreshold())
            if (s.target !== null) {
              delta = round3(s.delta)
              snapped = s.target
            }
          }
        }
        const dn = axis === 'time' ? 0 : -dy * axisPerPx
        if (delta !== lastMove.delta || dn !== lastMove.dn) {
          lastMove = { delta, dn }
          apply(delta, dn)
        }
        const lines: string[] = []
        if (axis !== 'value')
          lines.push(tl.drag.frame(formatFrame(anchorRoot + delta), formatFrame(delta)))
        if (axis !== 'time' && grabbed) {
          const i = grabbed.dims.indexOf(dim ?? 0)
          const from = grabbed.from[i]
          const to = editedValue(grabbed, i, dn)
          const decimals = Math.max(grabbed.decimals[i], 0)
          lines.push(
            tl.graph.dragValue(
              `${formatDecimal(to * p.factor, decimals)}${p.unit}`,
              formatDecimal((to - from) * p.factor, decimals),
            ),
          )
        }
        setTimelineView({
          feedback: { x: ev.clientX, y: ev.clientY, text: lines.join('\n') },
          snapFrame: snapped,
        })
      },
      autoScroll: (ev) => this.timeline.autoScrollX(ev),
      onEnd: ({ moved, cancelled }) => {
        this.frozen = null
        setTimelineView({ feedback: null, snapFrame: null })
        if (cancelled && moved && changed) this.timeline.undoGesture(coalesceKey)
        if (!moved && clickReplaces) select('replace')
        this.invalidate()
      },
    })
  }

  /** What a vertical drag changes: the selected dimensions of every selected, editable key. */
  private valuePlan(refs: readonly KeyRef[], axisPerPx: number): ValueEdit[] {
    const model = this.model
    if (!model) return []
    const dims = useGraphState.getState().dims
    const out: ValueEdit[] = []
    for (const ref of refs) {
      const p = model.props.find((q) => q.key === pathKey(ref.path))
      if (!p?.editable || !p.keyValues[ref.index]) continue
      const chosen = (dims?.[p.key] ?? p.shown).filter((d) => p.shown.includes(d))
      const edit: ValueEdit = {
        path: p.path,
        index: ref.index,
        dims: [],
        from: [],
        perAxis: [],
        decimals: [],
        unit: p.kind === 'color',
      }
      for (const d of chosen) {
        const curve = model.curves.find((c) => c.prop === p && c.dim === d)
        if (!curve) continue
        const perAxis = curve.scale / p.factor
        edit.dims.push(d)
        edit.from.push(p.keyValues[ref.index][d] ?? 0)
        edit.perAxis.push(perAxis)
        edit.decimals.push(dragDecimals(axisPerPx * perAxis))
      }
      if (edit.dims.length) out.push(edit)
    }
    return out
  }

  /**
   * Handles: the value graph's bezier control points or the speed graph's influence/speed.
   * A key whose two sides had the same speed keeps them equal (smooth); Alt breaks them.
   */
  private dragHandle(e: ReactPointerEvent, hit: Extract<GraphHit, { kind: 'handle' }>): void {
    const model = this.model
    const doc = getDoc()
    const { curve, handle } = hit
    const p = curve.prop
    // Locking may have happened after the curves were built.
    if (!model || !doc || !p.editable || isLocked(p.path, doc)) return
    this.pin()
    const { seg, side } = handle
    const mode = model.mode
    const channel = mode === 'value' ? (curve.dim ?? 0) : curve.dim
    const writeDimFor = (s: typeof seg) =>
      (
        mode === 'value'
          ? p.dims > 1 && !s.spatial && hasPerDimEase(p.kfs[s.index])
          : curve.dim !== null && p.dims > 1
      )
        ? channel
        : null
    const key = side === 'out' ? seg.index : seg.index + 1
    const otherSide = side === 'out' ? 'in' : 'out'
    const other = side === 'out' ? p.segments[key - 1] : p.segments[key]
    const otherEditable =
      !!other && (mode === 'value' ? valueEditable(other) : speedEditable(other, curve.dim))
    const continuous =
      otherEditable &&
      sameSpeed(sideSpeed(seg, channel, side), sideSpeed(other!, channel, otherSide))
    const snaps = snapshotProps(doc, [{ path: p.path, index: seg.index }])
    this.frozen = this.range()
    const coalesceKey = uid('graph-ease')
    const tl = getT().timeline
    let changed = false

    startDrag(e, {
      threshold: 1,
      onMove: (ev) => {
        const { x, y } = this.localPoint(ev)
        const vp = this.viewport()
        const ease = easeForHandleDrag(curve, mode, seg, side, vp.frame(x), vp.n(y), model.fps)
        if (!ease) return
        const link = continuous && !ev.altKey
        changed =
          updateDoc(
            tl.history.easing,
            (draft) => {
              restoreProps(draft, snaps)
              const prop = getAt<AnyProperty>(draft, p.path)
              if (!prop) return
              normalizeLegacyKeys(prop)
              const kfs = getKeyframes(prop)
              if (!kfs?.[seg.index]) return
              writeEase(kfs[seg.index], ease, writeDimFor(seg), p.dims)
              if (link && other && kfs[other.index]) {
                const speed = sideSpeed(seg, channel, side, ease)
                const matched = easeWithSpeed(
                  otherSide,
                  speed,
                  other.t1 - other.t0,
                  channelChange(other, channel),
                  channelEase(other, channel),
                  other.spatial,
                )
                writeEase(kfs[other.index], matched, writeDimFor(other), p.dims)
              }
            },
            { coalesceKey, final: false },
          ) || changed
        const influence = side === 'out' ? ease.x1 : 1 - ease.x2
        const text = tl.graph.dragHandle(
          formatDecimal(influence * 100, 1),
          this.speedText(p, sideSpeed(seg, channel, side, ease)),
        )
        setTimelineView({
          feedback: {
            x: ev.clientX,
            y: ev.clientY,
            text:
              continuous && !ev.altKey ? `${text}\n${tl.graph.linked(isMac ? '⌥' : 'Alt')}` : text,
          },
        })
      },
      onEnd: ({ moved, cancelled }) => {
        this.frozen = null
        setTimelineView({ feedback: null })
        if (cancelled && moved && changed) this.timeline.undoGesture(coalesceKey)
        this.invalidate()
      },
    })
  }

  /** Empty space: marquee-select key points (Shift/⌘ adds); a click clears the keys. */
  private marquee(e: ReactPointerEvent, x0: number, y0: number): void {
    const model = this.model
    if (!model) return
    const additive = e.shiftKey || hasModKey(e)
    const base = additive ? useDocument.getState().selection.keyframes : []
    const baseDims = additive ? useGraphState.getState().dims : null
    const baseKeys = new Set(base.map(refKey))
    this.pin()
    startDrag(e, {
      onMove: (ev) => {
        const { x, y } = this.localPoint(ev)
        const [left, right] = [Math.min(x0, x), Math.max(x0, x)]
        const [top, bottom] = [Math.min(y0, y), Math.max(y0, y)]
        const inside = (px: number, py: number) =>
          px >= left - 3 && px <= right + 3 && py >= top - 3 && py <= bottom + 3
        const found: KeyRef[] = []
        const dims: Record<string, number[]> = { ...baseDims }
        const seen = new Set<string>()
        for (const geo of this.geometry) {
          const p = geo.curve.prop
          for (const k of geo.keys) {
            if (!inside(k.x, k.y) && !(k.inY !== undefined && inside(k.x, k.inY))) continue
            const ref = { path: p.path, index: k.index }
            const rk = refKey(ref)
            if (!baseKeys.has(rk) && !seen.has(rk)) {
              seen.add(rk)
              found.push(ref)
            }
            if (model.mode === 'value' && geo.curve.dim !== null) {
              const hadAll = base.some((b) => pathKey(b.path) === p.key) && !baseDims?.[p.key]
              if (!hadAll) dims[p.key] = [...new Set([...(dims[p.key] ?? []), geo.curve.dim])]
            }
          }
        }
        asGraphSelection(() => {
          selectKeys([...base, ...found], 'replace', { keepNodes: true, focus: null })
          setGraphDims(model.mode === 'value' && Object.keys(dims).length ? dims : null)
        })
        const rect = this.canvas?.getBoundingClientRect()
        if (rect) {
          setTimelineView({
            marquee: {
              left: rect.left + left,
              top: rect.top + top,
              width: right - left,
              height: bottom - top,
            },
          })
        }
      },
      onEnd: ({ moved }) => {
        setTimelineView({ marquee: null })
        if (!moved) {
          if (!additive) {
            asGraphSelection(() => {
              clearKeySelection()
              setGraphDims(null)
            })
          }
          return
        }
        // Settle: the owners of the keys become the selected nodes (inspector context).
        asGraphSelection(() => selectKeys(useDocument.getState().selection.keyframes, 'replace'))
      },
    })
  }

  /** Middle button: pan time (the timeline's scroll) and values together. */
  private pan(e: ReactPointerEvent): void {
    const startScroll = this.timeline.scrollX
    const [min, max] = this.range()
    const axisPerPx = (max - min) / this.plotHeight()
    startDrag(e, {
      threshold: 0,
      cursor: 'grabbing',
      onMove: (_ev, { dx, dy }) => {
        this.timeline.setScrollX(startScroll - dx)
        this.setRange([min + dy * axisPerPx, max + dy * axisPerPx])
      },
      onEnd: () => {},
    })
  }

  /** Wheel: pans the value axis; Alt zooms it around the pointer. ⌘/Ctrl and Shift are the timeline's. */
  onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return
    if (!this.model?.curves.length) return
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    const dy = e.deltaY * unit
    if (dy === 0) return
    e.preventDefault()
    const [min, max] = this.range()
    if (e.altKey) {
      const pivot = this.viewport().n(this.localPoint(e).y)
      const factor = Math.min(2, Math.max(0.5, Math.exp(dy * 0.0025)))
      this.setRange([pivot + (min - pivot) * factor, pivot + (max - pivot) * factor])
      return
    }
    const shift = (dy * (max - min)) / this.plotHeight()
    this.setRange([min - shift, max - shift])
  }

  /** Double-click: on a key, go to it; on a curve, add a key there (the curve keeps its values). */
  onDoubleClick(e: { clientX: number; clientY: number }): void {
    const { x, y } = this.localPoint(e)
    // The first click selected the segment, whose handles may now lie under the pointer.
    const hit = this.hitTest(x, y, false)
    if (!hit || hit.kind === 'handle') return
    const p = hit.curve.prop
    const map = p.map
    if (!map) return
    if (hit.kind === 'key') {
      const root = map.toRoot(p.kfs[hit.index].t)
      setFrame(root, { allowSubframe: !Number.isInteger(root) })
      return
    }
    if (!p.editable) return
    const doc = getDoc()
    const original = doc ? getAt<AnyProperty>(doc, p.path) : undefined
    if (!original) return
    const local = round3(map.toLocal(Math.round(hit.frame)))
    // Keyframe insertion evaluates the value on a plain copy (never on a draft).
    const copy = structuredClone(original)
    normalizeLegacyKeys(copy)
    insertKeyframe(copy, local)
    this.pin()
    asGraphSelection(() =>
      updateDoc(getT().timeline.history.addKey, (d) => setAt(d, p.path, copy), {
        selection: (after) => {
          const prop = getAt<AnyProperty>(after, p.path)
          const index = prop ? findKeyframeAt(prop, local) : -1
          const sel = useDocument.getState().selection
          return index >= 0
            ? { ...sel, keyframes: [{ path: p.path, index }], property: p.path }
            : sel
        },
      }),
    )
  }

  /**
   * Right-click: selects the key (or segment) under the pointer like a click would and returns
   * it for the context menu; null over empty space.
   */
  contextTarget(
    clientX: number,
    clientY: number,
  ): { path: NodePath; clicked: number | null } | null {
    const { x, y } = this.localPoint({ clientX, clientY })
    const hit = this.hitTest(x, y)
    if (!hit || hit.kind === 'handle' || (hit.kind === 'curve' && hit.outside)) return null
    const p = hit.curve.prop
    const last = p.kfs.length - 1
    const refs: KeyRef[] =
      hit.kind === 'key'
        ? [{ path: p.path, index: hit.index }]
        : hit.seg < 0 || hit.seg >= last
          ? [{ path: p.path, index: hit.seg < 0 ? 0 : last }]
          : [
              { path: p.path, index: hit.seg },
              { path: p.path, index: hit.seg + 1 },
            ]
    const index = indexSelection(useDocument.getState().selection)
    if (!refs.every((r) => isRefSelected(index, r)))
      this.selectPoints(refs, p, this.model?.mode === 'value' ? hit.curve.dim : null, 'replace')
    const map = p.map
    const root = map ? map.toRoot(p.kfs[refs[0].index].t) : null
    return { path: p.path, clicked: root }
  }

  /** Drawn keys and handles in client coordinates (development tooling and browser checks). */
  debugPoints(): {
    curve: string
    keys: { index: number; x: number; y: number }[]
    handles: { key: number; side: string; x: number; y: number }[]
  }[] {
    const rect = this.canvas?.getBoundingClientRect()
    const ox = rect?.left ?? 0
    const oy = rect?.top ?? 0
    return this.geometry.map((geo) => ({
      curve: geo.curve.id,
      keys: geo.keys.map((k) => ({ index: k.index, x: ox + k.x, y: oy + k.y })),
      handles: this.handles
        .filter((h) => h.curve.id === geo.curve.id)
        .map(({ handle }) => ({
          key: handle.key,
          side: handle.side,
          x: ox + handle.x,
          y: oy + handle.y,
        })),
    }))
  }

  /** Selects every key of the shown curves (⌘A while the graph is shown). */
  selectAll(): boolean {
    const model = this.model
    if (!model || model.props.length === 0) return false
    const refs = model.props.flatMap((p) => p.kfs.map((_, index) => ({ path: p.path, index })))
    this.pin()
    asGraphSelection(() => {
      selectKeys(refs, 'replace')
      setGraphDims(null)
    })
    return true
  }
}
