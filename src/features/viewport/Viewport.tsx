/**
 * The canvas: artboard preview with zoom/pan, selection on canvas and the compare view.
 *
 * React renders the static structure; a PaneController (pane.ts) drives everything that
 * changes at frame or pointer rate imperatively. In compare mode the original gets its own
 * pane on the left while the edited pane (and its player) stays mounted.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { backgroundColor } from './backgrounds'
import { CanvasContextMenu } from './components/CanvasContextMenu'
import { LoadingIndicator, PaneTopBar, chipClass } from './components/PaneChrome'
import { ZoomMenu } from './components/ZoomMenu'
import { PaneController, type PaneKind } from './pane'
import { installSpacePan } from './space-pan'
import { useViewport } from './store'

function Artboard({
  artboardRef,
  hostRef,
}: {
  artboardRef: RefObject<HTMLDivElement | null>
  hostRef: RefObject<HTMLDivElement | null>
}) {
  const mode = usePrefs((s) => s.canvasBackground)
  const custom = usePrefs((s) => s.canvasColor)
  const showBounds = usePrefs((s) => s.showBounds)
  const color = backgroundColor(mode, custom)
  // Position and size are written by the controller (camera), never by React.
  return (
    <div ref={artboardRef} className="absolute top-0 left-0" data-testid="artboard">
      <div
        className={cn(
          'absolute inset-0',
          color === null && 'checkerboard',
          showBounds && 'shadow-[0_0_0_1px_var(--le-line-strong)]',
        )}
        style={color ? { backgroundColor: color } : undefined}
      />
      <div ref={hostRef} className="absolute top-0 left-0 origin-top-left overflow-hidden" />
    </div>
  )
}

function ViewportPane({ kind, compare }: { kind: PaneKind; compare: boolean }) {
  const t = useT()
  const rootRef = useRef<HTMLElement>(null)
  const artboardRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<SVGSVGElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<PaneController | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const artboard = artboardRef.current
    const host = hostRef.current
    if (!root || !artboard || !host) return
    const controller = new PaneController(
      {
        root,
        artboard,
        host,
        overlay: overlayRef.current,
        cursor: cursorRef.current,
        readout: readoutRef.current,
      },
      kind,
    )
    controllerRef.current = controller
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [kind])

  const edited = kind === 'edited'
  return (
    <CanvasContextMenu kind={kind}>
      <section
        ref={rootRef}
        tabIndex={-1}
        aria-label={
          compare ? (edited ? t.viewport.edited : t.viewport.original) : t.viewport.canvasLabel
        }
        data-testid={`viewport-${kind}`}
        className="relative h-full min-w-0 flex-1 touch-none overflow-hidden outline-none select-none data-[drag=copy]:cursor-copy data-[drag=move]:cursor-default data-[pan=active]:cursor-grabbing data-[pan=ready]:cursor-grab"
      >
        <Artboard artboardRef={artboardRef} hostRef={hostRef} />
        {edited && (
          <svg
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          />
        )}
        <PaneTopBar kind={kind} compare={compare} onRetry={() => controllerRef.current?.reload()} />
        {edited && <LoadingIndicator />}
        <div
          ref={cursorRef}
          hidden
          data-testid={`cursor-${kind}`}
          className={cn(chipClass, 'pointer-events-none absolute bottom-2 left-2 z-10')}
        />
        {edited && (
          // Positioned next to the pointer by the controller while layers are dragged.
          <div
            ref={readoutRef}
            hidden
            aria-hidden
            data-testid="drag-readout"
            className="pointer-events-none absolute top-0 left-0 z-20 rounded-md bg-surface-3 px-2 py-1 text-xs whitespace-nowrap text-fg tabular-nums shadow-popover"
          />
        )}
        {edited && (
          <div className="absolute right-2 bottom-2 z-10" data-pane-chrome="">
            <ZoomMenu variant="chip" />
          </div>
        )}
      </section>
    </CanvasContextMenu>
  )
}

export function Viewport() {
  const hasDoc = useDocument((s) => s.doc !== null)
  const hasOriginal = useDocument((s) => s.original !== null)
  const compare = useViewport((s) => s.compare) && hasOriginal

  useEffect(() => installSpacePan(), [])

  if (!hasDoc) return null
  return (
    <div className="flex h-full w-full min-w-0 bg-canvas" data-testid="viewport">
      {compare && <ViewportPane key="original" kind="original" compare />}
      {compare && <div key="divider" aria-hidden className="w-px shrink-0 bg-line-strong" />}
      <ViewportPane key="edited" kind="edited" compare={compare} />
    </div>
  )
}
