/**
 * World transforms of document nodes, computed from the document (no renderer needed).
 *
 * The viewport uses this where lottie-web has no DOM to measure: null layers, hidden layers,
 * track matte sources, the canvas renderer, and zoom-to-node fallbacks. The math mirrors
 * lottie-web 5.13 (TransformPropertyFactory, renderTransform, CompElement):
 *
 *   local = T(p) · R(autoOrient) · R(r) · R(−sa) · SkewX(−sk) · R(sa) · S(s/100) · T(−a)
 *   world = parentₙ · … · parent₁ · local          (parents evaluated at the same comp frame)
 *   root  = precompLayerWorld · world               (for each precomp instance, recursively)
 *
 * A layer inside a precomp asset exists once per precomp layer that references the asset,
 * so every function returns one `Placement` per instance.
 *
 * 3D layers (`rx` present) turn in 3D: R = Rx(or₀) · Ry(or₁) · Rz(or₂) · Rx(rx) · Ry(ry) · Rz(rz),
 * with lottie-web's axis signs, and z enters through the position, anchor and scale. The SVG and
 * Canvas renderers multiply a composition's parent chain in 3D and keep the 2D part of the
 * result (an orthographic projection), so chains with a 3D layer are composed in 3D before they
 * are flattened; precomps compose in 2D (their content is a flattened drawing).
 */
import { isLayerActiveAt, parentChain } from '@/lottie/layers'
import {
  compAssetIndexOf,
  getAt,
  isLayerPath,
  isShapePath,
  layerPathOf,
  type NodePath,
} from '@/lottie/path'
import { evaluatePosition, evaluateScalar, evaluateVector, getKeyframes } from '@/lottie/property'
import { precompInnerFrame } from '@/lottie/time'
import type {
  Animation,
  GroupShape,
  Layer,
  PositionProperty,
  PrecompLayer,
  ShapeItem,
  Transform,
} from '@/lottie/types'
import { isPrecompAsset, isSplitPosition, LayerType } from '@/lottie/types'
import {
  applyToPoint,
  IDENTITY,
  isFiniteMatrix,
  multiply,
  rotate,
  scale,
  skewX,
  translate,
  type Mat2D,
  type Point,
} from './matrix'

/** One occurrence of a node in the root composition. */
export interface Placement {
  /** Maps the node's content coordinates to root composition (artboard) coordinates. */
  matrix: Mat2D
  /** Frame of the composition that contains the node (keyframe time base of the node). */
  frame: number
  /** The node and its precomp ancestors are in range and not hidden: it is rendered. */
  visible: boolean
  /** Like `visible`, ignoring the node's own hidden flag (its anchor can still be shown). */
  inRange: boolean
  /** Precomp layers this occurrence is rendered through, outermost first (empty in the root comp). */
  chain: readonly NodePath[]
}

/** Upper bound of instances per node (deeply nested, heavily reused precomps). */
const MAX_INSTANCES = 64
/** Nesting guard against precomps that (directly or indirectly) contain themselves. */
const MAX_DEPTH = 24

const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)

/* -------------------------------------------------------------------------- */
/*                                Local matrices                              */
/* -------------------------------------------------------------------------- */

function positionAt(p: PositionProperty | undefined, frame: number): number[] {
  return p ? evaluatePosition(p, frame) : [0, 0]
}

/**
 * Keyframe times bounding a position property, or null when it is static (no auto-orient
 * tangent then, like lottie-web).
 */
function positionKeyRange(p: PositionProperty | undefined): [number, number] | null {
  if (!p) return null
  if (isSplitPosition(p)) {
    const kx = getKeyframes(p.x)
    const ky = getKeyframes(p.y)
    if (!kx || !ky) return null
    return [Math.min(kx[0].t, ky[0].t), Math.max(kx[kx.length - 1].t, ky[ky.length - 1].t)]
  }
  const kfs = getKeyframes(p)
  return kfs ? [kfs[0].t, kfs[kfs.length - 1].t] : null
}

/** Auto-orient angle in degrees: direction of travel along the motion path (lottie-web). */
export function autoOrientAngle(p: PositionProperty | undefined, frame: number): number {
  const range = positionKeyRange(p)
  if (!range) return 0
  const [first, last] = range
  let v1: number[]
  let v2: number[]
  if (frame <= first) {
    v1 = positionAt(p, first + 0.01)
    v2 = positionAt(p, first)
  } else if (frame >= last) {
    v1 = positionAt(p, last)
    v2 = positionAt(p, last - 0.05)
  } else {
    v1 = positionAt(p, frame)
    v2 = positionAt(p, frame - 0.01)
  }
  const dy = (v1[1] ?? 0) - (v2[1] ?? 0)
  const dx = (v1[0] ?? 0) - (v2[0] ?? 0)
  if (dx === 0 && dy === 0) return 0
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

/**
 * Local matrix of a transform (layer `ks`, group `tr`) at `frame` (the containing comp's time).
 * Maps content coordinates to the parent's coordinates (3D layers: flattened, see above).
 */
export function transformMatrix(
  t: Transform | undefined,
  frame: number,
  opts: { autoOrient?: boolean } = {},
): Mat2D {
  if (!t) return IDENTITY
  if (t.rx) return flatten(transformMatrix3(t, frame, opts))
  const p = positionAt(t.p, frame)
  const a = t.a ? evaluateVector(t.a, frame, [0, 0]) : [0, 0]
  const s = t.s ? evaluateVector(t.s, frame, [100, 100]) : [100, 100]
  const r = t.r ? evaluateScalar(t.r, frame) : 0
  const sk = t.sk ? evaluateScalar(t.sk, frame) : 0
  const sa = t.sa ? evaluateScalar(t.sa, frame) : 0

  let m: Mat2D = translate(IDENTITY, num(p[0] ?? 0, 0), num(p[1] ?? 0, 0))
  if (opts.autoOrient) m = rotate(m, autoOrientAngle(t.p, frame))
  m = rotate(m, num(r, 0))
  if (sk !== 0) m = rotate(skewX(rotate(m, -sa), -sk), sa)
  m = scale(m, num(s[0] ?? 100, 100) / 100, num(s[1] ?? s[0] ?? 100, 100) / 100)
  m = translate(m, -num(a[0] ?? 0, 0), -num(a[1] ?? 0, 0))
  return m
}

/** Local matrix of a layer (its `ks`, including auto-orient). */
export function layerLocalMatrix(layer: Layer, frame: number): Mat2D {
  return transformMatrix(layer.ks, frame, { autoOrient: layer.ao === 1 })
}

/**
 * Matrix of a layer inside its own composition: its local transform preceded by the parent
 * chain (parents are evaluated at the same comp frame; parenting cycles are ignored).
 */
export function layerCompMatrix(layers: readonly Layer[], layer: Layer, frame: number): Mat2D {
  const parents = parentChain(layers, layer)
  if (layer.ks?.rx || parents.some((p) => p.ks?.rx)) {
    // A 3D layer in the chain: compose in 3D, then flatten (like lottie-web).
    let m = layerLocalMatrix3(layer, frame)
    for (const parent of parents) m = multiply3(layerLocalMatrix3(parent, frame), m)
    return flatten(m)
  }
  return multiply(layerParentMatrix(layers, layer, frame), layerLocalMatrix(layer, frame))
}

/**
 * Matrix of the space a layer's transform lives in, inside its composition: the parent chain
 * (identity without a parent). A layer's position is expressed in this space.
 */
export function layerParentMatrix(layers: readonly Layer[], layer: Layer, frame: number): Mat2D {
  const parents = parentChain(layers, layer)
  if (parents.some((p) => p.ks?.rx)) {
    let m = IDENTITY3
    for (const parent of parents) m = multiply3(layerLocalMatrix3(parent, frame), m)
    return flatten(m)
  }
  let m = IDENTITY
  for (const parent of parents) m = multiply(layerLocalMatrix(parent, frame), m)
  return m
}

/* -------------------------------------------------------------------------- */
/*                                 3D (flattened)                             */
/* -------------------------------------------------------------------------- */

/**
 * 3D affine matrix for column vectors: a row-major 3×3 linear part, then the translation.
 * x' = m0·x + m1·y + m2·z + m9, y' = m3·x + m4·y + m5·z + m10, z' = m6·x + m7·y + m8·z + m11.
 */
type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

function multiply3(m: Mat3, n: Mat3): Mat3 {
  const out: number[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++)
      out.push(m[r * 3] * n[c] + m[r * 3 + 1] * n[3 + c] + m[r * 3 + 2] * n[6 + c])
  }
  for (let r = 0; r < 3; r++)
    out.push(m[r * 3] * n[9] + m[r * 3 + 1] * n[10] + m[r * 3 + 2] * n[11] + m[9 + r])
  return out as unknown as Mat3
}

/** The 2D part of a 3D matrix for the z = 0 content plane (the renderers' orthographic view). */
function flatten(m: Mat3): Mat2D {
  return [m[0], m[3], m[1], m[4], m[9], m[10]]
}

const DEG = Math.PI / 180

/**
 * lottie-web's rotateX / rotateY / rotateZ(θ) as column-vector matrices (they are defined for
 * row vectors; their signs are kept, so 3D files turn exactly as they play).
 */
function rotationX(deg: number): Mat3 {
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  return [1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0]
}
function rotationY(deg: number): Mat3 {
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  return [c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0]
}
function rotationZ(deg: number): Mat3 {
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  return [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0]
}

/** A 2D matrix acting on x, y (z kept). */
function lift(m: Mat2D): Mat3 {
  return [m[0], m[2], 0, m[1], m[3], 0, 0, 0, 1, m[4], m[5], 0]
}

/**
 * Local matrix of a transform in 3D, exactly as lottie-web builds it (TransformProperty):
 * T(−a) · S · Skew · rotations · auto-orient · T(p), applied in that order, with z negated in
 * the anchor and position like lottie-web does. 2D transforms turn about z only.
 */
function transformMatrix3(t: Transform, frame: number, opts: { autoOrient?: boolean } = {}): Mat3 {
  const p = positionAt(t.p, frame)
  const a = t.a ? evaluateVector(t.a, frame, [0, 0, 0]) : [0, 0, 0]
  const s = t.s ? evaluateVector(t.s, frame, [100, 100, 100]) : [100, 100, 100]
  const sk = t.sk ? evaluateScalar(t.sk, frame) : 0
  const sa = t.sa ? evaluateScalar(t.sa, frame) : 0
  const angle = (prop: Transform['r']) => num(prop ? evaluateScalar(prop, frame) : 0, 0)

  // Linear part, composed from the last operation applied (left) to the first (right).
  let linear = IDENTITY3
  if (opts.autoOrient) linear = rotationZ(-autoOrientAngle(t.p, frame))
  if (t.rx) {
    const or = t.or ? evaluateVector(t.or, frame, [0, 0, 0]) : [0, 0, 0]
    for (const r of [
      rotationX(num(or[0] ?? 0, 0)),
      rotationY(num(or[1] ?? 0, 0)),
      rotationZ(-num(or[2] ?? 0, 0)),
      rotationX(angle(t.rx)),
      rotationY(angle(t.ry)),
      rotationZ(-angle(t.rz)),
    ])
      linear = multiply3(linear, r)
  } else {
    linear = multiply3(linear, rotationZ(-angle(t.r)))
  }
  if (sk !== 0) linear = multiply3(linear, lift(rotate(skewX(rotate(IDENTITY, -sa), -sk), sa)))
  const sx = num(s[0] ?? 100, 100) / 100
  const sy = num(s[1] ?? s[0] ?? 100, 100) / 100
  const sz = num(s[2] ?? 100, 100) / 100
  linear = multiply3(linear, [sx, 0, 0, 0, sy, 0, 0, 0, sz, 0, 0, 0])
  // T(p) · linear · T(−a): the anchor's z and the position's z are negated by lottie-web.
  const anchor = [-num(a[0] ?? 0, 0), -num(a[1] ?? 0, 0), num(a[2] ?? 0, 0)]
  const position = [num(p[0] ?? 0, 0), num(p[1] ?? 0, 0), -num(p[2] ?? 0, 0)]
  const translation = [0, 1, 2].map(
    (r) =>
      linear[r * 3] * anchor[0] +
      linear[r * 3 + 1] * anchor[1] +
      linear[r * 3 + 2] * anchor[2] +
      position[r],
  )
  return [...linear.slice(0, 9), ...translation] as unknown as Mat3
}

function layerLocalMatrix3(layer: Layer, frame: number): Mat3 {
  return layer.ks ? transformMatrix3(layer.ks, frame, { autoOrient: layer.ao === 1 }) : IDENTITY3
}

/* -------------------------------------------------------------------------- */
/*                                  Placements                                */
/* -------------------------------------------------------------------------- */

/** Precomp layers (any composition) that reference the given precomp asset id. */
function precompInstancesOf(doc: Animation, assetId: string): NodePath[] {
  const out: NodePath[] = []
  const scan = (layers: Layer[] | undefined, base: NodePath) => {
    layers?.forEach((l, i) => {
      if (l.ty === LayerType.Precomp && (l as PrecompLayer).refId === assetId)
        out.push([...base, i])
    })
  }
  scan(doc.layers, ['layers'])
  doc.assets?.forEach((asset, i) => {
    if (isPrecompAsset(asset)) scan(asset.layers, ['assets', i, 'layers'])
  })
  return out
}

/**
 * Placements of a composition's coordinate space in the root composition: one for the root
 * comp, one per precomp instance (recursively) for precomp assets.
 */
function compPlacements(
  doc: Animation,
  assetIndex: number | null,
  rootFrame: number,
  depth: number,
): Placement[] {
  if (assetIndex === null)
    return [{ matrix: IDENTITY, frame: rootFrame, visible: true, inRange: true, chain: [] }]
  if (depth > MAX_DEPTH) return []
  const asset = doc.assets?.[assetIndex]
  if (!asset || !isPrecompAsset(asset)) return []
  const out: Placement[] = []
  for (const precompPath of precompInstancesOf(doc, asset.id)) {
    const precomp = getAt<PrecompLayer>(doc, precompPath)
    if (!precomp) continue
    for (const outer of layerPlacementsAt(doc, precompPath, rootFrame, depth + 1, 'content')) {
      out.push({
        matrix: outer.matrix,
        frame: precompInnerFrame(precomp, outer.frame, doc.fr),
        visible: outer.visible,
        inRange: outer.visible,
        chain: [...outer.chain, precompPath],
      })
      if (out.length >= MAX_INSTANCES) return out
    }
  }
  return out
}

/**
 * 'content': the layer's own coordinates (inside its transform); 'parent': the space its
 * transform lives in (parent chain and precomp instance, without the layer's own transform).
 */
type LayerSpace = 'content' | 'parent'

function layerPlacementsAt(
  doc: Animation,
  layerPath: NodePath,
  rootFrame: number,
  depth: number,
  space: LayerSpace,
): Placement[] {
  const layer = getAt<Layer>(doc, layerPath)
  const layers = getAt<Layer[]>(doc, layerPath.slice(0, -1))
  if (!layer || !Array.isArray(layers)) return []
  const out: Placement[] = []
  for (const comp of compPlacements(doc, compAssetIndexOf(layerPath), rootFrame, depth)) {
    const local =
      space === 'content'
        ? layerCompMatrix(layers, layer, comp.frame)
        : layerParentMatrix(layers, layer, comp.frame)
    const matrix = multiply(comp.matrix, local)
    if (!isFiniteMatrix(matrix)) continue
    const inRange = comp.visible && isLayerActiveAt(layer, comp.frame)
    out.push({
      matrix,
      frame: comp.frame,
      visible: inRange && !layer.hd,
      inRange,
      chain: comp.chain,
    })
  }
  return out
}

/** Placements of a layer at a root-composition frame (one per precomp instance). */
export function layerPlacements(
  doc: Animation,
  layerPath: NodePath,
  rootFrame: number,
): Placement[] {
  if (!isLayerPath(layerPath)) return []
  return layerPlacementsAt(doc, layerPath, rootFrame, 0, 'content')
}

/**
 * Placements of a layer or shape item. For a group, the matrix maps the group's content
 * (inside its `tr`); for other shape items, the coordinates of the group that contains them.
 */
export function nodePlacements(doc: Animation, path: NodePath, rootFrame: number): Placement[] {
  return nodeSpacePlacements(doc, path, rootFrame, 'content')
}

/**
 * Placements of the space a layer's or group's transform lives in (its position is expressed
 * there): the parent chain and precomp instance for a layer; the layer and the enclosing groups
 * for a group. Other shape items have no transform of their own (empty).
 */
export function nodeParentPlacements(
  doc: Animation,
  path: NodePath,
  rootFrame: number,
): Placement[] {
  if (isShapePath(path) && getAt<ShapeItem>(doc, path)?.ty !== 'gr') return []
  return nodeSpacePlacements(doc, path, rootFrame, 'parent')
}

/** The `tr` item of a group (the transform all of its content goes through). */
export function groupTransform(group: GroupShape): Transform | undefined {
  return group.it?.find((it) => it.ty === 'tr') as Transform | undefined
}

function nodeSpacePlacements(
  doc: Animation,
  path: NodePath,
  rootFrame: number,
  space: LayerSpace,
): Placement[] {
  if (isLayerPath(path)) return layerPlacementsAt(doc, path, rootFrame, 0, space)
  if (!isShapePath(path)) return []
  const layerPath = layerPathOf(path)
  if (!layerPath) return []
  const base = layerPlacementsAt(doc, layerPath, rootFrame, 0, 'content')
  const target = getAt<ShapeItem>(doc, path)
  if (!target) return []
  // Walk the groups from the layer down to the node: shapes[i] → it[j] → it[k] …
  const groups: GroupShape[] = []
  for (let i = layerPath.length + 2; i <= path.length; i += 2) {
    const item = getAt<ShapeItem>(doc, path.slice(0, i))
    if (!item) return []
    if (item.ty === 'gr') groups.push(item)
    else if (i !== path.length) return [] // only the last segment may be a non-group item
  }
  // Hidden groups are dropped from the render copy, hiding everything inside them.
  const ancestors = target.ty === 'gr' ? groups.slice(0, -1) : groups
  const hiddenAncestor = ancestors.some((g) => g.hd)
  // In the parent space of a group, its own transform is not applied.
  const applied = space === 'parent' && target.ty === 'gr' ? ancestors : groups
  return base.map((placement) => {
    let matrix = placement.matrix
    for (const group of applied)
      matrix = multiply(matrix, transformMatrix(groupTransform(group), placement.frame))
    const inRange = placement.visible && !hiddenAncestor
    return {
      matrix,
      frame: placement.frame,
      visible: inRange && !target.hd,
      inRange,
      chain: placement.chain,
    }
  })
}

/** Anchor point of a node's transform (layer `ks.a`, group `tr.a`) in its content coordinates. */
function anchorOf(doc: Animation, path: NodePath, frame: number): Point {
  let t: Transform | undefined
  if (isLayerPath(path)) t = getAt<Layer>(doc, path)?.ks
  else {
    const item = getAt<ShapeItem>(doc, path)
    if (item?.ty === 'gr') t = groupTransform(item)
  }
  const a = t?.a ? evaluateVector(t.a, frame, [0, 0]) : [0, 0]
  return { x: num(a[0] ?? 0, 0), y: num(a[1] ?? 0, 0) }
}

export interface AnchorPoint extends Point {
  visible: boolean
  inRange: boolean
  /** Precomp layers this occurrence is rendered through, outermost first. */
  chain: readonly NodePath[]
}

/**
 * Anchor point of a layer or group in root composition coordinates, once per instance.
 * Other shape items have no transform: their containing group's origin is used.
 */
export function anchorPoints(doc: Animation, path: NodePath, rootFrame: number): AnchorPoint[] {
  return nodePlacements(doc, path, rootFrame).map((placement) => {
    const a = anchorOf(doc, path, placement.frame)
    const p = applyToPoint(placement.matrix, a.x, a.y)
    return {
      x: p.x,
      y: p.y,
      visible: placement.visible,
      inRange: placement.inRange,
      chain: placement.chain,
    }
  })
}

/**
 * Size of a precomp layer's frame (`w`×`h`). Precomp assets carry no size of their own, so a
 * layer without one falls back to the root composition size (what exporters write in practice).
 */
export function precompFrameSize(
  doc: Animation,
  layer: PrecompLayer,
): { width: number; height: number } | null {
  if (typeof layer.w === 'number' && typeof layer.h === 'number' && layer.w > 0 && layer.h > 0) {
    return { width: layer.w, height: layer.h }
  }
  return doc.w > 0 && doc.h > 0 ? { width: doc.w, height: doc.h } : null
}
