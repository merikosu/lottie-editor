/**
 * Pointer drag sessions tracked on `window` (rows may re-render or unmount mid-drag because
 * the document changes live), with a start threshold, Esc to cancel and an auto-scroll hook.
 */
export interface DragInfo {
  dx: number
  dy: number
}

export interface DragEnd {
  /** The pointer moved past the threshold (otherwise it was a click). */
  moved: boolean
  /** Esc or pointercancel. */
  cancelled: boolean
  event: PointerEvent | null
}

export interface DragHandlers {
  /** Distance in px before the drag starts (default 3; 0 = immediately). */
  threshold?: number
  /** Cursor for the whole page while dragging. */
  cursor?: string
  onMove(e: PointerEvent, info: DragInfo): void
  onEnd(end: DragEnd): void
  /** Called every animation frame while dragging; return true after scrolling to replay the move. */
  autoScroll?(e: PointerEvent): boolean
}

interface DownEvent {
  clientX: number
  clientY: number
  pointerId: number
}

let active: (() => void) | null = null

/** True while any timeline drag is in progress. */
export function isDragging(): boolean {
  return active !== null
}

/** Starts a drag session. Returns a function that cancels it. */
export function startDrag(down: DownEvent, handlers: DragHandlers): () => void {
  active?.()
  const threshold = handlers.threshold ?? 3
  let moved = threshold === 0
  let last: PointerEvent | null = null
  let raf = 0
  let done = false
  const previousCursor = document.body.style.cursor
  if (moved && handlers.cursor) document.body.style.cursor = handlers.cursor

  const info = (e: PointerEvent): DragInfo => ({
    dx: e.clientX - down.clientX,
    dy: e.clientY - down.clientY,
  })

  const tick = () => {
    raf = 0
    if (done || !last || !moved || !handlers.autoScroll) return
    if (handlers.autoScroll(last)) {
      handlers.onMove(last, info(last))
      raf = requestAnimationFrame(tick)
    }
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return
    last = e
    if (!moved) {
      const { dx, dy } = info(e)
      if (Math.hypot(dx, dy) < threshold) return
      moved = true
      if (handlers.cursor) document.body.style.cursor = handlers.cursor
    }
    handlers.onMove(e, info(e))
    if (handlers.autoScroll && !raf) raf = requestAnimationFrame(tick)
  }

  const finish = (cancelled: boolean, event: PointerEvent | null) => {
    if (done) return
    done = true
    active = null
    if (raf) cancelAnimationFrame(raf)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    document.body.style.cursor = previousCursor
    handlers.onEnd({ moved, cancelled, event })
  }

  const onUp = (e: PointerEvent) => {
    if (e.pointerId === down.pointerId) finish(false, e)
  }
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === down.pointerId) finish(true, e)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    // Esc cancels the drag only (not the global "deselect").
    e.preventDefault()
    e.stopPropagation()
    finish(true, null)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey, true)
  const cancel = () => finish(true, null)
  active = cancel
  return cancel
}

/**
 * Edge auto-scroll speed for a pointer position: positive near the far edge, negative near
 * the near edge, 0 elsewhere. Grows with proximity (and beyond the edge).
 */
export function edgeSpeed(pos: number, start: number, end: number, zone = 28, max = 18): number {
  if (end - start < zone * 3) return 0
  if (pos < start + zone) return -Math.min(max, ((start + zone - pos) / zone) * max)
  if (pos > end - zone) return Math.min(max, ((pos - (end - zone)) / zone) * max)
  return 0
}
