/**
 * Dragging the selected layers and shape groups on the canvas.
 *
 * While the pointer moves, only the preview changes: each step renders a moved copy of the
 * document (immer, structurally shared) and the selection outlines captured when the drag
 * started follow the pointer exactly. The document is edited once, on release: one undo step
 * however long the drag lasts (with pauses), no history churn, and Esc restores everything
 * without leaving a redo entry behind.
 *
 * The dragged selection snaps to the artboard and to the other objects on it (their bounds when
 * the drag started), unless snapping is bypassed (⌘/Ctrl). With Alt the drag leaves the
 * originals in place and moves copies (Figma / After Effects); Alt can be toggled mid-drag.
 */
import { produce } from 'immer'
import { getT } from '@/i18n'
import { getAt, isLayerPath, isShapePath, pathKey, type NodePath } from '@/lottie/path'
import { getKeyframes, type AnyProperty } from '@/lottie/property'
import type { Animation, ShapeItem } from '@/lottie/types'
import { updateDoc, useDocument, type KeyframeRef, type Selection } from '@/store/document'
import { pause, usePlayback } from '@/store/playback'
import { boundsOfPoints, type Point, type Rect } from './lib/geometry'
import {
  applyMove,
  canDuplicateTargets,
  duplicateTargets,
  hasMovingAncestor,
  movedPosition,
  moveOwner,
  planMove,
  type MoveTarget,
} from './lib/move'
import {
  artboardLines,
  mergeLines,
  rectLines,
  snapOffset,
  type SnapLines,
  type SnapResult,
} from './lib/snap'
import { chainKey, instanceChainFor } from '@/features/layers/instances'
import { isLockedOnCanvas } from './locks'
import { measureNodeInstances, selectionGeometry, type NodeGeometry } from './overlay'

/** Objects measured as snapping targets at most (measuring runs once, when a drag starts). */
const MAX_SNAP_TARGETS = 400

/** History label: "Move layer", "Move 3 groups", "Duplicate 2 layers"… */
function moveLabel(targets: readonly MoveTarget[], duplicate: boolean): string {
  const layers = targets.filter((t) => isLayerPath(t.path)).length
  const kind = layers === targets.length ? 'layer' : layers === 0 ? 'group' : 'mixed'
  const t = getT().viewport
  return duplicate ? t.historyDuplicate(targets.length, kind) : t.historyMove(targets.length, kind)
}

/**
 * Keyframe references after an edit that inserted or removed keys without moving any: each
 * follows its key (found again by time); references to removed keys are dropped.
 */
export function followKeyRefs(
  before: Animation,
  after: Animation,
  refs: readonly KeyframeRef[],
): KeyframeRef[] {
  return refs.flatMap((ref) => {
    const t = getKeyframes(getAt<AnyProperty>(before, ref.path))?.[ref.index]?.t
    const keys = getKeyframes(getAt<AnyProperty>(after, ref.path))
    if (t === undefined || !keys) return []
    if (keys[ref.index]?.t === t) return [ref]
    const index = keys.findIndex((kf) => Math.abs(kf.t - t) < 1e-6)
    return index < 0 ? [] : [{ path: ref.path, index }]
  })
}

/**
 * Applies a drag to a draft: moves the targets, or (`duplicate`) copies of them. Returns the
 * paths of what moved.
 */
function applyDrag(
  d: Animation,
  targets: readonly MoveTarget[],
  delta: Point,
  duplicate: boolean,
): NodePath[] {
  const moved = duplicate ? duplicateTargets(d, targets, getT().layers.copySuffix) : targets
  applyMove(d, moved, delta)
  return moved.map((t) => t.path)
}

/**
 * Bounds (document coordinates) of the objects a drag of the nodes at `paths` can snap to: the
 * root layers and, for dragged groups, their sibling groups — without anything that moves along
 * (the dragged nodes, their children, the layers and groups containing them) or is not rendered
 * (hidden, matte sources, outside its time range). Also used by resizes (their moving edges).
 */
export function snapTargetRects(
  doc: Animation,
  paths: readonly NodePath[],
  svg: SVGSVGElement,
): Rect[] {
  const moving = new Set(paths.map((p) => pathKey(p)))
  const candidates: NodePath[] = []
  const seen = new Set<string>()
  const add = (p: NodePath) => {
    const key = pathKey(p)
    if (!seen.has(key)) {
      seen.add(key)
      candidates.push(p)
    }
  }
  for (const path of paths) {
    if (!isShapePath(path)) continue
    const siblings = getAt<ShapeItem[]>(doc, path.slice(0, -1)) ?? []
    siblings.forEach((item, i) => {
      if (item?.ty === 'gr') add([...path.slice(0, -1), i])
    })
  }
  doc.layers.forEach((_, i) => add(['layers', i]))
  // A node containing a dragged one changes its bounds during the drag.
  const contains = (p: NodePath) => {
    const prefix = `${pathKey(p)}/`
    return [...moving].some((m) => m.startsWith(prefix))
  }
  const rects: Rect[] = []
  for (const p of candidates.slice(0, MAX_SNAP_TARGETS)) {
    const key = pathKey(p)
    if (moving.has(key) || contains(p) || hasMovingAncestor(doc, p, moving)) continue
    // Shared precomp content: its siblings as drawn in the instance being edited, not the
    // union of every instance.
    const instances = measureNodeInstances(doc, p, svg)
    const working = instances.length > 1 ? instanceChainFor(doc, p) : null
    const own = working ? instances.filter((i) => i.chain === chainKey(working)) : []
    const bounds = boundsOfPoints((own.length ? own : instances).flatMap((i) => i.quad))
    if (bounds) rects.push(bounds)
  }
  return rects
}

interface Drag {
  /** The document the drag started from (the preview is derived from it). */
  base: Animation
  targets: MoveTarget[]
  /** Pointer at the start, in document coordinates. */
  start: Point
  offset: Point
  /** Selection outlines when the drag started (document coordinates). */
  geometry: NodeGeometry
  /** Their bounds (what snaps), null when nothing is measurable. */
  bounds: Rect | null
  /** Lines the selection snaps to. */
  lines: SnapLines
  guides: SnapResult['guides']
  /** Alt: copies move, the originals stay. */
  duplicate: boolean
}

/** What the overlay draws during a drag. */
export interface DragOverlay {
  geometry: NodeGeometry
  offset: Point
  /** Snapping guides (document coordinates). */
  guides: SnapResult['guides']
}

/** Live readout of a drag: the moved node's new position (one node) or the offset. */
export type DragReadout =
  { kind: 'position'; x: number; y: number } | { kind: 'offset'; dx: number; dy: number }

export class MoveGesture {
  private drag: Drag | null = null

  get active(): boolean {
    return this.drag !== null
  }

  /** What the overlay draws for the moved selection (null when no drag is in progress). */
  get overlay(): DragOverlay | null {
    const drag = this.drag
    return drag && { geometry: drag.geometry, offset: drag.offset, guides: drag.guides }
  }

  /** The document the drag started from; the drag is void once the document changes under it. */
  get base(): Animation | null {
    return this.drag?.base ?? null
  }

  /** The drag currently leaves copies behind (Alt). */
  get duplicating(): boolean {
    return this.drag?.duplicate ?? false
  }

  /**
   * The value the moved node's Position will show (in its parent's space, like the inspector),
   * or the drag offset when several nodes move.
   */
  get readout(): DragReadout | null {
    const drag = this.drag
    if (!drag) return null
    if (drag.targets.length === 1) {
      const [x, y] = movedPosition(drag.targets[0], drag.offset)
      return { kind: 'position', x, y }
    }
    return { kind: 'offset', dx: drag.offset.x, dy: drag.offset.y }
  }

  /**
   * Starts moving the selected `paths` from the document point `start`. `hint` (the paths under
   * the pointer) picks the precomp instance nodes are dragged in. False when nothing can move.
   */
  begin(
    paths: readonly NodePath[],
    start: Point,
    hint: readonly NodePath[],
    svg: SVGSVGElement | null,
  ): boolean {
    const doc = useDocument.getState().doc
    if (!doc || paths.length === 0) return false
    // Keys are written at the playhead: it must not run away during the drag.
    pause()
    const frame = usePlayback.getState().frame
    const targets = planMove(doc, paths, frame, { instanceHint: hint, blocked: isLockedOnCanvas })
    if (targets.length === 0) return false
    // Outline only what actually moves (not the locked part of a selection).
    const moving = new Set(targets.map((t) => pathKey(t.path)))
    const moved = paths.filter((p) => {
      const owner = moveOwner(doc, p)
      return !!owner && (moving.has(pathKey(owner)) || hasMovingAncestor(doc, owner, moving))
    })
    // Other instances of shared precomp content follow in the preview; the outline, snapping
    // and readout are those of the instance being dragged.
    const full = selectionGeometry(doc, moved, frame, svg)
    const geometry = { ...full, outlines: full.outlines.filter((o) => !o.linked) }
    const points = [...geometry.outlines.flatMap((o) => o.quad), ...geometry.anchors]
    const lines = mergeLines(
      artboardLines(doc.w, doc.h),
      rectLines(
        svg
          ? snapTargetRects(
              doc,
              targets.map((t) => t.path),
              svg,
            )
          : [],
      ),
    )
    this.drag = {
      base: doc,
      targets,
      start,
      offset: { x: 0, y: 0 },
      geometry,
      bounds: boundsOfPoints(points),
      lines,
      guides: { x: null, y: null },
      duplicate: false,
    }
    return true
  }

  /**
   * Moves to the document point `point` (`constrain`: dominant axis only, Shift; `snapThreshold`:
   * snapping distance in document units, null to not snap; `duplicate`: move copies, Alt).
   * Returns the document to preview, or null when nothing changed.
   */
  update(
    point: Point,
    constrain: boolean,
    snapThreshold: number | null = null,
    duplicate = false,
  ): Animation | null {
    const drag = this.drag
    if (!drag) return null
    const copies = duplicate && canDuplicateTargets(drag.targets)
    const modeChanged = copies !== drag.duplicate
    drag.duplicate = copies
    let dx = point.x - drag.start.x
    let dy = point.y - drag.start.y
    let lock: 'x' | 'y' | null = null
    if (constrain) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        dy = 0
        lock = 'y'
      } else {
        dx = 0
        lock = 'x'
      }
    }
    drag.guides = { x: null, y: null }
    if (snapThreshold !== null && drag.bounds) {
      // Copies also align with their originals (which stay where they were).
      const lines = copies ? mergeLines(drag.lines, rectLines([drag.bounds])) : drag.lines
      const snapped = snapOffset(drag.bounds, { x: dx, y: dy }, lines, snapThreshold, lock)
      dx = snapped.offset.x
      dy = snapped.offset.y
      drag.guides = snapped.guides
    }
    if (dx === drag.offset.x && dy === drag.offset.y && !modeChanged) return null
    drag.offset = { x: dx, y: dy }
    const { targets } = drag
    const delta = { x: dx, y: dy }
    return produce(drag.base, (d) => void applyDrag(d as Animation, targets, delta, copies))
  }

  /** Ends the drag and writes the result to the document (one undo step). */
  finish(): void {
    const drag = this.drag
    this.drag = null
    if (!drag || (drag.offset.x === 0 && drag.offset.y === 0)) return
    // The document changed during the drag (it should not): the plan no longer applies.
    if (useDocument.getState().doc !== drag.base) return
    const { targets, offset, duplicate, base } = drag
    let moved: NodePath[] = []
    // Copies end up selected (the originals stay where they were). A move may add position
    // keys at the playhead: selected keyframes keep pointing at the same keys.
    const selection = duplicate
      ? (): Selection => ({ nodes: moved, keyframes: [], property: null })
      : (next: Animation): Selection => {
          const sel = useDocument.getState().selection
          return { ...sel, keyframes: followKeyRefs(base, next, sel.keyframes) }
        }
    updateDoc(
      moveLabel(targets, duplicate),
      (d) => {
        moved = applyDrag(d as Animation, targets, offset, duplicate)
      },
      { selection },
    )
  }

  /** Ends the drag without changing the document (Esc). */
  cancel(): void {
    this.drag = null
  }
}
