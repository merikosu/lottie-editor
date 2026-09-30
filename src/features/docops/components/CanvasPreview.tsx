import { useEffect, useRef } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { Rect, ResizePlan } from '@/lottie/canvas'
import type { Animation } from '@/lottie/types'
import { LottiePlayer } from '@/player/LottiePlayer'
import { usePlayback } from '@/store/playback'
import { usePrefs } from '@/store/prefs'

interface CanvasPreviewProps {
  doc: Animation
  plan: ResizePlan
  /** Content bounds over the whole animation (in the current canvas), when measured. */
  bounds: Rect | null
  width?: number
  height?: number
  className?: string
}

const PAD = 14

/** Renders the current frame once (the document does not change while a dialog is open). */
function FramePreview({ doc }: { doc: Animation }) {
  const host = useRef<HTMLDivElement>(null)
  const runExpressions = usePrefs((s) => s.runExpressions)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const player = new LottiePlayer(el, { renderer: 'svg', runExpressions })
    player.renderFrame(Math.round(usePlayback.getState().frame))
    player.load(doc)
    return () => player.destroy()
  }, [doc, runExpressions])
  return <div ref={host} className="absolute inset-0" aria-hidden />
}

/**
 * Before/after picture of a canvas change: the new artboard (checkerboard), the current
 * frame placed where the content will end up, the old canvas (dashed) and the content
 * bounds (dotted). Areas outside the new canvas are dimmed: they will be cropped.
 */
export function CanvasPreview({
  doc,
  plan,
  bounds,
  width = 232,
  height = 208,
  className,
}: CanvasPreviewProps) {
  const t = useT()
  const s = plan.scale
  // Everything in new-canvas coordinates.
  const old = { x: plan.dx, y: plan.dy, w: doc.w * s, h: doc.h * s }
  const content = bounds
    ? {
        x: bounds.x * s + plan.dx,
        y: bounds.y * s + plan.dy,
        w: bounds.width * s,
        h: bounds.height * s,
      }
    : null
  const minX = Math.min(0, old.x, content?.x ?? 0)
  const minY = Math.min(0, old.y, content?.y ?? 0)
  const maxX = Math.max(plan.width, old.x + old.w, content ? content.x + content.w : 0)
  const maxY = Math.max(plan.height, old.y + old.h, content ? content.y + content.h : 0)
  const k = Math.min(
    (width - PAD * 2) / Math.max(1, maxX - minX),
    (height - PAD * 2) / Math.max(1, maxY - minY),
  )
  const ox = (width - (maxX - minX) * k) / 2 - minX * k
  const oy = (height - (maxY - minY) * k) / 2 - minY * k
  const box = (r: { x: number; y: number; w: number; h: number }) => ({
    left: ox + r.x * k,
    top: oy + r.y * k,
    width: Math.max(1, r.w * k),
    height: Math.max(1, r.h * k),
  })
  const artboard = box({ x: 0, y: 0, w: plan.width, h: plan.height })

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="docops-canvas-preview">
      <div
        className="relative overflow-hidden rounded-md bg-canvas shadow-[inset_0_0_0_1px_var(--le-line)]"
        style={{ width, height }}
      >
        <div className="absolute checkerboard" style={artboard} />
        <div className="absolute" style={box(old)}>
          <FramePreview doc={doc} />
        </div>
        {/* Dim what falls outside the new canvas. */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height}
          aria-hidden
        >
          <path
            fillRule="evenodd"
            className="fill-canvas"
            fillOpacity={0.72}
            d={`M0 0H${width}V${height}H0Z M${artboard.left} ${artboard.top}h${artboard.width}v${artboard.height}h${-artboard.width}Z`}
          />
          <rect
            x={artboard.left + 0.5}
            y={artboard.top + 0.5}
            width={Math.max(0, artboard.width - 1)}
            height={Math.max(0, artboard.height - 1)}
            fill="none"
            className="stroke-line-strong"
          />
          {(Math.abs(old.x) > 0.01 ||
            Math.abs(old.y) > 0.01 ||
            Math.abs(old.w - plan.width) > 0.01 ||
            Math.abs(old.h - plan.height) > 0.01) && (
            <rect
              x={box(old).left + 0.5}
              y={box(old).top + 0.5}
              width={Math.max(0, box(old).width - 1)}
              height={Math.max(0, box(old).height - 1)}
              fill="none"
              strokeDasharray="3 3"
              className="stroke-fg-subtle"
            />
          )}
          {content && (
            <rect
              x={box(content).left + 0.5}
              y={box(content).top + 0.5}
              width={Math.max(0, box(content).width - 1)}
              height={Math.max(0, box(content).height - 1)}
              fill="none"
              strokeDasharray="1 2"
              className="stroke-accent"
            />
          )}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-[1px] border border-line-strong" />
          {t.docops.dialogs.next}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-[1px] border border-dashed border-fg-subtle" />
          {t.docops.dialogs.current}
        </span>
        {content && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[1px] border border-dotted border-accent" />
            {t.docops.dialogs.contentBounds}
          </span>
        )}
      </div>
    </div>
  )
}
