/**
 * Imperative controller of the Customize preview. Everything that changes at frame or pointer
 * rate lives here instead of React state:
 *  - the artboard is fitted into its area (device-pixel snapped) on resize and canvas changes;
 *  - the player follows the document with coalesced reloads (at most one per animation frame
 *    and never more often than twice the last load took), a new file loads at once;
 *  - the playhead is rendered in the same tick it changes, outlines are redrawn with it;
 *  - hover and click pick elements from the rendered SVG (layers and groups are tagged with
 *    their JSON paths), outlines are measured from the same elements.
 */
import { pathEquals, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { LottiePlayer } from '@/player/LottiePlayer'
import { nodeClassName, nodePathsFromElement } from '@/player/prepare'
import { primaryNode, useDocument } from '@/store/document'
import { subscribeFrame } from '@/store/playback'
import { usePrefs } from '@/store/prefs'
import { setHoverNode, useUi } from '@/store/ui'
import { hasModKey } from '@/lib/platform'

/** Space kept around the artboard. */
const PADDING = 32
const MIN_RELOAD_INTERVAL = 50
/** Outlines drawn per role (instances of a shared composition each get one). */
const MAX_OUTLINES = 8

export interface PreviewElements {
  /** Area the artboard is fitted into. */
  area: HTMLElement
  artboard: HTMLElement
  /** Player host (inside the artboard). */
  host: HTMLElement
  /** Outline layer (inside the artboard, above the player). */
  outlines: HTMLElement
}

export interface PreviewCallbacks {
  /** The element a click on the tagged `stack` (innermost first) picks; null for none. */
  pick: (stack: NodePath[], deep: boolean) => NodePath | null
  /** Elements outlined as selected (usually the picked one). */
  selected: () => NodePath | null
  /** Name shown next to the hover outline. */
  nameOf: (path: NodePath) => string
  onPick: (path: NodePath | null) => void
  /** Double-click on an element. */
  onActivate: (path: NodePath) => void
  onStatus: (status: { ready: boolean; error: Error | null }) => void
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const visible = (value: string) => value !== 'none' && value !== ''

/** An element or one of its ancestors (below `root`) is fully transparent (hit tests ignore it). */
function transparent(el: Element, root: Element): boolean {
  for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
    if (Number(getComputedStyle(node).opacity) === 0) return true
  }
  return false
}

/** True when `el` (a rendered element) paints the client point: its fill or its stroke. */
function paintsAt(el: Element, root: Element, clientX: number, clientY: number): boolean {
  if (transparent(el, root)) return false
  if (!(el instanceof SVGGeometryElement)) return true
  const style = getComputedStyle(el)
  if (style.visibility === 'hidden') return false
  const ctm = el.getScreenCTM()
  if (!ctm) return false
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  const filled = visible(style.fill) && Number(style.fillOpacity) > 0
  if (filled && el.isPointInFill(point)) return true
  const stroked =
    visible(style.stroke) && Number(style.strokeOpacity) > 0 && parseFloat(style.strokeWidth) > 0
  return stroked && el.isPointInStroke(point)
}

export class PreviewController {
  private readonly els: PreviewElements
  private readonly cb: PreviewCallbacks
  private readonly player: LottiePlayer
  private readonly disposers: Array<() => void> = []
  private readonly resizeObserver: ResizeObserver
  private docId: string | null
  private loaded: Animation | null = null
  private queued: Animation | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private raf = 0
  private lastLoadAt = -Infinity
  private loadCost = 0
  /** The hover outline belongs to this preview (the pointer is over it). */
  private ownsHover = false
  private readonly pool: HTMLDivElement[] = []
  private label: HTMLDivElement
  private destroyed = false

  constructor(els: PreviewElements, cb: PreviewCallbacks) {
    this.els = els
    this.cb = cb
    this.docId = useDocument.getState().meta?.id ?? null
    this.player = new LottiePlayer(els.host, {
      renderer: 'svg',
      tagNodes: true,
      runExpressions: usePrefs.getState().runExpressions,
      onReady: () => {
        if (this.destroyed) return
        this.els.host.style.visibility = ''
        this.cb.onStatus({ ready: true, error: null })
        this.drawOutlines()
      },
      onError: (error) => {
        if (!this.destroyed) this.cb.onStatus({ ready: this.player.isReady, error })
      },
    })
    this.label = document.createElement('div')
    this.label.className =
      'pointer-events-none absolute z-10 hidden max-w-60 truncate rounded-sm bg-accent px-1.5 py-px text-2xs font-medium text-accent-fg'
    els.outlines.appendChild(this.label)

    this.resizeObserver = new ResizeObserver(() => this.layout())
    this.resizeObserver.observe(els.area)
    this.layout()
    this.subscribe()
    this.listen()
    this.request(useDocument.getState().doc, true)
  }

  destroy(): void {
    this.destroyed = true
    this.resizeObserver.disconnect()
    for (const dispose of this.disposers.splice(0)) dispose()
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.ownsHover) setHoverNode(null)
    this.player.destroy()
  }

  /** Loads the current document again (after a failure). */
  reload(): void {
    const doc = useDocument.getState().doc
    this.loaded = null
    this.request(doc, true)
  }

  /* ------------------------------------------------------------------------ */
  /*                                  Loading                                 */
  /* ------------------------------------------------------------------------ */

  private request(doc: Animation | null, immediate = false): void {
    if (!doc || this.destroyed) return
    if (doc === this.loaded && !this.queued) return
    this.queued = doc
    if (immediate) {
      this.flush()
      return
    }
    if (this.timer !== null || this.raf !== 0) return
    const wait =
      this.lastLoadAt + Math.max(MIN_RELOAD_INTERVAL, this.loadCost * 2) - performance.now()
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, wait)
    } else {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0
        this.flush()
      })
    }
  }

  private flush(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.timer = null
    this.raf = 0
    const doc = this.queued
    this.queued = null
    if (!doc || this.destroyed) return
    this.loaded = doc
    const start = performance.now()
    this.player.load(doc)
    this.lastLoadAt = performance.now()
    this.loadCost = this.lastLoadAt - start
  }

  /* ------------------------------------------------------------------------ */
  /*                               Subscriptions                              */
  /* ------------------------------------------------------------------------ */

  private subscribe(): void {
    const d = this.disposers
    d.push(
      useDocument.subscribe(
        (s) => s.doc,
        (doc, prev) => {
          if (!doc) return
          const id = useDocument.getState().meta?.id ?? null
          const fresh = id !== this.docId
          this.docId = id
          // Another file: don't show the previous one while it loads.
          if (fresh) this.els.host.style.visibility = 'hidden'
          this.request(doc, fresh)
          if (!prev || prev.w !== doc.w || prev.h !== doc.h) this.layout()
        },
      ),
    )
    d.push(
      subscribeFrame((frame) => {
        this.player.renderFrame(frame)
        this.drawOutlines()
      }),
    )
    d.push(
      useDocument.subscribe(
        (s) => s.selection,
        () => this.drawOutlines(),
      ),
    )
    d.push(
      useUi.subscribe((s, prev) => {
        if (s.hoverNode !== prev.hoverNode) this.drawOutlines()
      }),
    )
    d.push(
      usePrefs.subscribe((s, prev) => {
        if (s.runExpressions === prev.runExpressions) return
        this.player.setOptions({ runExpressions: s.runExpressions })
        this.reload()
      }),
    )
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Layout                                 */
  /* ------------------------------------------------------------------------ */

  private layout(): void {
    const doc = useDocument.getState().doc
    if (!doc || this.destroyed) return
    const rect = this.els.area.getBoundingClientRect()
    const aw = rect.width - PADDING * 2
    const ah = rect.height - PADDING * 2
    if (aw <= 0 || ah <= 0 || !(doc.w > 0) || !(doc.h > 0)) return
    const dpr = window.devicePixelRatio || 1
    const snap = (v: number) => Math.round(v * dpr) / dpr
    const scale = Math.min(aw / doc.w, ah / doc.h)
    const w = snap(doc.w * scale)
    const h = snap(doc.h * scale)
    const s = this.els.artboard.style
    s.width = `${w}px`
    s.height = `${h}px`
    s.left = `${snap((rect.width - w) / 2)}px`
    s.top = `${snap((rect.height - h) / 2)}px`
    this.drawOutlines()
  }

  /* ------------------------------------------------------------------------ */
  /*                                  Pointer                                 */
  /* ------------------------------------------------------------------------ */

  /**
   * Tagged paths of what is drawn at a point (innermost first). Browsers hit-test the whole
   * interior of lottie-web's stroke paths (they have a transparent fill), so an outline would
   * cover everything inside it: the first element that actually paints the point wins.
   */
  private stackAt(clientX: number, clientY: number): NodePath[] {
    const svg = this.player.svg
    if (!svg) return []
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (el === svg || !svg.contains(el)) continue
      if (paintsAt(el, svg, clientX, clientY)) return nodePathsFromElement(el, svg)
    }
    return []
  }

  private listen(): void {
    const el = this.els.artboard
    const onMove = (e: PointerEvent) => {
      const path = this.cb.pick(this.stackAt(e.clientX, e.clientY), hasModKey(e))
      el.style.cursor = path ? 'pointer' : ''
      if (!pathEquals(useUi.getState().hoverNode, path)) setHoverNode(path)
      this.ownsHover = path !== null
    }
    const onLeave = () => {
      el.style.cursor = ''
      if (this.ownsHover) setHoverNode(null)
      this.ownsHover = false
    }
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return
      this.cb.onPick(this.cb.pick(this.stackAt(e.clientX, e.clientY), hasModKey(e)))
    }
    const onDoubleClick = (e: MouseEvent) => {
      const path = this.cb.pick(this.stackAt(e.clientX, e.clientY), hasModKey(e))
      if (path) this.cb.onActivate(path)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('click', onClick)
    el.addEventListener('dblclick', onDoubleClick)
    this.disposers.push(() => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('click', onClick)
      el.removeEventListener('dblclick', onDoubleClick)
    })
  }

  /* ------------------------------------------------------------------------ */
  /*                                  Outlines                                */
  /* ------------------------------------------------------------------------ */

  /** Boxes of the rendered elements of `path` (one per instance), in artboard pixels. */
  private boxesOf(path: NodePath | null): Box[] {
    const svg = this.player.svg
    if (!path || !svg) return []
    const origin = this.els.artboard.getBoundingClientRect()
    const boxes: Box[] = []
    for (const el of svg.querySelectorAll(`.${nodeClassName(path)}`)) {
      const r = el.getBoundingClientRect()
      if (r.width < 0.5 && r.height < 0.5) continue
      boxes.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height })
      if (boxes.length >= MAX_OUTLINES) break
    }
    return boxes
  }

  private outline(index: number): HTMLDivElement {
    let div = this.pool[index]
    if (!div) {
      div = document.createElement('div')
      div.className = 'pointer-events-none absolute rounded-[1px]'
      this.els.outlines.insertBefore(div, this.label)
      this.pool[index] = div
    }
    return div
  }

  private drawOutlines(): void {
    if (this.destroyed) return
    const selectedPath = this.cb.selected()
    const hoverPath = useUi.getState().hoverNode
    const hover = pathEquals(hoverPath, selectedPath) ? [] : this.boxesOf(hoverPath)
    const selected = this.boxesOf(selectedPath)
    let n = 0
    const place = (box: Box, kind: 'hover' | 'selected') => {
      const div = this.outline(n++)
      const s = div.style
      s.display = ''
      s.left = `${box.x}px`
      s.top = `${box.y}px`
      s.width = `${box.w}px`
      s.height = `${box.h}px`
      s.boxShadow =
        kind === 'selected'
          ? '0 0 0 1.5px var(--le-accent)'
          : '0 0 0 1px color-mix(in srgb, var(--le-accent) 80%, transparent)'
    }
    for (const box of selected) place(box, 'selected')
    for (const box of hover) place(box, 'hover')
    for (let i = n; i < this.pool.length; i++) this.pool[i].style.display = 'none'

    // The name of what the pointer is over, at the top-left of its first box.
    const labelBox = this.ownsHover ? (hover[0] ?? selected[0]) : undefined
    const labelPath = this.ownsHover ? hoverPath : null
    if (labelBox && labelPath) {
      this.label.textContent = this.cb.nameOf(labelPath)
      this.label.style.left = `${Math.max(0, labelBox.x)}px`
      this.label.style.top = `${Math.max(0, labelBox.y - 20)}px`
      this.label.classList.remove('hidden')
    } else {
      this.label.classList.add('hidden')
    }
  }
}

/** The primary selected node (the preview outlines it). */
export function selectedNode(): NodePath | null {
  return primaryNode(useDocument.getState().selection)
}
