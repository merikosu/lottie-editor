/**
 * The timeline panel: transport header, names column + tracks with a shared vertical scroll,
 * ruler and marker lane, playhead and overlays. See controller.ts for the imperative parts.
 */
import { Clock, Layers } from 'lucide-react'
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EmptyState } from '@/components/ui'
import { useT } from '@/i18n'
import { on } from '@/lib/events'
import { isEditableTarget } from '@/lib/platform'
import { throttle } from '@/lib/timing'
import { instanceChainFor } from '@/features/layers/instances'
import { pathEquals, type NodePath } from '@/lottie/path'
import { selectNodes, useDocument } from '@/store/document'
import { subscribeFrame, usePlayback } from '@/store/playback'
import { ControllerContext, MetricsContext, useController, useMetrics } from './context'
import { TimelineController, type Metrics } from './controller'
import { clampPpf, contentWidth, NAMES_MIN_TRACK, zoomLimits } from './geometry'
import { getGraphRuntime } from './graph/runtime'
import { GraphView } from './graph/GraphView'
import { Header } from './Header'
import { TimelineContextMenu } from './menus'
import type { FlatRow, RowsResult } from './model'
import { Overlay } from './Overlay'
import { TimelineRow } from './Rows'
import { setTimelineRuntime } from './runtime'
import { isSelfSelecting, selectFromTimeline } from './selection'
import {
  NAMES_WIDTH,
  setTimelinePrefs,
  setTimelineView,
  useTimelinePrefs,
  useTimelineView,
} from './store'
import { TransportBar } from './TransportBar'

/** Extra space below the last row (room for the horizontal scrollbar). */
const BOTTOM_PAD = 16
const OVERSCAN = 240

function visibleRange(rows: readonly FlatRow[], top: number, height: number): [number, number] {
  if (rows.length === 0) return [0, 0]
  const from = top - OVERSCAN
  const to = top + height + OVERSCAN
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].top + rows[mid].height < from) lo = mid + 1
    else hi = mid
  }
  let end = lo
  while (end < rows.length && rows[end].top <= to) end++
  return [lo, end]
}

function Body({ rows, bodyRef }: { rows: RowsResult; bodyRef: RefObject<HTMLDivElement | null> }) {
  const t = useT()
  const ctl = useController()
  const [view, setView] = useState({ top: 0, height: 600 })
  const raf = useRef(0)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      ctl.noteBodyView(el.scrollTop, el.clientHeight)
      setView({ top: el.scrollTop, height: el.clientHeight })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [bodyRef, ctl])

  const [start, end] = visibleRange(rows.rows, view.top, view.height)
  const visible = rows.rows.slice(start, end)
  return (
    <div
      ref={bodyRef}
      role="tree"
      aria-label={t.timeline.title}
      tabIndex={0}
      className="relative min-h-0 flex-1 [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--le-accent)]"
      onScroll={(e) => {
        const el = e.currentTarget
        if (raf.current) return
        raf.current = requestAnimationFrame(() => {
          raf.current = 0
          ctl.noteBodyView(el.scrollTop, el.clientHeight)
          setView({ top: el.scrollTop, height: el.clientHeight })
        })
      }}
    >
      <div className="relative min-h-full" style={{ height: rows.height + BOTTOM_PAD }}>
        <NamesColumnBackground />
        {visible.map((row, i) => (
          <TimelineRow key={row.key} row={row} first={start + i === 0} />
        ))}
      </div>
      {rows.rows.length === 0 && <EmptyTracks />}
    </div>
  )
}

/** The names column continues below the last row (hairline separator to the bottom). */
function NamesColumnBackground() {
  const { namesWidth } = useMetrics()
  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 border-r border-line"
      style={{ width: namesWidth }}
    />
  )
}

function EmptyTracks() {
  const t = useT()
  const { namesWidth } = useMetrics()
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: namesWidth }}>
      <EmptyState
        icon={Layers}
        title={t.timeline.empty.noLayers}
        description={t.timeline.empty.noLayersHint}
        className="min-h-0"
      />
    </div>
  )
}

const NamesResizer = memo(function NamesResizer() {
  const ctl = useController()
  const { namesWidth } = useMetrics()
  return (
    <div
      className="group/resize absolute top-0 bottom-0 z-20 flex w-[7px] cursor-col-resize justify-center"
      style={{ left: namesWidth - 3 }}
      onPointerDown={(e) => ctl.onNamesResizePointerDown(e)}
      onDoubleClick={() => setTimelinePrefs({ namesWidth: NAMES_WIDTH.initial })}
      aria-hidden
    >
      <span className="w-px bg-transparent transition-colors duration-100 group-hover/resize:bg-accent" />
    </div>
  )
})

function TimelineView() {
  const t = useT()
  const doc = useDocument((s) => s.doc)!
  const expanded = useTimelineView((s) => s.expanded)
  const { storedPpf, fit } = useTimelineView(useShallow((s) => ({ storedPpf: s.ppf, fit: s.fit })))
  const namesPref = useTimelinePrefs((s) => s.namesWidth)
  const units = useTimelinePrefs((s) => s.units)
  const graph = useTimelinePrefs((s) => s.graph)
  const [ctl] = useState(() => new TimelineController())
  const rootRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, scrollbar: 0 })

  // Rows unchanged since the previous flatten keep their identity (memoized row components).
  const rows = useMemo(() => ctl.flatten(doc, t, expanded), [ctl, doc, t, expanded])

  useLayoutEffect(() => {
    const main = mainRef.current
    const body = bodyRef.current
    if (!main || !body) return
    const measure = () =>
      setSize({
        width: main.clientWidth,
        scrollbar: Math.max(0, body.offsetWidth - body.clientWidth),
      })
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  const available = size.width - size.scrollbar
  const namesWidth = Math.round(
    Math.max(NAMES_WIDTH.min, Math.min(namesPref, NAMES_WIDTH.max, available - NAMES_MIN_TRACK)),
  )
  const viewWidth = Math.max(0, available - namesWidth)
  const limits = zoomLimits(viewWidth, doc.ip, doc.op)
  const ppf = fit ? limits.min : clampPpf(storedPpf, limits)

  const metrics = useMemo<Metrics>(
    () => ({
      ip: doc.ip,
      op: doc.op,
      fps: doc.fr,
      ppf,
      namesWidth,
      viewWidth,
      contentWidth: contentWidth(doc.ip, doc.op, ppf),
      units,
      scrollbar: size.scrollbar,
    }),
    [doc.ip, doc.op, doc.fr, ppf, namesWidth, viewWidth, units, size.scrollbar],
  )

  useLayoutEffect(() => {
    ctl.attach({ main: mainRef.current, body: bodyRef.current, root: rootRef.current })
    ctl.sync(metrics, rows)
  })

  useEffect(() => {
    setTimelineRuntime(ctl)
    return () => setTimelineRuntime(null)
  }, [ctl])

  const docId = useDocument((s) => s.meta?.id)
  useEffect(() => {
    if (docId) ctl.resetDocument()
  }, [ctl, docId])

  // Playhead at 60 fps (imperative) and value readouts at ≤ 10 Hz while playing.
  useEffect(() => {
    const updateValues = throttle((frame: number) => setTimelineView({ valueFrame: frame }), 100)
    const unsubscribe = subscribeFrame((frame) => {
      ctl.onFrame(frame)
      if (usePlayback.getState().playing) updateValues(frame)
      else {
        updateValues.cancel()
        setTimelineView({ valueFrame: frame })
      }
    })
    return () => {
      updateValues.cancel()
      unsubscribe()
    }
  }, [ctl])

  // Theme changes recolor the canvas ruler; web fonts may arrive after the first draw.
  useEffect(() => {
    const observer = new MutationObserver(() => ctl.refreshColors())
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    void document.fonts?.ready.then(() => ctl.refreshColors())
    return () => observer.disconnect()
  }, [ctl])

  // Wheel needs a non-passive listener to own ⌘/Ctrl-zoom and horizontal scrolling.
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const onWheel = (e: WheelEvent) => {
      const left = main.getBoundingClientRect().left + ctl.metrics.namesWidth
      if (e.ctrlKey || e.metaKey) e.preventDefault()
      ctl.handleWheel(e, e.clientX >= left)
    }
    main.addEventListener('wheel', onWheel, { passive: false })
    return () => main.removeEventListener('wheel', onWheel)
  }, [ctl])

  // Keep the primary selection in view when it changes elsewhere (tree, canvas). A node inside
  // a precomp opens the instance it was selected through (e.g. drilling in on the canvas).
  useEffect(
    () =>
      useDocument.subscribe(
        (s) => s.selection.nodes,
        (nodes, previous) => {
          if (isSelfSelecting() || nodes.length === 0) return
          ctl.revealPath(nodes[nodes.length - 1], true, previous)
        },
      ),
    [ctl],
  )

  useEffect(() => on('reveal-node', ({ path }) => ctl.revealPath(path)), [ctl])

  // Timeline-scoped keys (zoom, ↑/↓ layers) run before the global shortcuts, in capture.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!root.contains(document.activeElement) || isEditableTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      let handled = true
      if (e.code === 'Equal' || e.code === 'NumpadAdd') ctl.zoomBy(1.5)
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') ctl.zoomBy(1 / 1.5)
      else if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit0')) {
        ctl.zoomFit()
        // The graph editor fits its value axis too.
        getGraphRuntime()?.fit()
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        handled = stepLayerSelection(ctl.rows().rows, e.code === 'ArrowUp' ? -1 : 1, ctl)
      } else handled = false
      if (handled) e.preventDefault()
    }
    const onFocusIn = () => setTimelineView({ focused: true })
    const onFocusOut = (e: FocusEvent) => {
      if (!root.contains(e.relatedTarget as Node | null)) setTimelineView({ focused: false })
    }
    window.addEventListener('keydown', onKeyDown, true)
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
    }
  }, [ctl])

  return (
    <ControllerContext.Provider value={ctl}>
      <MetricsContext.Provider value={metrics}>
        <section
          ref={rootRef}
          aria-label={t.timeline.title}
          tabIndex={-1}
          className="flex h-full min-h-0 flex-col bg-surface-1 outline-none"
          data-testid="timeline-root"
        >
          <TransportBar />
          <TimelineContextMenu>
            <div
              ref={mainRef}
              className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
              style={{ '--sx': '0px' } as CSSProperties}
            >
              <Header layerCount={doc.layers.length} />
              <Body rows={rows} bodyRef={bodyRef} />
              {graph && <GraphView />}
              <Overlay />
              <NamesResizer />
            </div>
          </TimelineContextMenu>
        </section>
      </MetricsContext.Provider>
    </ControllerContext.Provider>
  )
}

/** ↑/↓ in the timeline: select the previous/next layer row. */
function stepLayerSelection(
  rows: readonly FlatRow[],
  dir: 1 | -1,
  ctl: TimelineController,
): boolean {
  const layers = rows.filter((r) => r.kind === 'layer')
  if (layers.length === 0) return false
  const nodes = useDocument.getState().selection.nodes
  const primary = nodes[nodes.length - 1]
  // Shared precomp content is listed once per open instance: step from the one worked in.
  const row = primary ? ctl.findLayerRow(primary, workingChain(primary)) : undefined
  const current = row && pathEquals(row.model.path, primary) ? layers.indexOf(row) : -1
  const next =
    layers[
      current < 0
        ? dir > 0
          ? 0
          : layers.length - 1
        : Math.min(layers.length - 1, Math.max(0, current + dir))
    ]
  ctl.notePreferred(next)
  selectFromTimeline(() => selectNodes([next.model.path], 'replace'))
  ctl.revealRow(next)
  return true
}

function workingChain(path: NodePath): NodePath[] {
  const doc = useDocument.getState().doc
  return (doc && instanceChainFor(doc, path)) || []
}

export function Timeline() {
  const t = useT()
  const hasDoc = useDocument((s) => s.doc !== null)
  if (!hasDoc) return <EmptyState icon={Clock} title={t.common.noDocument} />
  return <TimelineView />
}
