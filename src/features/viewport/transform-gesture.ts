/**
 * Scaling and rotating the selection with the gizmo's handles: one layer or group, or several
 * together about their bounds.
 *
 * Like the move gesture: while the pointer moves only the preview changes (each step renders an
 * edited copy of the document) and the gizmo drawn by the overlay follows the pointer exactly,
 * computed from the math rather than measured, so it never lags a slow preview. The document is
 * edited once, on release: one undo step however long the drag lasts; Esc leaves no trace.
 *
 * Modifiers apply at once, also mid-drag: Shift keeps the proportions (resize) or turns in 15°
 * steps (rotate); Alt scales about the anchor point of a layer or the center of a group or of a
 * selection, and turns a single node about its box center; ⌘/Ctrl turns snapping off.
 */
import { produce } from 'immer'
import { getT } from '@/i18n'
import type { MovedKind } from '@/i18n/locales/en/viewport'
import { isLayerPath, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { updateDoc, useDocument, type Selection } from '@/store/document'
import { pause, usePlayback } from '@/store/playback'
import { transformRect } from './lib/geometry'
import type { CornerId, HandleId } from './lib/gizmo'
import {
  groupResize,
  groupRotate,
  groupRotationAngle,
  type GroupMember,
} from './lib/group-transform'
import { applyToPoint, type Mat2D, type Point } from './lib/matrix'
import { resizeNode } from './lib/resize'
import { rotateNode, rotatePivot, rotationAngle, unwrapAngle, type RotatePivot } from './lib/rotate'
import { artboardLines, mergeLines, rectLines, type SnapLines, type SnapResult } from './lib/snap'
import {
  applyTransform,
  linear,
  planTransform,
  type GizmoFrame,
  type TransformEdit,
  type TransformValues,
} from './lib/transform-edit'
import { followKeyRefs, snapTargetRects, type DragOverlay } from './move-gesture'
import type { GizmoGeometry } from './overlay'

export type TransformKind = 'resize' | 'rotate'

/** What was grabbed: a handle to resize by, or the corner zone to rotate from. */
export type TransformGrab =
  { kind: 'resize'; handle: HandleId } | { kind: 'rotate'; corner: CornerId }

export interface TransformModifiers {
  /** Shift: keep proportions (resize), 15° steps (rotate). */
  shift: boolean
  /** Alt: scale about the anchor point / a center, turn a single node about its box center. */
  alt: boolean
}

/** Live readout next to the pointer. */
export type TransformReadout =
  | {
      kind: 'resize'
      /** Size of the box on the artboard (composition pixels). */
      width: number
      height: number
      /** Scale (%), x and y: the node's own, or how much a selection grew. */
      scale: [number, number]
    }
  | {
      kind: 'rotate'
      /** The node's rotation, or how much a selection turned (degrees). */
      angle: number
    }

interface RotationState {
  pivot: RotatePivot
  /** Angle of the pointer when the rotation (or its current pivot) started. */
  start: number
  /** Unwrapped rotation so far (degrees). */
  delta: number
}

interface Gesture {
  grab: TransformGrab
  /** The document the gesture started from (the preview is derived from it). */
  base: Animation
  /** The nodes edited; several: they scale and turn together about their bounds. */
  members: GroupMember[]
  /** The gizmo's box when the gesture started (one node: its own; several: their bounds). */
  frame: GizmoFrame
  /** Pointer at the press, in document coordinates. */
  start: Point
  lines: SnapLines
  /** Each member's edit so far (null before the first step). */
  edits: TransformEdit[] | null
  /** The gizmo box's matrix after the edit. */
  world: Mat2D
  guides: SnapResult['guides']
  rotation: RotationState | null
  /** The pivot on the artboard (for its marker), once known. */
  pivot: Point | null
  /** Rotation of a selection (degrees), as shown by the readout. */
  turned: number
  alt: boolean
}

const NO_GUIDES: SnapResult['guides'] = { x: null, y: null }

function valuesKey(edits: readonly TransformEdit[] | null): string {
  return JSON.stringify(edits?.map((e) => e.values) ?? null)
}

function isEmpty(values: TransformValues): boolean {
  return !values.scale && values.rotation === undefined && !values.position
}

/** Kind of nodes for history labels. */
function kindOf(paths: readonly NodePath[]): MovedKind {
  const layers = paths.filter(isLayerPath).length
  return layers === paths.length ? 'layer' : layers === 0 ? 'group' : 'mixed'
}

/** History label: "Resize layer", "Rotate 3 layers"… */
function historyLabel(grab: TransformGrab, paths: readonly NodePath[]): string {
  const t = getT().viewport
  const kind = kindOf(paths)
  return grab.kind === 'resize'
    ? t.historyResize(paths.length, kind)
    : t.historyRotate(paths.length, kind)
}

export class TransformGesture {
  private gesture: Gesture | null = null

  get active(): boolean {
    return this.gesture !== null
  }

  /** The document the gesture started from; the gesture is void once the document changes. */
  get base(): Animation | null {
    return this.gesture?.base ?? null
  }

  get grab(): TransformGrab | null {
    return this.gesture?.grab ?? null
  }

  /** The gizmo as the gesture draws it (its box first, then each node of a selection). */
  get overlay(): DragOverlay | null {
    const g = this.gesture
    if (!g) return null
    const outlines = [{ quad: transformRect(g.frame.box, g.world), handles: true }]
    const anchors: Point[] = []
    if (g.members.length === 1) {
      const { target } = g.members[0]
      if (isLayerPath(target.path))
        anchors.push(applyToPoint(g.world, target.anchor.x, target.anchor.y))
    } else {
      g.members.forEach((m, i) => {
        const world = g.edits?.[i]?.world ?? m.frame.world
        outlines.push({ quad: transformRect(m.frame.box, world), handles: false })
      })
    }
    // What the selection scales or turns about, when no handle or anchor marker shows it.
    if (g.pivot && this.showsPivot(g)) anchors.push(g.pivot)
    return { geometry: { outlines, anchors }, offset: { x: 0, y: 0 }, guides: g.guides }
  }

  private showsPivot(g: Gesture): boolean {
    const single = g.members.length === 1
    const layer = single && isLayerPath(g.members[0].target.path)
    if (g.grab.kind === 'rotate') return !layer || g.alt
    return g.alt && !layer
  }

  get readout(): TransformReadout | null {
    const g = this.gesture
    if (!g) return null
    const single = g.members.length === 1
    if (g.grab.kind === 'rotate') {
      const angle = single ? (g.edits?.[0]?.rotation ?? g.members[0].target.rotation) : g.turned
      return { kind: 'rotate', angle }
    }
    const m = linear(g.world)
    const { box } = g.frame
    const width = Math.hypot(m[0], m[1]) * box.width
    const height = Math.hypot(m[2], m[3]) * box.height
    if (single) {
      const scale = g.edits?.[0]?.scale ?? g.members[0].target.scale
      return { kind: 'resize', width, height, scale: [scale[0], scale[1]] }
    }
    return { kind: 'resize', width, height, scale: [m[0] * 100, m[3] * 100] }
  }

  /**
   * Starts a gesture on the gizmo drawn for `gizmo` from the document point `start`. `svg` (the
   * player's) measures what resized edges snap to. False when nothing can be edited.
   */
  begin(
    grab: TransformGrab,
    gizmo: GizmoGeometry,
    start: Point,
    svg: SVGSVGElement | null,
  ): boolean {
    const doc = useDocument.getState().doc
    if (!doc || gizmo.nodes.length === 0) return false
    // Keys are written at the playhead: it must not run away during the drag.
    pause()
    const frame = usePlayback.getState().frame
    const members: GroupMember[] = []
    for (const node of gizmo.nodes) {
      const target = planTransform(doc, node.path, frame, node.chain)
      if (!target) return false
      members.push({ target, frame: { box: node.box, world: node.matrix } })
    }
    const paths = gizmo.nodes.map((n) => n.path)
    const lines = mergeLines(
      artboardLines(doc.w, doc.h),
      rectLines(svg && grab.kind === 'resize' ? snapTargetRects(doc, paths, svg) : []),
    )
    this.gesture = {
      grab,
      base: doc,
      members,
      frame: { box: gizmo.box, world: gizmo.matrix },
      start,
      lines,
      edits: null,
      world: gizmo.matrix,
      guides: NO_GUIDES,
      rotation: null,
      pivot: null,
      turned: 0,
      alt: false,
    }
    return true
  }

  /**
   * Follows the pointer at the document point `point`. `snapThreshold`: snapping distance in
   * document units (null: no snapping); `minSize`: shortest side (document units). Returns the
   * document to preview, or null when nothing changed.
   */
  update(
    point: Point,
    mods: TransformModifiers,
    snapThreshold: number | null,
    minSize: number,
  ): Animation | null {
    const g = this.gesture
    if (!g) return null
    g.alt = mods.alt
    const before = valuesKey(g.edits)
    if (g.members.length === 1) this.updateSingle(g, point, mods, snapThreshold, minSize)
    else this.updateGroup(g, point, mods, snapThreshold, minSize)
    if (valuesKey(g.edits) === before) return null
    const { members } = g
    const edits = g.edits ?? []
    return produce(g.base, (d) => {
      members.forEach((m, i) => {
        const values = edits[i]?.values
        if (values) applyTransform(d as Animation, m.target, values)
      })
    })
  }

  private updateSingle(
    g: Gesture,
    point: Point,
    mods: TransformModifiers,
    snapThreshold: number | null,
    minSize: number,
  ): void {
    const { target, frame } = g.members[0]
    let edit: TransformEdit
    if (g.grab.kind === 'resize') {
      const result = resizeNode(
        target,
        frame,
        g.grab.handle,
        { x: point.x - g.start.x, y: point.y - g.start.y },
        {
          pivot: mods.alt ? 'anchor' : 'opposite',
          uniform: mods.shift,
          minSize,
          snap: snapThreshold !== null ? { lines: g.lines, threshold: snapThreshold } : null,
        },
      )
      g.guides = result.guides
      edit = result
    } else {
      const wanted: RotatePivot = mods.alt ? 'center' : 'anchor'
      const angleAround = (pivot: RotatePivot, p: Point) =>
        rotationAngle(target, frame, rotatePivot(target, frame, pivot), p)
      g.rotation = this.trackRotation(g.rotation, wanted, angleAround, g.start, point)
      edit = rotateNode(target, frame, g.rotation.pivot, g.rotation.delta, mods.shift)
    }
    g.edits = [edit]
    g.world = edit.world
    g.pivot = applyToPoint(edit.world, edit.pivot.x, edit.pivot.y)
  }

  private updateGroup(
    g: Gesture,
    point: Point,
    mods: TransformModifiers,
    snapThreshold: number | null,
    minSize: number,
  ): void {
    const { box } = g.frame
    if (g.grab.kind === 'resize') {
      const result = groupResize(
        g.members,
        box,
        g.grab.handle,
        { x: point.x - g.start.x, y: point.y - g.start.y },
        {
          pivot: mods.alt ? 'center' : 'opposite',
          uniform: mods.shift,
          minSize,
          snap: snapThreshold !== null ? { lines: g.lines, threshold: snapThreshold } : null,
        },
      )
      g.edits = result.edits
      g.world = result.world
      g.guides = result.guides
      g.pivot = result.pivot
      return
    }
    // A selection turns about its center; the angle is measured on the artboard.
    g.rotation = this.trackRotation(
      g.rotation,
      'center',
      (_, p) => groupRotationAngle(box, p),
      g.start,
      point,
    )
    const result = groupRotate(g.members, box, g.rotation.delta, mods.shift)
    g.edits = result.edits
    g.world = result.world
    g.pivot = result.pivot
    g.turned = result.angle
  }

  /**
   * The rotation so far: the pointer's angle around the pivot from where the corner zone was
   * pressed, unwrapped so full turns add up. When the pivot changes (Alt) the turn so far is
   * kept and measured around the new pivot from here.
   */
  private trackRotation(
    state: RotationState | null,
    wanted: RotatePivot,
    angleAround: (pivot: RotatePivot, p: Point) => number | null,
    start: Point,
    point: Point,
  ): RotationState {
    let next = state
    if (!next) {
      const from = angleAround(wanted, start) ?? angleAround(wanted, point) ?? 0
      next = { pivot: wanted, start: from, delta: 0 }
    } else if (next.pivot !== wanted) {
      const now = angleAround(wanted, point)
      if (now !== null) next = { pivot: wanted, start: now - next.delta, delta: next.delta }
    }
    const angle = angleAround(next.pivot, point)
    if (angle !== null) next.delta = unwrapAngle(next.delta, angle - next.start)
    return next
  }

  /** Ends the gesture and writes the result to the document (one undo step). */
  finish(): void {
    const g = this.gesture
    this.gesture = null
    const edits = g?.edits
    if (!g || !edits || edits.every((e) => isEmpty(e.values))) return
    // The document changed during the gesture (it should not): the plan no longer applies.
    if (useDocument.getState().doc !== g.base) return
    const { members, base } = g
    // Scale, rotation or position keys may be added at the playhead: selected keyframes keep
    // pointing at the same keys.
    const selection = (next: Animation): Selection => {
      const sel = useDocument.getState().selection
      return { ...sel, keyframes: followKeyRefs(base, next, sel.keyframes) }
    }
    updateDoc(
      historyLabel(
        g.grab,
        members.map((m) => m.target.path),
      ),
      (d) => {
        members.forEach((m, i) => applyTransform(d as Animation, m.target, edits[i].values))
      },
      { selection },
    )
  }

  /** Ends the gesture without changing the document (Esc). */
  cancel(): void {
    this.gesture = null
  }
}
