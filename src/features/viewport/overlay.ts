/**
 * Selection overlay: outlines of hovered / selected / highlighted nodes drawn in an SVG layer
 * above the player, plus anchor markers for nodes without a rendered box (null layers,
 * hidden layers, track matte sources, the canvas renderer).
 *
 * Bounds come from the rendered SVG (getBBox through the element's CTM relative to the root
 * <svg>, so ancestor CSS transforms cancel out) and are mapped to view pixels with the
 * artboard layout. Elements are pooled and reused between frames: drawing runs every frame
 * while the animation plays.
 */
import { chainKey, instanceChainFor } from '@/features/layers/instances'
import {
  getAt,
  isLayerPath,
  isShapePath,
  pathKey,
  shapeParentPath,
  type NodePath,
} from '@/lottie/path'
import { layerContentBounds, shapeItemsBounds } from '@/lottie/bounds'
import { isMatteSource } from '@/lottie/layers'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'
import { isPrecompLayer } from '@/lottie/types'
import { nodeClassName, nodePathsFromElement } from '@/player/prepare'
import { docToLayout, type ArtboardLayout } from './lib/camera'
import {
  boundsOfPoints,
  isAxisAlignedQuad,
  quadToPoints,
  snapQuad,
  transformRect,
  type Quad,
  type Rect,
} from './lib/geometry'
import { GIZMO, gizmoHandleIds, handlePoint } from './lib/gizmo'
import {
  IDENTITY,
  applyToPoint,
  fromDomMatrix,
  invert,
  multiply,
  type Mat2D,
  type Point,
} from './lib/matrix'
import { hasMovingAncestor, moveOwner, transformPathOf } from './lib/move'
import type { SnapGuide } from './lib/snap'
import { anchorPoints, nodePlacements, precompFrameSize } from './lib/transforms'
import { isLockedOnCanvas } from './locks'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Outlines drawn per category at most (selecting 1000 layers must not stall playback). */
const MAX_NODES = 300

/* -------------------------------------------------------------------------- */
/*                                 Measuring                                  */
/* -------------------------------------------------------------------------- */

/**
 * The node whose rendered box stands for `path`: shape items other than groups (paths, fills,
 * modifiers) have no element of their own and are shown through their group or layer.
 */
export function measurablePath(doc: Animation, path: NodePath): NodePath {
  if (!isShapePath(path)) return path
  const item = getAt<ShapeItem>(doc, path)
  return item?.ty === 'gr' ? path : shapeParentPath(path)
}

/** A rendered occurrence of a node: its quad and the precomp instances it is drawn through. */
export interface NodeInstance {
  quad: Quad
  /** Chain key of the precomp layers above it (see @/features/layers/instances). */
  chain: string
  /** The node's content box (its own coordinates) … */
  box: Rect
  /** … and its content → document matrix as rendered: `quad` is the box through it. */
  matrix: Mat2D
}

/** Precomp layers containing a rendered element, outermost first, as a chain key. */
function elementChain(doc: Animation, el: Element, svg: SVGSVGElement): string {
  const seen = new Set<string>()
  const chain: NodePath[] = []
  // Innermost first; the element's own tags are the node itself, not an instance above it.
  for (const p of nodePathsFromElement(el.parentElement, svg)) {
    const key = pathKey(p)
    if (seen.has(key) || !isLayerPath(p)) continue
    seen.add(key)
    const layer = getAt<Layer>(doc, p)
    if (layer && isPrecompLayer(layer)) chain.unshift(p)
  }
  return chainKey(chain)
}

/**
 * Every rendered instance of a node in the player's SVG (document coordinates), with the
 * precomp instance chain it is drawn through. Precomp layers measure as their comp frame
 * (0, 0, w, h), like After Effects draws them. Empty when the node has no rendered box (null,
 * hidden, out of range, matte source).
 */
export function measureNodeInstances(
  doc: Animation,
  nodePath: NodePath,
  svg: SVGSVGElement,
): NodeInstance[] {
  const path = measurablePath(doc, nodePath)
  const elements = svg.getElementsByClassName(nodeClassName(path))
  if (elements.length === 0) return []
  const layer = isLayerPath(path) ? getAt<Layer>(doc, path) : undefined
  if (layer && isMatteSource(layer)) return []
  const rootCtm = svg.getScreenCTM()
  const rootInverse = rootCtm ? invert(fromDomMatrix(rootCtm)) : null
  if (!rootInverse) return []
  const frameSize = layer && isPrecompLayer(layer) ? precompFrameSize(doc, layer) : null
  // Only content of a composition used several times has instances worth telling apart.
  const shared = elements.length > 1 && path[0] === 'assets'

  const out: NodeInstance[] = []
  for (const el of Array.from(elements)) {
    if (!(el instanceof SVGGraphicsElement) || el.closest('defs')) continue
    // Hidden elements keep the geometry and transform they were last drawn with (getBBox still
    // measures them): they are not on screen.
    if (isHiddenInSvg(el, svg)) continue
    let rect: Rect
    if (frameSize) {
      // A precomp shows its frame whenever it is on screen, even while its content is empty.
      rect = { x: 0, y: 0, ...frameSize }
    } else {
      let box: DOMRect
      try {
        box = el.getBBox()
      } catch {
        continue
      }
      // Never-drawn elements report an empty box.
      if (!(box.width > 0 || box.height > 0)) continue
      rect = { x: box.x, y: box.y, width: box.width, height: box.height }
    }
    const ctm = el.getScreenCTM()
    if (!ctm) continue
    // The tagged element carries the node's transform: its user space is the node's content.
    const matrix = multiply(rootInverse, fromDomMatrix(ctm))
    const quad = transformRect(rect, matrix)
    if (quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
      out.push({ quad, chain: shared ? elementChain(doc, el, svg) : '', box: rect, matrix })
  }
  return out
}

/** Quads (document coordinates) of every rendered instance of a node (see measureNodeInstances). */
export function measureNode(doc: Animation, nodePath: NodePath, svg: SVGSVGElement): Quad[] {
  return measureNodeInstances(doc, nodePath, svg).map((i) => i.quad)
}

/**
 * True when lottie hides the element: it sets `display: none` on out-of-range and fully
 * transparent layers (or on their wrapper), and a hidden precomp hides everything inside it.
 * Checked up to `root` (the player's <svg>, or an element already known to be shown).
 */
function isHiddenInSvg(el: Element, root: Element): boolean {
  for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
    if ((node as SVGElement).style?.display === 'none') return true
  }
  return false
}

const LEAF_SELECTOR = 'path, rect, circle, ellipse, polygon, polyline, line, image, text, use'

/**
 * Quads (document coordinates) of the rendered shapes inside a node: its paths, images and
 * text, not the union box. Used where empty space matters (marquee hits): a precomp's comp
 * frame or a group's union box can be mostly transparent.
 */
export function measureNodeShapes(path: NodePath, svg: SVGSVGElement): Quad[] {
  const elements = svg.getElementsByClassName(nodeClassName(path))
  if (elements.length === 0) return []
  const rootCtm = svg.getScreenCTM()
  const rootInverse = rootCtm ? invert(fromDomMatrix(rootCtm)) : null
  if (!rootInverse) return []
  const quads: Quad[] = []
  for (const el of Array.from(elements)) {
    if (el.closest('defs')) continue
    // Hidden layers keep their last drawn geometry: they are not on screen.
    if (isHiddenInSvg(el, svg)) continue
    for (const leaf of Array.from(el.querySelectorAll(LEAF_SELECTOR))) {
      if (!(leaf instanceof SVGGraphicsElement) || leaf.closest('defs, clipPath, mask')) continue
      if (isHiddenInSvg(leaf, el)) continue
      let box: DOMRect
      try {
        box = leaf.getBBox()
      } catch {
        continue
      }
      if (!(box.width > 0 || box.height > 0)) continue
      const ctm = leaf.getScreenCTM()
      if (!ctm) continue
      quads.push(
        transformRect(
          { x: box.x, y: box.y, width: box.width, height: box.height },
          multiply(rootInverse, fromDomMatrix(ctm)),
        ),
      )
    }
  }
  return quads
}

/**
 * Document-space bounds of nodes: rendered boxes, or anchor points when nothing is rendered.
 * Shared precomp content counts through the instance the user works in, when it is on screen.
 */
export function measureNodesBounds(
  doc: Animation,
  paths: readonly NodePath[],
  frame: number,
  svg: SVGSVGElement | null,
): Rect | null {
  const points: Point[] = []
  const hiddenAnchors: Point[] = []
  for (const path of paths.slice(0, MAX_NODES)) {
    const working = instanceChainFor(doc, path)
    const key = working ? chainKey(working) : null
    const instances = svg ? measureNodeInstances(doc, path, svg) : []
    const own = key === null ? [] : instances.filter((i) => i.chain === key)
    if (instances.length) {
      for (const i of own.length ? own : instances) points.push(...i.quad)
      continue
    }
    const anchors = anchorPoints(doc, measurablePath(doc, path), frame)
    const ownAnchors = key === null ? [] : anchors.filter((a) => chainKey(a.chain) === key)
    for (const a of ownAnchors.length ? ownAnchors : anchors)
      (a.inRange ? points : hiddenAnchors).push(a)
  }
  // Nothing is on screen at this frame: still center on where the nodes are.
  return boundsOfPoints(points.length ? points : hiddenAnchors)
}

/* -------------------------------------------------------------------------- */
/*                                   Drawing                                  */
/* -------------------------------------------------------------------------- */

type Tag = 'polygon' | 'rect' | 'path'

/** Reuses SVG elements between frames (no DOM churn while playing). */
class Pool<K extends Tag> {
  private readonly items: SVGElementTagNameMap[K][] = []
  private readonly parent: SVGGElement
  private readonly tag: K
  private readonly className: string
  private used = 0

  constructor(parent: SVGGElement, tag: K, className: string) {
    this.parent = parent
    this.tag = tag
    this.className = className
  }

  begin(): void {
    this.used = 0
  }

  next(): SVGElementTagNameMap[K] {
    let el = this.items[this.used]
    if (!el) {
      el = document.createElementNS(SVG_NS, this.tag) as SVGElementTagNameMap[K]
      el.setAttribute('class', this.className)
      this.parent.appendChild(el)
      this.items.push(el)
    }
    this.used++
    return el
  }

  end(): void {
    while (this.items.length > this.used) this.items.pop()?.remove()
  }
}

/** A node the gizmo edits, as drawn: its content box and content → document matrix. */
export interface GizmoNode {
  /** The layer or group the handles scale and rotate (a selected node's move owner). */
  path: NodePath
  /** Precomp instance it is drawn in (chain key; '' for root content or a single instance). */
  chain: string
  /** Content box in the node's own coordinates (empty, at its anchor, when it draws nothing). */
  box: Rect
  matrix: Mat2D
}

/**
 * The transform gizmo: the box its handles are on (document coordinates through `matrix`) and
 * the nodes they edit. One node: its own content box and matrix. Several: their bounds on the
 * artboard, with the identity matrix.
 */
export interface GizmoGeometry {
  box: Rect
  matrix: Mat2D
  nodes: GizmoNode[]
}

/** Outlines and pivots of nodes in document coordinates, as the overlay draws a selection. */
export interface NodeGeometry {
  /**
   * Outline quads; `handles` draws the gizmo's handles on it (the single selected node, in the
   * precomp instance the user works in, or the bounds of several); `linked` marks the other
   * instances of shared precomp content (same content, drawn fainter).
   */
  outlines: { quad: Quad; handles: boolean; linked?: boolean }[]
  /** Anchor point markers. */
  anchors: Point[]
  /** The transform gizmo, when the selection has one. */
  gizmo?: GizmoGeometry | null
  /**
   * Selected content of compositions used several times: the precomp instance each node is
   * shown (with handles) and edited in, as its chain of precomp layers, outermost first.
   */
  shown?: { path: NodePath; chain: readonly NodePath[] }[]
}

/**
 * The node the gizmo of a selected node edits: its move owner (the group containing a path or
 * fill, else the layer), when it has a transform and is not locked. Null otherwise.
 */
export function gizmoOwner(doc: Animation, path: NodePath): NodePath | null {
  const owner = moveOwner(doc, path)
  if (!owner || isLockedOnCanvas(owner) || !transformPathOf(doc, owner)) return null
  return owner
}

/**
 * A box the gizmo can work on: some extent (a straight line has no height or width but still
 * has a length to resize), and a content → document matrix that inverts.
 */
export function isUsableGizmo(box: Rect, matrix: Mat2D): boolean {
  const extent = box.width >= 0 && box.height >= 0 && (box.width > 0 || box.height > 0)
  return extent && invert(matrix) !== null
}

/** What a layer or group draws at `frame`, in its own coordinates, from the document. */
function documentBox(doc: Animation, owner: NodePath, frame: number): Rect | null {
  let box: { x: number; y: number; w: number; h: number } | null = null
  if (isLayerPath(owner)) {
    const layer = getAt<Layer>(doc, owner)
    if (!layer) return null
    // Precomps show their comp frame, as when they are measured on screen.
    const size = isPrecompLayer(layer) ? precompFrameSize(doc, layer) : null
    if (size) return { x: 0, y: 0, ...size }
    box = layerContentBounds(doc, owner, frame)
  } else {
    const group = getAt<ShapeItem>(doc, owner)
    box = group?.ty === 'gr' ? shapeItemsBounds(group.it, frame) : null
  }
  return box && { x: box.x, y: box.y, width: box.w, height: box.h }
}

/**
 * Where the document places a node at `frame`, in the precomp instance the user works in (or
 * the first one), when it is within its time range and its matrix inverts.
 */
function documentPlacement(doc: Animation, owner: NodePath, frame: number) {
  const placements = nodePlacements(doc, owner, frame).filter(
    (p) => p.inRange && invert(p.matrix) !== null,
  )
  const working = instanceChainFor(doc, owner)
  const key = working ? chainKey(working) : null
  return placements.find((p) => chainKey(p.chain) === key) ?? placements[0] ?? null
}

/**
 * A node the player has no box for (the Canvas renderer, a transparent or hidden layer): its
 * bounds and matrix computed from the document. Null outside its time range or when it draws
 * nothing.
 */
function documentNode(
  doc: Animation,
  owner: NodePath,
  frame: number,
): { node: GizmoNode; chain: readonly NodePath[] } | null {
  const placement = documentPlacement(doc, owner, frame)
  const box = placement ? documentBox(doc, owner, placement.frame) : null
  if (!placement || !box || !isUsableGizmo(box, placement.matrix)) return null
  const node = { path: owner, chain: chainKey(placement.chain), box, matrix: placement.matrix }
  return { node, chain: placement.chain }
}

/** A node that draws nothing (a null layer) as its anchor point: it still turns and scales along. */
function anchorNode(doc: Animation, owner: NodePath, frame: number): GizmoNode | null {
  const placement = documentPlacement(doc, owner, frame)
  if (!placement) return null
  const anchor = anchorPoints(doc, owner, frame).find(
    (a) => chainKey(a.chain) === chainKey(placement.chain),
  )
  if (!anchor) return null
  const inverse = invert(placement.matrix)
  const local = inverse ? applyToPoint(inverse, anchor.x, anchor.y) : null
  if (!local) return null
  const box = { x: local.x, y: local.y, width: 0, height: 0 }
  return { path: owner, chain: chainKey(placement.chain), box, matrix: placement.matrix }
}

interface GizmoEntry {
  owner: NodePath | null
  node: GizmoNode | null
  /** Drawn several times with none of them the instance the user works in. */
  ambiguous: boolean
}

/**
 * The gizmo of several selected nodes: their bounds, when every one of them can be edited.
 * Nodes carried along by another selected one (children, content of a selected group or layer)
 * are left to it.
 */
function groupGizmo(
  doc: Animation,
  entries: readonly GizmoEntry[],
  frame: number,
): GizmoGeometry | null {
  if (entries.some((e) => !e.owner || e.ambiguous)) return null
  const moving = new Set(entries.map((e) => pathKey(e.owner as NodePath)))
  const seen = new Set<string>()
  const nodes: GizmoNode[] = []
  for (const { owner, node } of entries) {
    if (!owner) return null
    const key = pathKey(owner)
    if (seen.has(key) || hasMovingAncestor(doc, owner, moving)) continue
    seen.add(key)
    const member = node ?? anchorNode(doc, owner, frame)
    if (!member) return null
    nodes.push(member)
  }
  if (nodes.length < 2) return null
  const box = boundsOfPoints(nodes.flatMap((n) => transformRect(n.box, n.matrix)))
  if (!box || !isUsableGizmo(box, IDENTITY)) return null
  return { box, matrix: IDENTITY, nodes }
}

/**
 * Geometry of a selection: rendered outlines, anchors for nodes without a box, the pivot of a
 * single selected layer, and the transform gizmo: on a single layer or group, or around several.
 * Shared content drawn several times gets it in the precomp instance the user works in, or the
 * first one drawn while that one is off screen (see shownInstance).
 */
export function selectionGeometry(
  doc: Animation,
  selection: readonly NodePath[],
  frame: number,
  svg: SVGSVGElement | null,
): NodeGeometry {
  const outlines: NodeGeometry['outlines'] = []
  const anchors: Point[] = []
  const shown: NonNullable<NodeGeometry['shown']> = []
  const single = selection.length === 1
  const entries: GizmoEntry[] = []
  for (const path of selection.slice(0, MAX_NODES)) {
    const instances = svg ? measureNodeInstances(doc, path, svg) : []
    const several = instances.length > 1
    // Content of a composition used several times is shown and edited in one of its instances.
    const shared = instances.some((i) => i.chain !== '')
    const showing = shared ? shownInstance(doc, path, frame, instances) : null
    if (showing) shown.push({ path, chain: showing })
    const workingKey = showing ? chainKey(showing) : null
    const focus = several && workingKey !== null
    const owner = gizmoOwner(doc, path)
    let node: GizmoNode | null = null
    let mainOutline = -1
    for (const { quad, chain, box, matrix } of instances) {
      const main = !several || (focus && chain === workingKey)
      if (main && owner && isUsableGizmo(box, matrix)) {
        node = { path: owner, chain, box, matrix }
        mainOutline = outlines.length
      }
      outlines.push({ quad, handles: false, linked: focus && !main })
    }
    if (owner && !instances.length) {
      // Nothing measured on screen: the box as the document describes it can still be edited.
      const found = documentNode(doc, owner, frame)
      node = found?.node ?? null
      if (found) {
        mainOutline = outlines.length
        outlines.push({ quad: transformRect(found.node.box, found.node.matrix), handles: false })
        if (found.chain.length) shown.push({ path, chain: found.chain })
      }
    }
    if (single && node) outlines[mainOutline].handles = true
    entries.push({ owner, node, ambiguous: several && !focus })
    if (!instances.length || (single && isLayerPath(path) && (!several || focus))) {
      // Items without a transform of their own (fills, paths) show their group's pivot; shared
      // content shows the pivot of the instance it is shown in.
      const points = anchorPoints(doc, measurablePath(doc, path), frame).filter((a) => a.inRange)
      const own = workingKey === null ? [] : points.filter((a) => chainKey(a.chain) === workingKey)
      for (const a of own.length ? own : points) anchors.push({ x: a.x, y: a.y })
    }
  }
  let gizmo: GizmoGeometry | null = null
  const first = entries[0]?.node
  if (single && first) gizmo = { box: first.box, matrix: first.matrix, nodes: [first] }
  else if (selection.length > 1 && selection.length <= MAX_NODES) {
    gizmo = groupGizmo(doc, entries, frame)
    // The selection's bounds carry the handles.
    if (gizmo) outlines.push({ quad: transformRect(gizmo.box, IDENTITY), handles: true })
  }
  return { outlines, anchors, gizmo, shown }
}

/**
 * The occurrence of shared content (drawn several times) that a selection shows with handles
 * and edits: the precomp instance the user works in when it is drawn, otherwise the first one
 * drawn, in document order (the order edits fall back to, see planMove and planTransform).
 */
export function shownInstance(
  doc: Animation,
  path: NodePath,
  frame: number,
  instances: readonly NodeInstance[],
): readonly NodePath[] | null {
  const drawn = new Set(instances.map((i) => i.chain))
  const working = instanceChainFor(doc, path)
  if (working && drawn.has(chainKey(working))) return working
  return nodePlacements(doc, path, frame).find((p) => drawn.has(chainKey(p.chain)))?.chain ?? null
}

export interface OverlayModel {
  doc: Animation
  /** Root composition frame. */
  frame: number
  layout: ArtboardLayout
  /** The player's <svg> (null with the canvas renderer: anchors only). */
  svg: SVGSVGElement | null
  selection: readonly NodePath[]
  hover: NodePath | null
  highlight: readonly NodePath[]
  /** Marquee being dragged (view coordinates) and the nodes it would select. */
  marquee?: { rect: Rect; hits: readonly NodePath[] } | null
  /**
   * Layers being moved, scaled or rotated: the selection as the gesture draws it (document
   * coordinates, `offset` added). Follows the pointer while the preview catches up.
   */
  drag?: {
    geometry: NodeGeometry
    offset: Point
    guides?: { x: SnapGuide | null; y: SnapGuide | null }
  } | null
}

/** The gizmo as last drawn, in view pixels (what the pointer can grab). */
export interface GizmoView extends GizmoGeometry {
  /** The content box on screen: its top-left, top-right, bottom-right, bottom-left corners. */
  quad: Quad
}

export class Overlay {
  private readonly highlight: Pool<'polygon'>
  private readonly hover: Pool<'polygon'>
  private readonly outline: Pool<'polygon'>
  private readonly linked: Pool<'polygon'>
  private readonly handles: Pool<'rect'>
  private readonly anchorHalo: Pool<'path'>
  private readonly anchor: Pool<'path'>
  private readonly marquee: Pool<'rect'>
  private readonly guides: Pool<'path'>
  private readonly groups: SVGGElement[] = []
  private dpr = 1
  private gizmoView: GizmoView | null = null
  private selectionView: Quad[] = []
  private shownView: NonNullable<NodeGeometry['shown']> = []

  constructor(svg: SVGSVGElement) {
    // One <g> per category keeps the stacking order fixed (highlights under outlines under handles).
    const group = (parent: SVGSVGElement): SVGGElement => {
      const g = document.createElementNS(SVG_NS, 'g')
      parent.appendChild(g)
      this.groups.push(g)
      return g
    }
    const outline = 'fill-none stroke-accent [stroke-width:1px]'
    this.highlight = new Pool(group(svg), 'polygon', `${outline} [stroke-dasharray:4_3]`)
    this.hover = new Pool(group(svg), 'polygon', outline)
    this.outline = new Pool(group(svg), 'polygon', outline)
    // Other instances of shared precomp content: the same content, not the one being edited.
    this.linked = new Pool(group(svg), 'polygon', 'fill-none stroke-accent/45 [stroke-width:1px]')
    this.anchorHalo = new Pool(
      group(svg),
      'path',
      'fill-none stroke-white/85 [stroke-width:3px] [stroke-linecap:round]',
    )
    this.anchor = new Pool(group(svg), 'path', 'fill-none stroke-accent [stroke-width:1px]')
    this.guides = new Pool(group(svg), 'path', 'fill-none stroke-accent [stroke-width:1px]')
    // Handles are what the pointer grabs: above the pivot marker and snapping guides.
    this.handles = new Pool(group(svg), 'rect', 'fill-white stroke-accent [stroke-width:1px]')
    this.marquee = new Pool(group(svg), 'rect', 'fill-accent/8 stroke-accent [stroke-width:1px]')
  }

  private pools() {
    return [
      this.highlight,
      this.hover,
      this.outline,
      this.linked,
      this.handles,
      this.anchorHalo,
      this.anchor,
      this.marquee,
      this.guides,
    ]
  }

  clear(): void {
    for (const p of this.pools()) {
      p.begin()
      p.end()
    }
    this.gizmoView = null
    this.selectionView = []
    this.shownView = []
  }

  /** The gizmo drawn by the last `draw` (null while dragging or without a gizmo). */
  get gizmo(): GizmoView | null {
    return this.gizmoView
  }

  /** Outlines of the selection drawn by the last `draw` (view pixels, main instances only). */
  get selectionQuads(): readonly Quad[] {
    return this.selectionView
  }

  /**
   * Precomp instances the selected shared content was shown in by the last `draw` (see
   * NodeGeometry.shown): what gestures on the selection edit.
   */
  get shownInstances(): NonNullable<NodeGeometry['shown']> {
    return this.shownView
  }

  /** Removes the overlay's elements (the pane is going away; the <svg> may be reused). */
  destroy(): void {
    for (const g of this.groups.splice(0)) g.remove()
  }

  draw(model: OverlayModel): void {
    this.dpr = window.devicePixelRatio || 1
    for (const p of this.pools()) p.begin()

    const selectedKeys = new Set(model.selection.map(pathKey))
    const toView = (q: Quad): Quad => q.map((p) => docToLayout(model.layout, p)) as unknown as Quad

    // Highlights (e.g. layers using a hovered color) under everything else.
    for (const path of model.highlight.slice(0, MAX_NODES)) {
      if (selectedKeys.has(pathKey(path))) continue
      for (const q of this.quads(model, path)) this.polygon(this.highlight, toView(q))
    }

    // Nodes the marquee would select look hovered while dragging.
    if (model.marquee) {
      for (const path of model.marquee.hits.slice(0, MAX_NODES)) {
        for (const q of this.quads(model, path)) this.polygon(this.hover, toView(q))
      }
    }

    if (model.hover && !model.marquee && !model.drag && !selectedKeys.has(pathKey(model.hover))) {
      const quads = this.quads(model, model.hover)
      for (const q of quads) this.polygon(this.hover, toView(q))
      if (!quads.length) this.anchors(model, model.hover)
    }

    const drag = model.drag
    const selection = drag
      ? offsetGeometry(drag.geometry, drag.offset)
      : selectionGeometry(model.doc, model.selection, model.frame, model.svg)
    this.gizmoView = null
    this.selectionView = []
    this.shownView = selection.shown ?? []
    for (const { quad, handles, linked } of selection.outlines) {
      const view = toView(quad)
      this.polygon(linked ? this.linked : this.outline, view)
      if (!linked) this.selectionView.push(view)
      if (handles) this.gizmoHandles(view)
    }
    const gizmo = selection.gizmo
    if (gizmo && !drag) {
      this.gizmoView = { ...gizmo, quad: toView(transformRect(gizmo.box, gizmo.matrix)) }
    }
    for (const a of selection.anchors) this.anchorMarker(docToLayout(model.layout, a))
    if (drag?.guides) this.snapGuides(model, drag.guides)

    if (model.marquee) {
      const q = snapQuad(transformRect(model.marquee.rect, IDENTITY), this.dpr)
      const el = this.marquee.next()
      el.setAttribute('x', String(q[0].x))
      el.setAttribute('y', String(q[0].y))
      el.setAttribute('width', String(Math.max(0, q[2].x - q[0].x)))
      el.setAttribute('height', String(Math.max(0, q[2].y - q[0].y)))
    }

    for (const p of this.pools()) p.end()
  }

  private quads(model: OverlayModel, path: NodePath): Quad[] {
    return model.svg ? measureNode(model.doc, path, model.svg) : []
  }

  private polygon(pool: Pool<'polygon'>, quad: Quad): void {
    const q = isAxisAlignedQuad(quad) ? snapQuad(quad, this.dpr) : quad
    pool.next().setAttribute('points', quadToPoints(q))
  }

  /**
   * The gizmo's handles on a box (view pixels), see gizmoHandleIds. They turn with the box so a
   * rotated node looks rotated.
   */
  private gizmoHandles(view: Quad): void {
    const [o, x, , y] = view
    // The box's x axis on screen (a vertical line has none: its y axis, a quarter turn back).
    const angle =
      Math.hypot(x.x - o.x, x.y - o.y) > 1e-6
        ? (Math.atan2(x.y - o.y, x.x - o.x) * 180) / Math.PI
        : (Math.atan2(y.y - o.y, y.x - o.x) * 180) / Math.PI - 90
    // Quarter turns (and flips) keep the squares axis-aligned and crisp.
    const turned = Math.abs(angle - Math.round(angle / 90) * 90) > 0.01 ? angle : 0
    for (const id of gizmoHandleIds(view)) this.handle(handlePoint(view, id), turned)
  }

  /** Square handle, GIZMO.handle px including its 1px stroke, snapped to device pixels. */
  private handle(p: Point, angle: number): void {
    const size = GIZMO.handle - 1
    const el = this.handles.next()
    if (angle === 0) {
      // With an odd device pixel ratio a 1px stroke must sit on half pixels to stay crisp.
      const half = Math.round(this.dpr) % 2 === 1 ? 0.5 / this.dpr : 0
      const snap = (v: number) => Math.round((v - size / 2) * this.dpr) / this.dpr + half
      el.setAttribute('x', String(snap(p.x)))
      el.setAttribute('y', String(snap(p.y)))
      el.removeAttribute('transform')
    } else {
      el.setAttribute('x', String(round2(p.x - size / 2)))
      el.setAttribute('y', String(round2(p.y - size / 2)))
      el.setAttribute('transform', `rotate(${round2(angle)} ${round2(p.x)} ${round2(p.y)})`)
    }
    el.setAttribute('width', String(size))
    el.setAttribute('height', String(size))
  }

  /**
   * Snapping guides: the snapped line across the dragged selection and what it aligns with (the
   * artboard, or other objects), crisp on the device pixel grid.
   */
  private snapGuides(
    model: OverlayModel,
    guides: { x: SnapGuide | null; y: SnapGuide | null },
  ): void {
    const { layout } = model
    const half = Math.round(this.dpr) % 2 === 1 ? 0.5 / this.dpr : 0
    const snap = (v: number) => Math.round(v * this.dpr) / this.dpr + half
    if (guides.x) {
      const from = docToLayout(layout, { x: guides.x.at, y: guides.x.from })
      const to = docToLayout(layout, { x: guides.x.at, y: guides.x.to })
      this.guides.next().setAttribute('d', `M${snap(from.x)},${from.y}V${to.y}`)
    }
    if (guides.y) {
      const from = docToLayout(layout, { x: guides.y.from, y: guides.y.at })
      const to = docToLayout(layout, { x: guides.y.to, y: guides.y.at })
      this.guides.next().setAttribute('d', `M${from.x},${snap(from.y)}H${to.x}`)
    }
  }

  /** Anchor point markers of a node, for every visible instance. */
  private anchors(model: OverlayModel, nodePath: NodePath): void {
    // Items without a transform of their own (fills, paths) show their group's pivot.
    const path = measurablePath(model.doc, nodePath)
    for (const a of anchorPoints(model.doc, path, model.frame)) {
      if (a.inRange) this.anchorMarker(docToLayout(model.layout, a))
    }
  }

  /** Anchor point marker (circle + crosshair ticks) at a view point. */
  private anchorMarker(v: Point): void {
    const x = Math.round(v.x * this.dpr) / this.dpr
    const y = Math.round(v.y * this.dpr) / this.dpr
    const r = 3.5
    const t = 7.5
    const d =
      `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0` +
      `M${x - t},${y}H${x - r}M${x + r},${y}H${x + t}M${x},${y - t}V${y - r}M${x},${y + r}V${y + t}`
    this.anchorHalo.next().setAttribute('d', d)
    this.anchor.next().setAttribute('d', d)
  }
}

/** Geometry moved by a document-space offset. */
function offsetGeometry(g: NodeGeometry, offset: Point): NodeGeometry {
  const move = (p: Point): Point => ({ x: p.x + offset.x, y: p.y + offset.y })
  return {
    outlines: g.outlines.map(({ quad, handles, linked }) => ({
      quad: quad.map(move) as unknown as Quad,
      handles,
      linked,
    })),
    anchors: g.anchors.map(move),
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
