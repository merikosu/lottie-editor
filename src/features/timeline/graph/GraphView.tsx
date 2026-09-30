/**
 * The graph editor view, shown over the tracks area when the timeline is in graph mode: a
 * strip with the legend of the curves and the graph options, and the canvas the
 * GraphController draws on (below the timeline's playhead and dimming overlay).
 */
import { ChartSpline, StretchVertical, UnfoldVertical } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, IconButton, Tooltip } from '@/components/ui'
import { isLocked } from '@/features/layers'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { mapForPath, toggleGraphFit, toggleGraphNormalize } from '../actions'
import { useController, useMetrics } from '../context'
import { HEADER_H } from '../geometry'
import { setTimelinePrefs, useTimelinePrefs, useTimelineView, type GraphMode } from '../store'
import { GraphController } from './controller'
import { buildGraphModel, propPrefix, type GraphModel } from './model'
import { setGraphRuntime } from './runtime'
import { graphPaths, setGraphLegend, setHoverCurve, useGraphState } from './state'

/** Height of the strip above the plot. */
export const GRAPH_BAR_H = 24

/** Mouse clicks on the strip keep keyboard focus where it was (the timeline's shortcuts). */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('h-[2px] w-2.5 shrink-0 rounded-full', className)}
      style={{ background: `var(${color})` }}
    />
  )
}

interface LegendEntry {
  key: string
  /** Where the property sits (only when another shown property has the same name). */
  prefix: string
  label: string
  curves: GraphModel['curves']
  /** One curve without a dimension name: the swatch goes before the label. */
  single: boolean
}

/** Legend entries: a property name is qualified only when it would be ambiguous. */
function legendEntries(model: GraphModel): LegendEntry[] {
  const layers = new Set(model.props.map((p) => p.owner)).size > 1
  const counts = new Map<string, number>()
  for (const p of model.props) counts.set(p.label, (counts.get(p.label) ?? 0) + 1)
  return model.props.map((p) => {
    const curves = model.curves.filter((c) => c.prop === p)
    return {
      key: p.key,
      prefix: (counts.get(p.label) ?? 0) > 1 ? propPrefix(p, layers) : '',
      label: p.label,
      curves,
      single: curves.length === 1 && !curves[0].dimLabel,
    }
  })
}

/** Width kept for the "+N" chip when entries overflow. */
const MORE_W = 36

const entryName = (e: LegendEntry) => (e.prefix ? `${e.prefix} › ${e.label}` : e.label)

/**
 * Property names with their curve colors; hovering an entry highlights its curve. Entries that
 * do not fit are hidden whole behind a "+N" chip (never cut mid-word).
 */
function Legend({ model }: { model: GraphModel }) {
  const t = useT()
  const hover = useGraphState((s) => s.hoverCurve)
  const ref = useRef<HTMLDivElement>(null)
  const entries = useMemo(() => legendEntries(model), [model])
  const [cut, setCut] = useState<{ from: number; left: number } | null>(null)

  // Measure after layout (and on resize): which entries fit, and where the chip goes.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const items = el.querySelectorAll<HTMLElement>('[data-legend-item]')
      const count = Math.min(items.length, entries.length)
      const width = el.clientWidth
      let next: { from: number; left: number } | null = null
      for (let i = 0; i < count; i++) {
        const right = items[i].offsetLeft + items[i].offsetWidth
        if (right > (i === count - 1 ? width : width - MORE_W)) {
          const prev = items[i - 1]
          next = { from: i, left: prev ? prev.offsetLeft + prev.offsetWidth + 12 : 0 }
          break
        }
      }
      setCut((c) => (c?.from === next?.from && c?.left === next?.left ? c : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [entries])

  if (entries.length === 0) return <div className="min-w-0 flex-1" />
  const hidden = cut ? entries.slice(cut.from) : []
  return (
    <div
      ref={ref}
      aria-label={t.timeline.graph.curves}
      className="relative flex min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap"
    >
      {entries.map((e, i) => {
        const hot = e.curves.some((c) => c.id === hover)
        return (
          <span
            key={e.key}
            data-legend-item
            className={cn(
              'flex shrink-0 items-center gap-1.5 text-xs',
              cut && i >= cut.from && 'invisible',
            )}
            onPointerEnter={() => e.single && setHoverCurve(e.curves[0].id)}
            onPointerLeave={() => setHoverCurve(null)}
          >
            {e.single && <Swatch color={e.curves[0].color} />}
            <span
              className={cn('transition-colors duration-100', hot ? 'text-fg' : 'text-fg-muted')}
            >
              {e.prefix && <span className="text-fg-subtle">{e.prefix} › </span>}
              {e.label}
            </span>
            {!e.single &&
              e.curves.map((c) => (
                <span
                  key={c.id}
                  className={cn(
                    'flex items-center gap-1 transition-colors duration-100',
                    c.id === hover ? 'text-fg' : 'text-fg-subtle',
                  )}
                  onPointerEnter={() => setHoverCurve(c.id)}
                >
                  <Swatch color={c.color} />
                  {c.dimLabel}
                </span>
              ))}
          </span>
        )
      })}
      {cut && hidden.length > 0 && (
        <Tooltip content={hidden.map(entryName).join(', ')}>
          <span
            className="absolute top-1/2 -translate-y-1/2 rounded-sm bg-surface-2 px-1 text-2xs leading-4 text-fg-subtle tabular-nums"
            style={{ left: cut.left }}
          >
            +{hidden.length}
          </span>
        </Tooltip>
      )}
    </div>
  )
}

/** Value | Speed, compact enough for the strip. */
function ModeToggle() {
  const t = useT()
  const mode = useTimelinePrefs((s) => s.graphMode)
  const option = (value: GraphMode, label: string, title: string, hint: string) => (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          <span>{title}</span>
          <span className="text-fg-subtle">{hint}</span>
        </span>
      }
    >
      <button
        type="button"
        aria-pressed={mode === value}
        aria-label={title}
        data-testid={`graph-mode-${value}`}
        onMouseDown={keepFocus}
        onClick={() => setTimelinePrefs({ graphMode: value })}
        className={cn(
          'inline-flex h-[18px] min-w-0 items-center rounded-[3px] px-1.5 text-xs font-medium transition-colors duration-100',
          mode === value
            ? 'bg-surface-1 text-fg shadow-thumb dark:bg-surface-3'
            : 'text-fg-subtle hover:text-fg',
        )}
      >
        {label}
      </button>
    </Tooltip>
  )
  const g = t.timeline.graph
  return (
    <fieldset
      aria-label={g.type}
      className="inline-flex h-5 shrink-0 items-center gap-px rounded-sm bg-surface-2 p-px"
    >
      {option('value', g.value, g.valueGraph, g.valueHint)}
      {option('speed', g.speed, g.speedGraph, g.speedHint)}
    </fieldset>
  )
}

function GraphBar({ model }: { model: GraphModel }) {
  const t = useT()
  const { namesWidth, scrollbar } = useMetrics()
  const normalize = useTimelinePrefs((s) => s.graphNormalize)
  const fit = useTimelineView((s) => s.graphFit)
  const g = t.timeline.graph
  return (
    // Above the timeline overlay: its dimming must not grey out the controls.
    <div
      className="absolute z-[11] flex items-center gap-2 border-b border-line-subtle bg-surface-1 pr-1 pl-2"
      style={{ left: namesWidth, right: scrollbar, top: HEADER_H, height: GRAPH_BAR_H }}
      data-testid="timeline-graph-bar"
    >
      <Legend model={model} />
      <ModeToggle />
      <IconButton
        size="xs"
        icon={StretchVertical}
        label={g.normalize}
        active={normalize}
        onMouseDown={keepFocus}
        onClick={toggleGraphNormalize}
        data-testid="graph-normalize"
      />
      <IconButton
        size="xs"
        icon={UnfoldVertical}
        label={g.fit}
        active={fit}
        onMouseDown={keepFocus}
        onClick={toggleGraphFit}
        data-testid="graph-fit"
      />
    </div>
  )
}

/** Curve colors per property, published for the names column. */
function legendOf(model: GraphModel): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const c of model.curves) (out[c.prop.key] ??= []).push(c.color)
  return out
}

export const GraphView = memo(function GraphView() {
  const t = useT()
  const ctl = useController()
  const metrics = useMetrics()
  const doc = useDocument((s) => s.doc)!
  const selection = useDocument((s) => s.selection)
  const pinned = useGraphState((s) => s.pinned)
  const mode = useTimelinePrefs((s) => s.graphMode)
  const normalize = useTimelinePrefs((s) => s.graphNormalize)
  const [graph] = useState(() => new GraphController(ctl))
  const plotRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const readoutRef = useRef<HTMLDivElement>(null)

  const paths = useMemo(() => graphPaths(doc, selection, pinned), [doc, selection, pinned])
  const model = useMemo(
    () =>
      buildGraphModel(doc, paths, t, {
        mode,
        normalize,
        mapFor: (path) => mapForPath(doc, path),
        isLocked: (path) => isLocked(path, doc),
      }),
    [doc, paths, t, mode, normalize],
  )

  useLayoutEffect(() => {
    graph.setModel(model)
    setGraphLegend(legendOf(model))
  }, [graph, model])

  // Zoom, resize and names-column changes move the time axis.
  useLayoutEffect(() => graph.onMetrics(metrics), [graph, metrics])

  useEffect(() => {
    const plot = plotRef.current
    graph.attach(canvasRef.current, readoutRef.current)
    setGraphRuntime(graph)
    if (!plot) return
    // Development: browser checks read the drawn points (`canvas.__graph.debugPoints()`).
    if (import.meta.env.DEV && canvasRef.current)
      Object.assign(canvasRef.current, { __graph: graph })
    const resize = new ResizeObserver(() => graph.setSize(plot.clientWidth, plot.clientHeight))
    resize.observe(plot)
    graph.setSize(plot.clientWidth, plot.clientHeight)
    // Theme changes recolor the canvas; web fonts may arrive after the first draw.
    const theme = new MutationObserver(() => graph.refreshColors())
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    void document.fonts?.ready.then(() => graph.refreshColors())
    // Non-passive: the wheel pans and zooms the value axis instead of scrolling the page.
    const onWheel = (e: WheelEvent) => graph.onWheel(e)
    plot.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      resize.disconnect()
      theme.disconnect()
      plot.removeEventListener('wheel', onWheel)
      graph.detach()
      setGraphRuntime(null)
      setHoverCurve(null)
      setGraphLegend({})
    }
  }, [graph])

  const g = t.timeline.graph
  const empty = model.curves.length === 0
  return (
    <>
      <GraphBar model={model} />
      <div
        ref={plotRef}
        className="absolute z-[5] touch-none bg-surface-1"
        style={{
          left: metrics.namesWidth,
          right: metrics.scrollbar,
          top: HEADER_H + GRAPH_BAR_H,
          bottom: 0,
        }}
        data-testid="timeline-graph"
        onPointerDown={(e) => graph.onPointerDown(e)}
        onPointerMove={(e) => graph.onPointerMove(e)}
        onPointerLeave={() => graph.onPointerLeave()}
        onDoubleClick={(e) => graph.onDoubleClick(e)}
      >
        <canvas
          ref={canvasRef}
          data-ctx="graph"
          className="absolute inset-0 size-full"
          aria-label={mode === 'value' ? g.valueGraph : g.speedGraph}
        />
        {/* Hover readout: filled and positioned by the controller (no re-render per move). */}
        <div
          ref={readoutRef}
          className="pointer-events-none absolute top-0 left-0 z-10 items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1 text-xs whitespace-nowrap text-fg tabular-nums shadow-popover"
          style={{ display: 'none' }}
          data-testid="graph-readout"
        >
          <span data-part="swatch" className="h-[2px] w-2.5 shrink-0 rounded-full" />
          <span data-part="label" className="text-fg-muted" />
          <span data-part="value" className="font-medium" />
          <span data-part="meta" className="text-fg-subtle" />
        </div>
        {empty && (
          <EmptyState
            icon={ChartSpline}
            title={model.unsupported > 0 ? g.unsupported : g.empty}
            description={model.unsupported > 0 ? g.unsupportedHint : g.emptyHint}
            className="pointer-events-none absolute inset-0 min-h-0"
          />
        )}
      </div>
    </>
  )
})
