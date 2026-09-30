/**
 * Human-readable description of an animatable property from its JSON path: label, unit,
 * precision and value kind. Used for keyframe summaries and value fields.
 */
import type { Dict } from '@/i18n'
import { getAt, isLayerPath, type NodePath } from '@/lottie/path'

export type PropKind = 'number' | 'color' | 'path' | 'gradient' | 'text'

export interface PropDescription {
  label: string
  unit?: string
  precision: number
  kind: PropKind
  /** Short axis labels for vectors (X/Y, W/H). */
  axes?: string[]
}

type Desc = Omit<PropDescription, 'label'> & { label: (t: Dict) => string }

const px = (label: (t: Dict) => string, precision = 1): Desc => ({
  label,
  unit: 'px',
  precision,
  kind: 'number',
})
const pct = (label: (t: Dict) => string, precision = 0): Desc => ({
  label,
  unit: '%',
  precision,
  kind: 'number',
})
const deg = (label: (t: Dict) => string): Desc => ({
  label,
  unit: '°',
  precision: 1,
  kind: 'number',
})
const num = (label: (t: Dict) => string, precision = 1): Desc => ({
  label,
  precision,
  kind: 'number',
})
const color = (label: (t: Dict) => string): Desc => ({ label, precision: 3, kind: 'color' })

const TRANSFORM: Record<string, Desc> = {
  a: num((t) => t.inspector.props.anchor),
  p: num((t) => t.inspector.props.position),
  s: pct((t) => t.inspector.props.scale, 1),
  r: deg((t) => t.inspector.props.rotation),
  rz: deg((t) => t.inspector.props.rotation),
  rx: deg((t) => t.inspector.props.rotationX),
  ry: deg((t) => t.inspector.props.rotationY),
  or: deg((t) => t.inspector.props.orientation),
  o: pct((t) => t.inspector.props.opacity),
  sk: deg((t) => t.inspector.props.skew),
  sa: deg((t) => t.inspector.props.skewAxis),
  so: pct((t) => t.inspector.props.startOpacity),
  eo: pct((t) => t.inspector.props.endOpacity),
}

const SHAPES: Record<string, Record<string, Desc>> = {
  fl: { c: color((t) => t.inspector.props.color), o: pct((t) => t.inspector.props.opacity) },
  st: {
    c: color((t) => t.inspector.props.color),
    o: pct((t) => t.inspector.props.opacity),
    w: px((t) => t.inspector.props.width),
    ml2: num((t) => t.inspector.props.miterLimit),
  },
  gf: {
    o: pct((t) => t.inspector.props.opacity),
    s: num((t) => t.inspector.props.startPoint),
    e: num((t) => t.inspector.props.endPoint),
    h: pct((t) => t.inspector.props.highlightLength, 1),
    a: deg((t) => t.inspector.props.highlightAngle),
  },
  gs: {
    o: pct((t) => t.inspector.props.opacity),
    s: num((t) => t.inspector.props.startPoint),
    e: num((t) => t.inspector.props.endPoint),
    h: pct((t) => t.inspector.props.highlightLength, 1),
    a: deg((t) => t.inspector.props.highlightAngle),
    w: px((t) => t.inspector.props.width),
    ml2: num((t) => t.inspector.props.miterLimit),
  },
  rc: {
    s: { ...px((t) => t.inspector.props.size), axes: ['W', 'H'] },
    p: num((t) => t.inspector.props.position),
    r: px((t) => t.inspector.props.roundness),
  },
  el: {
    s: { ...px((t) => t.inspector.props.size), axes: ['W', 'H'] },
    p: num((t) => t.inspector.props.position),
  },
  sr: {
    p: num((t) => t.inspector.props.position),
    r: deg((t) => t.inspector.props.rotation),
    pt: num((t) => t.inspector.props.points, 0),
    or: px((t) => t.inspector.props.outerRadius),
    os: pct((t) => t.inspector.props.outerRoundness),
    ir: px((t) => t.inspector.props.innerRadius),
    is: pct((t) => t.inspector.props.innerRoundness),
  },
  sh: { ks: { label: (t) => t.inspector.props.path, precision: 1, kind: 'path' } },
  tm: {
    s: pct((t) => t.inspector.props.trimStart, 1),
    e: pct((t) => t.inspector.props.trimEnd, 1),
    o: deg((t) => t.inspector.props.trimOffset),
  },
  rp: { c: num((t) => t.inspector.props.copies), o: num((t) => t.inspector.props.offset) },
  rd: { r: px((t) => t.inspector.props.radius) },
  op: { a: px((t) => t.inspector.props.amount), ml: num((t) => t.inspector.props.miterLimit) },
  pb: { a: pct((t) => t.inspector.props.amount, 1) },
  tw: { a: deg((t) => t.inspector.props.angle), c: num((t) => t.inspector.props.center) },
  zz: {
    s: px((t) => t.inspector.props.size),
    r: num((t) => t.inspector.props.ridges, 0),
    pt: num((t) => t.inspector.props.pointType, 0),
  },
}

const MASK: Record<string, Desc> = {
  o: pct((t) => t.inspector.masks.opacity),
  x: px((t) => t.inspector.masks.expansion),
  pt: { label: (t) => t.inspector.masks.path, precision: 1, kind: 'path' },
}

function resolve(d: Desc, t: Dict): PropDescription {
  return { ...d, label: d.label(t) }
}

/** Describes the property at `path` (label in the current language, unit, value kind). */
export function describeProperty(doc: unknown, path: NodePath, t: Dict): PropDescription {
  const n = path.length
  const last = path[n - 1]
  const key = String(last)
  const parentPath = path.slice(0, -1)
  const parent = getAt<Record<string, unknown>>(doc, parentPath)
  const parentKey = path[n - 2]

  // Text document (source text).
  if (key === 'd' && parentKey === 't')
    return { label: t.inspector.text.content, precision: 0, kind: 'text' }
  // Gradient colors: [..., 'g', 'k'].
  if (key === 'k' && parentKey === 'g')
    return { label: t.inspector.gradient.stops, precision: 3, kind: 'gradient' }
  // Time remap of a precomp layer.
  if (key === 'tm' && isLayerPath(parentPath)) {
    return {
      label: t.inspector.layer.timeRemap,
      unit: t.common.secondsShort,
      precision: 3,
      kind: 'number',
    }
  }
  // Separated position dimensions.
  if (parentKey === 'p' && (key === 'x' || key === 'y' || key === 'z')) {
    const labels = {
      x: t.inspector.props.positionX,
      y: t.inspector.props.positionY,
      z: t.inspector.props.positionZ,
    }
    return { label: labels[key], precision: 1, kind: 'number' }
  }
  // Masks: [..., 'masksProperties', i, key].
  if (path[n - 3] === 'masksProperties' && MASK[key]) return resolve(MASK[key], t)
  // Dashes: [..., 'd', i, 'v'].
  if (key === 'v' && path[n - 3] === 'd' && parent && typeof parent.n === 'string') {
    const label =
      parent.n === 'd'
        ? t.inspector.props.dash
        : parent.n === 'g'
          ? t.inspector.props.gap
          : t.inspector.props.dashOffset
    return { label, unit: 'px', precision: 1, kind: 'number' }
  }
  // Effect controls: [..., 'ef', i, 'ef', j, 'v'].
  if (key === 'v' && path[n - 3] === 'ef' && parent && typeof parent.nm === 'string') {
    return { label: parent.nm, precision: 2, kind: parent.ty === 2 ? 'color' : 'number' }
  }
  // Layer transform, group transform, repeater transform.
  const isTransform =
    parentKey === 'ks' ||
    (parent && parent.ty === 'tr') ||
    (parentKey === 'tr' && getAt<{ ty?: string }>(doc, path.slice(0, -2))?.ty === 'rp')
  if (isTransform && TRANSFORM[key]) return resolve(TRANSFORM[key], t)
  // Shape item properties.
  const ty = parent && typeof parent.ty === 'string' ? parent.ty : null
  const shape = ty ? SHAPES[ty]?.[key] : undefined
  if (shape) return resolve(shape, t)
  return { label: key, precision: 2, kind: 'number' }
}
