/**
 * A/B comparison of the original and the optimized animation: two lottie-web players showing
 * the same frame, side by side, as a swipe (optimized left of the divider, original right) or as
 * their difference (identical pixels turn black; the check's heatmap marks its worst frame).
 * Zoom with ⌘/Ctrl + wheel or the buttons, pan by dragging or scrolling, double-click to fit.
 */
import { ChevronsLeftRight, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { IconButton, Spinner, Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { withSeededRandom, type VisualReport } from '@/lottie/optimizer'
import type { Animation } from '@/lottie/types'
import { LottiePlayer } from '@/player/LottiePlayer'
import type { CompareMode, StageBackground } from '../../model/settings'
import type { FrameClock } from './clock'
import {
  FIT_VIEW,
  layoutStage,
  MAX_ZOOM,
  MIN_ZOOM,
  zoomAt,
  type Rect,
  type StageLayout,
  type View,
} from './layout'

const BOARD_BACKGROUND: Record<StageBackground, string> = {
  checker: 'checkerboard',
  dark: 'bg-[#1b1c1f]',
  light: 'bg-white',
}

/** Brightness of the amplified difference view: small differences become visible. */
const AMPLIFY = 'brightness(8)'

/** Seeds of the players' random choices (the same for both at each step). */
const LOAD_SEED = 0x51f15e
const frameSeed = (frame: number) => (Math.round(frame * 100) * 2654435761) >>> 0

const rectStyle = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h })
/** Left and right edges of an artboard on the stage, kept inside its slot. */
const leftOf = (slot: Rect, board: Rect) => slot.x + Math.max(0, board.x)
const rightOf = (slot: Rect, board: Rect) => slot.x + Math.min(slot.w, board.x + board.w)

function useElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** One player bound to a host element; loads `doc` whenever it changes. */
function usePlayer(
  host: RefObject<HTMLDivElement | null>,
  doc: Animation | null,
  clock: FrameClock,
): { failed: boolean; ready: boolean } {
  const playerRef = useRef<LottiePlayer | null>(null)
  const [state, setState] = useState<{ failed: boolean; loaded: Animation | null }>({
    failed: false,
    loaded: null,
  })
  useEffect(() => {
    const el = host.current
    if (!el) return
    const player = new LottiePlayer(el, { renderer: 'svg' })
    playerRef.current = player
    // Both players make the same "random" choices (lottie-web's randomized text order), or the
    // comparison would show differences the optimization did not make.
    const off = clock.subscribe((frame) =>
      withSeededRandom(frameSeed(frame), () => player.renderFrame(frame)),
    )
    return () => {
      off()
      player.destroy()
      playerRef.current = null
    }
  }, [host, clock])
  useEffect(() => {
    const player = playerRef.current
    if (!player || !doc) return
    player.setOptions({
      onReady: () => setState({ failed: false, loaded: doc }),
      onError: () => setState({ failed: true, loaded: doc }),
    })
    player.renderFrame(clock.frame)
    withSeededRandom(LOAD_SEED, () => player.load(doc))
  }, [doc, clock])
  return {
    failed: !!doc && state.failed && state.loaded === doc,
    ready: !!doc && state.loaded === doc && !state.failed,
  }
}

function Heatmap({ visual, rect }: { visual: VisualReport; rect: Rect }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const image = visual.heatmap
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !image) return
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d')?.putImageData(image, 0, 0)
  }, [image])
  if (!image) return null
  return (
    <canvas
      ref={ref}
      aria-hidden
      data-testid="opt-heatmap"
      className="pointer-events-none absolute"
      style={rectStyle(rect)}
    />
  )
}

function Label({
  children,
  x,
  y,
  align = 'left',
}: {
  children: ReactNode
  x: number
  y: number
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute flex h-6 max-w-[45%] items-center gap-1.5 truncate text-xs text-fg-muted',
        align === 'right' && '-translate-x-full justify-end',
      )}
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  )
}

const ZOOM_STEP = 1.25

/** Zoom out / actual size readout (click: fit) / zoom in, in the stage's corner. */
function ZoomControls({
  layout,
  view,
  onView,
}: {
  layout: StageLayout
  view: View
  onView: (view: View) => void
}) {
  const t = useT()
  const center = { x: layout.slots.a.w / 2, y: layout.slots.a.h / 2 }
  const zoomTo = (zoom: number) => onView(zoomAt(layout, zoom, center))
  const fitted = view.zoom === 1 && view.pan.x === 0 && view.pan.y === 0
  return (
    <div
      className="absolute right-3 bottom-3 z-10 flex h-7 items-center gap-0.5 rounded-md bg-surface-1/90 px-0.5 shadow-[inset_0_0_0_1px_var(--le-line)]"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <IconButton
        icon={ZoomOut}
        label={t.optimizer.compare.zoomOut}
        tooltipSide="top"
        disabled={view.zoom <= MIN_ZOOM}
        onClick={() => zoomTo(view.zoom / ZOOM_STEP)}
      />
      <Tooltip content={t.optimizer.compare.fit} side="top">
        <button
          type="button"
          onClick={() => onView(FIT_VIEW)}
          disabled={fitted}
          className="h-6 min-w-11 rounded-sm px-1 text-xs text-fg-muted tabular-nums hover:bg-hover hover:text-fg disabled:hover:bg-transparent"
          data-testid="opt-zoom"
        >
          {Math.round(layout.scale * 100)}%
        </button>
      </Tooltip>
      <IconButton
        icon={ZoomIn}
        label={t.optimizer.compare.zoomIn}
        tooltipSide="top"
        disabled={view.zoom >= MAX_ZOOM}
        onClick={() => zoomTo(view.zoom * ZOOM_STEP)}
      />
    </div>
  )
}

export interface CompareProps {
  original: Animation | null
  optimized: Animation | null
  /** Sizes shown in the labels. */
  originalSize?: string
  optimizedSize?: string
  mode: CompareMode
  background: StageBackground
  amplify: boolean
  view: View
  onView: (view: View) => void
  clock: FrameClock
  /** Result of the visual check (heatmap of the worst frame). */
  visual?: VisualReport
  /** Shows the heatmap (difference mode, paused on the worst frame). */
  showHeatmap: boolean
  /** Placeholder text while there is no optimized animation yet. */
  pending?: string | null
}

export function Compare({
  original,
  optimized,
  originalSize,
  optimizedSize,
  mode,
  background,
  amplify,
  view,
  onView,
  clock,
  visual,
  showHeatmap,
  pending,
}: CompareProps) {
  const t = useT()
  const stageRef = useRef<HTMLDivElement>(null)
  const hostA = useRef<HTMLDivElement>(null)
  const hostB = useRef<HTMLDivElement>(null)
  const stage = useElementSize(stageRef)
  const a = usePlayer(hostA, original, clock)
  const b = usePlayer(hostB, optimized, clock)
  const [swipe, setSwipe] = useState(0.5)

  const size = useMemo(
    () => ({ w: original?.w || 512, h: original?.h || 512 }),
    [original?.w, original?.h],
  )
  const layout = layoutStage(mode, stage, size, view.zoom, view.pan)
  const { slots, boards } = layout

  // Wheel: ⌘/Ctrl (and trackpad pinch) zooms around the cursor, plain scrolling pans.
  const latest = useRef({ layout, view, onView })
  useLayoutEffect(() => {
    latest.current = { layout, view, onView }
  })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { layout: l, view: v, onView: set } = latest.current
      const box = el.getBoundingClientRect()
      const slot = e.clientX - box.left > l.slots.b.x && mode === 'side' ? l.slots.b : l.slots.a
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025))
        const point = { x: e.clientX - box.left - slot.x, y: e.clientY - box.top - slot.y }
        set(zoomAt(l, v.zoom * factor, point))
      } else {
        set({ zoom: v.zoom, pan: { x: v.pan.x - e.deltaX, y: v.pan.y - e.deltaY } })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode, latest])

  const drag = useRef<{
    id: number
    x: number
    y: number
    pan: View['pan']
    kind: 'pan' | 'swipe'
  } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const kind = (e.target as HTMLElement).closest('[data-swipe-handle]') ? 'swipe' : 'pan'
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: view.pan, kind }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (d.kind === 'swipe') {
      const box = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - box.left - slots.a.x
      setSwipe(Math.min(1, Math.max(0, x / Math.max(1, slots.a.w))))
      return
    }
    onView({ zoom: view.zoom, pan: { x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y } })
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  const boardClass = cn(
    'absolute overflow-hidden shadow-[0_0_0_1px_var(--le-line)]',
    BOARD_BACKGROUND[background],
  )
  const swipeX = slots.a.x + swipe * slots.a.w
  // Labels sit just above the artboards (inside the stage when zoomed in).
  const labelY = Math.max(8, slots.a.y + boards.a.y - 30)

  return (
    <div
      ref={stageRef}
      className="relative min-h-0 flex-1 touch-none overflow-hidden bg-canvas select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest('[data-swipe-handle]')) onView(FIT_VIEW)
      }}
      data-testid="opt-stage"
      data-mode={mode}
    >
      <div
        className={cn('absolute inset-0', mode === 'difference' && 'isolate')}
        style={{ filter: mode === 'difference' && amplify ? AMPLIFY : undefined }}
      >
        <div
          className="absolute overflow-hidden"
          style={rectStyle(slots.a)}
          data-testid="opt-slot-original"
        >
          <div ref={hostA} className={boardClass} style={rectStyle(boards.a)} />
        </div>
        <div
          className="absolute overflow-hidden"
          data-testid="opt-slot-optimized"
          style={{
            ...rectStyle(slots.b),
            clipPath: mode === 'swipe' ? `inset(0 ${(1 - swipe) * 100}% 0 0)` : undefined,
            mixBlendMode: mode === 'difference' ? 'difference' : undefined,
            // Until the result exists, the difference view shows nothing rather than the original.
            visibility: optimized || mode === 'side' ? undefined : 'hidden',
          }}
        >
          <div ref={hostB} className={boardClass} style={rectStyle(boards.b)} />
        </div>
      </div>

      {mode === 'difference' && showHeatmap && visual && (
        <Heatmap
          visual={visual}
          rect={{
            x: slots.a.x + boards.a.x,
            y: slots.a.y + boards.a.y,
            w: boards.a.w,
            h: boards.a.h,
          }}
        />
      )}

      {/* Labels */}
      {mode === 'side' && (
        <>
          <Label x={leftOf(slots.a, boards.a)} y={labelY}>
            <span className="font-medium text-fg">{t.optimizer.compare.original}</span>
            {originalSize && <span className="tabular-nums">{originalSize}</span>}
          </Label>
          <Label x={leftOf(slots.b, boards.b)} y={labelY}>
            <span className="font-medium text-fg">{t.optimizer.compare.optimized}</span>
            {optimizedSize && <span className="tabular-nums">{optimizedSize}</span>}
          </Label>
        </>
      )}
      {mode === 'swipe' && (
        <>
          <Label x={leftOf(slots.a, boards.a)} y={labelY}>
            <span className="font-medium text-fg">{t.optimizer.compare.optimized}</span>
            {optimizedSize && <span className="tabular-nums">{optimizedSize}</span>}
          </Label>
          <Label x={rightOf(slots.a, boards.a)} y={labelY} align="right">
            {originalSize && <span className="tabular-nums">{originalSize}</span>}
            <span className="font-medium text-fg">{t.optimizer.compare.original}</span>
          </Label>
        </>
      )}
      {mode === 'difference' && (
        <Label x={leftOf(slots.a, boards.a)} y={labelY}>
          <span className="font-medium text-fg">{t.optimizer.compare.difference}</span>
          <span>{t.optimizer.compare.differenceHint}</span>
        </Label>
      )}

      {mode === 'swipe' && optimized && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-10 w-px -translate-x-1/2 bg-white/90 shadow-[0_0_0_1px_rgb(0_0_0/0.25)]"
          style={{ left: swipeX }}
        >
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(swipe * 100)}
            onChange={(e) => setSwipe(Number(e.target.value) / 100)}
            aria-label={t.optimizer.compare.divider}
            className="peer sr-only"
            data-testid="opt-swipe"
          />
          <div
            data-swipe-handle
            aria-hidden
            className="pointer-events-auto absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-[#1b1c1f] shadow-[0_1px_4px_rgb(0_0_0/0.35)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
          >
            <ChevronsLeftRight size={14} />
          </div>
        </div>
      )}

      {/* States */}
      {(!original || (!a.ready && !a.failed)) && (
        <div
          className="pointer-events-none absolute flex items-center justify-center"
          style={rectStyle(slots.a)}
        >
          <Spinner size={16} />
        </div>
      )}
      {mode === 'side' && optimized && !b.ready && !b.failed && (
        <div
          className="pointer-events-none absolute flex items-center justify-center"
          style={rectStyle(slots.b)}
        >
          <Spinner size={16} />
        </div>
      )}
      {original && !optimized && pending && (
        <div
          className="pointer-events-none absolute flex items-center justify-center"
          style={mode === 'side' ? rectStyle(slots.b) : rectStyle(slots.a)}
        >
          <span className="flex items-center gap-2 rounded-md bg-surface-1/90 px-2.5 py-1.5 text-xs text-fg-muted shadow-[inset_0_0_0_1px_var(--le-line)]">
            <Spinner size={12} />
            {pending}
          </span>
        </div>
      )}
      {original && stage.w > 0 && <ZoomControls layout={layout} view={view} onView={onView} />}

      {(a.failed || b.failed) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-md bg-surface-3 px-2.5 py-1.5 text-xs text-danger shadow-popover">
            {t.optimizer.compare.failed}
          </span>
        </div>
      )}
    </div>
  )
}
