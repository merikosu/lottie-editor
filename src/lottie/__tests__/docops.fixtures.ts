/**
 * Test helpers for the document time/canvas operations: fixtures and a "rendered state"
 * snapshot used to check that an operation changes timing without changing what is shown.
 */
import bounceJson from '../../samples/bounce.json?raw'
import testJson from '../../../docs/test.json?raw'
import {
  evaluateArray,
  evaluatePath,
  evaluateTextDocument,
  getKeyframes,
  isPropertyLike,
  type AnyProperty,
} from '../property'
import { precompInnerFrame } from '../time'
import type {
  Animation,
  BezierPath,
  Layer,
  PrecompAsset,
  ShapePathProperty,
  TextData,
} from '../types'
import { isPrecompAsset, isPrecompLayer } from '../types'

/** The built-in bouncing ball (3 shape layers, spatial + per-dimension easing, markers). */
export function loadBounce(): Animation {
  return JSON.parse(bounceJson) as Animation
}

/** The user's real-world file: 60 fps, precomps with st offsets, parenting, 1 expression. */
export function loadTestJson(): Animation {
  return JSON.parse(testJson) as Animation
}

const linear = () => ({ o: { x: [0.167], y: [0.167] }, i: { x: [0.833], y: [0.833] } })

function rect(w: number, h: number) {
  return [
    { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [w, h] }, r: { a: 0, k: 0 } },
    { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
  ]
}

/**
 * A document exercising precomp time mapping: two instances of the same precomp with
 * different st/sr, one time-remapped instance, a nested precomp, hold keyframes, a text layer
 * with several documents, legacy `e` keyframes and markers.
 */
export function precompFixture(): Animation {
  const inner: Layer[] = [
    {
      ty: 4,
      ind: 1,
      nm: 'Mover',
      ip: 0,
      op: 40,
      st: 0,
      ks: {
        p: {
          a: 1,
          k: [
            {
              t: 0,
              s: [0, 0, 0],
              o: { x: 0.4, y: 0 },
              i: { x: 0.2, y: 1 },
              to: [10, 0, 0],
              ti: [0, 20, 0],
            },
            {
              t: 20,
              s: [100, 50, 0],
              o: { x: 0.3, y: 0 },
              i: { x: 0.6, y: 1 },
              to: [0, 10, 0],
              ti: [-5, 0, 0],
            },
            { t: 40, s: [30, 80, 0] },
          ],
        },
        o: {
          a: 1,
          k: [
            { t: 0, s: [0], h: 1 },
            { t: 10, s: [50], h: 1 },
            { t: 25, s: [100] },
          ],
        },
        s: {
          a: 1,
          k: [
            {
              t: 5,
              s: [100, 100, 100],
              o: { x: [0.1, 0.5, 0.2], y: [0, 0.2, 0] },
              i: { x: [0.9, 0.7, 0.8], y: [1, 0.8, 1] },
            },
            { t: 30, s: [150, 60, 100] },
          ],
        },
      },
      shapes: rect(20, 10),
    } as unknown as Layer,
    {
      ty: 0,
      ind: 2,
      nm: 'Nested',
      refId: 'comp_b',
      ip: 5,
      op: 35,
      st: 3,
      sr: 1.5,
      w: 100,
      h: 100,
      ks: {
        r: {
          a: 1,
          k: [
            { t: 5, s: [0], ...linear() },
            { t: 35, s: [90] },
          ],
        },
      },
    } as unknown as Layer,
    {
      ty: 5,
      ind: 3,
      nm: 'Label',
      ip: 0,
      op: 40,
      st: 0,
      ks: {},
      t: {
        d: {
          k: [
            { t: 0, s: { t: 'One', s: 20, f: 'Arial', j: 0 } },
            { t: 12, s: { t: 'Two', s: 20, f: 'Arial', j: 0 } },
            { t: 27, s: { t: 'Three', s: 20, f: 'Arial', j: 0 } },
          ],
        },
        a: [],
      },
    } as unknown as Layer,
  ]
  const nested: Layer[] = [
    {
      ty: 4,
      ind: 1,
      nm: 'Spinner',
      ip: 0,
      op: 30,
      st: 0,
      ks: {
        r: {
          a: 1,
          k: [
            // Legacy (bodymovin < 5.5) keyframes with `e` end values.
            { t: 0, s: [0], e: [180], ...linear() },
            { t: 15, s: [180], e: [360], o: { x: [0.5], y: [0] }, i: { x: [0.5], y: [1] } },
            { t: 30 },
          ],
        },
      },
      shapes: rect(8, 8),
    } as unknown as Layer,
  ]
  const root: Layer[] = [
    {
      ty: 0,
      ind: 1,
      nm: 'Instance A',
      refId: 'comp_a',
      ip: 0,
      op: 50,
      st: 0,
      w: 200,
      h: 200,
      ks: {
        p: {
          a: 1,
          k: [
            { t: 0, s: [100, 100, 0], ...linear() },
            { t: 60, s: [300, 200, 0] },
          ],
        },
      },
    } as unknown as Layer,
    {
      ty: 0,
      ind: 2,
      nm: 'Instance B (late, stretched)',
      refId: 'comp_a',
      ip: 15,
      op: 60,
      st: 12,
      sr: 0.8,
      w: 200,
      h: 200,
      ks: {},
    } as unknown as Layer,
    {
      ty: 0,
      ind: 3,
      nm: 'Instance C (remapped)',
      refId: 'comp_a',
      ip: 0,
      op: 60,
      st: 0,
      w: 200,
      h: 200,
      ks: {},
      tm: {
        a: 1,
        k: [
          { t: 0, s: [0.2], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
          { t: 40, s: [1.2], ...linear() },
          { t: 60, s: [0.6] },
        ],
      },
    } as unknown as Layer,
    {
      ty: 4,
      ind: 4,
      nm: 'Root shape',
      ip: 10,
      op: 60,
      st: 0,
      ks: {
        p: {
          s: true,
          x: {
            a: 1,
            k: [
              { t: 10, s: [0], ...linear() },
              { t: 50, s: [400] },
            ],
          },
          y: { a: 0, k: 250 },
        },
      },
      shapes: rect(30, 30),
    } as unknown as Layer,
  ]
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 400,
    h: 300,
    layers: root,
    assets: [
      { id: 'comp_a', nm: 'A', fr: 30, layers: inner } as PrecompAsset,
      { id: 'comp_b', nm: 'B', layers: nested } as PrecompAsset,
    ],
    markers: [
      { cm: 'intro', tm: 0, dr: 20 },
      { cm: 'outro', tm: 40, dr: 10 },
    ],
  }
}

const hold = (t: number, s: unknown) => ({ t, s, h: 1 })

function polyline(x: number, y: number) {
  return {
    c: false,
    v: [
      [0, 0],
      [x, 0],
      [x, y],
    ],
    i: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  }
}

function drawing(
  ind: number,
  nm: string,
  ip: number,
  op: number,
  parent?: number,
  extra: Record<string, unknown> = {},
) {
  return {
    ty: 4,
    ind,
    nm,
    ip,
    op,
    st: 0,
    ...(parent === undefined ? {} : { parent }),
    ks: {},
    shapes: rect(10 + ind, 10),
    ...extra,
  } as unknown as Layer
}

/**
 * Frame-by-frame content, where nothing interpolates: every value switches on a whole frame.
 * Hold keyframes (position with tangents, path, color, opacity, legacy `e` rotation), stacked
 * keys, text documents, drawings as consecutive layers under a held null parent, and a
 * precomp (st offset) whose content is frame-by-frame too.
 */
export function stepFixture(): Animation {
  const content: Layer[] = [
    drawing(1, 'X', 0, 6),
    drawing(2, 'Y', 6, 12),
    drawing(3, 'Z', 12, 40, undefined, {
      ks: { o: { a: 1, k: [hold(12, [20]), hold(15, [90]), { t: 19, s: [55] }] } },
    }),
  ]
  const root: Layer[] = [
    {
      ty: 3,
      ind: 1,
      nm: 'Rig',
      ip: 0,
      op: 24,
      st: 0,
      ks: {
        p: {
          a: 1,
          k: [
            { ...hold(0, [100, 100, 0]), to: [5, 0, 0], ti: [0, 0, 0] },
            hold(6, [110, 100, 0]),
            hold(12, [120, 105, 0]),
            { t: 18, s: [100, 100, 0] },
          ],
        },
      },
    } as unknown as Layer,
    drawing(2, 'A', 0, 8, 1, {
      shapes: [
        {
          ty: 'sh',
          ks: {
            a: 1,
            k: [
              hold(0, [polyline(10, 5)]),
              hold(3, [polyline(20, 8)]),
              { t: 5, s: [polyline(30, 2)] },
            ],
          },
        },
        {
          ty: 'fl',
          c: { a: 1, k: [hold(0, [1, 0, 0, 1]), { t: 4, s: [0, 0, 1, 1] }] },
          o: { a: 0, k: 100 },
        },
      ],
    }),
    drawing(3, 'B', 8, 16, 1, {
      ks: { o: { a: 1, k: [hold(8, [100]), hold(11, [40]), { t: 13, s: [100] }] } },
    }),
    drawing(4, 'C', 16, 24, 1, {
      ks: {
        // Legacy (bodymovin < 5.5) hold keyframes.
        r: {
          a: 1,
          k: [{ t: 16, s: [0], e: [30], h: 1 }, { t: 20, s: [30], e: [60], h: 1 }, { t: 23 }],
        },
      },
    }),
    {
      ty: 5,
      ind: 5,
      nm: 'Caption',
      ip: 0,
      op: 24,
      st: 0,
      ks: {},
      t: {
        d: {
          k: [
            { t: 0, s: { t: 'One', s: 20, f: 'Arial', j: 0 } },
            { t: 5, s: { t: 'Two', s: 20, f: 'Arial', j: 0 } },
            { t: 9, s: { t: 'Three', s: 20, f: 'Arial', j: 0 } },
            { t: 21, s: { t: 'Four', s: 20, f: 'Arial', j: 0 } },
          ],
        },
        a: [],
      },
    } as unknown as Layer,
    {
      ty: 0,
      ind: 6,
      nm: 'Flipbook',
      refId: 'flip',
      ip: 2,
      op: 22,
      st: 3,
      w: 100,
      h: 100,
      ks: {},
    } as unknown as Layer,
    drawing(7, 'Stacked', 0, 24, undefined, {
      ks: {
        s: {
          a: 1,
          k: [
            hold(0, [100, 100]),
            hold(10, [150, 150]),
            hold(10, [50, 50]),
            { t: 20, s: [80, 80] },
          ],
        },
      },
    }),
  ]
  return {
    v: '5.7.0',
    fr: 24,
    ip: 0,
    op: 24,
    w: 200,
    h: 200,
    layers: root,
    assets: [{ id: 'flip', nm: 'Flipbook', layers: content } as PrecompAsset],
    markers: [{ cm: 'loop', tm: 4, dr: 12 }],
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Snapshot                                  */
/* -------------------------------------------------------------------------- */

function isTextDocument(prop: AnyProperty): boolean {
  const kfs = getKeyframes(prop)
  const s = kfs?.[0]?.s as { t?: unknown } | undefined
  return !!s && typeof s === 'object' && !Array.isArray(s) && typeof s.t === 'string'
}

function isPath(prop: AnyProperty): boolean {
  const k = prop.k as unknown
  if (k !== null && typeof k === 'object' && !Array.isArray(k))
    return Array.isArray((k as BezierPath).v)
  const first = getKeyframes(prop)?.[0]?.s
  return (
    Array.isArray(first) &&
    first[0] !== null &&
    typeof first[0] === 'object' &&
    Array.isArray((first[0] as BezierPath).v)
  )
}

function evalProp(prop: AnyProperty, frame: number): unknown {
  if (isTextDocument(prop))
    return evaluateTextDocument({ d: prop } as unknown as TextData, frame)?.t
  if (isPath(prop)) return evaluatePath(prop as unknown as ShapePathProperty, frame)
  return evaluateArray(prop, frame)
}

function collect(node: unknown, frame: number, out: unknown[], skipRemap: boolean): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, frame, out, false)
    return
  }
  if (node === null || typeof node !== 'object') return
  for (const key of Object.keys(node)) {
    if (skipRemap && key === 'tm') continue
    const child = (node as Record<string, unknown>)[key]
    if (
      child !== null &&
      typeof child === 'object' &&
      !Array.isArray(child) &&
      isPropertyLike(child)
    ) {
      out.push(evalProp(child, frame))
    } else {
      collect(child, frame, out, false)
    }
  }
}

/** Evaluated property values of a layer (time remap excluded: it shows in the content). */
export function layerValues(layer: Layer, frame: number): unknown[] {
  const out: unknown[] = []
  collect(layer, frame, out, true)
  return out
}

export type Snapshot = Map<string, unknown[]>

/**
 * What the animation shows at `frame`: values of every visible layer, recursing into precomps
 * through their time mapping. Keys are layer index paths ("2>0>1" = root layer 2 → its
 * precomp's layer 0 → …). By default a layer counts only strictly inside its lifetime (float
 * ties at its in/out points are ignored); `exact` uses lottie-web's rule, ip ≤ t < op.
 */
export function snapshot(anim: Animation, frame: number, opts: { exact?: boolean } = {}): Snapshot {
  const out: Snapshot = new Map()
  const comps = new Map<string, PrecompAsset>()
  for (const asset of anim.assets ?? []) if (isPrecompAsset(asset)) comps.set(asset.id, asset)
  const visible = (layer: Layer, t: number) =>
    opts.exact ? layer.ip <= t && t < layer.op : layer.ip < t - 1e-6 && t < layer.op - 1e-6
  const visit = (layers: Layer[], t: number, prefix: string, depth: number) => {
    layers.forEach((layer, i) => {
      if (!visible(layer, t)) return
      const key = `${prefix}${i}`
      out.set(key, layerValues(layer, t))
      if (isPrecompLayer(layer) && depth < 8) {
        const asset = comps.get(layer.refId)
        if (asset) visit(asset.layers, precompInnerFrame(layer, t, anim.fr), `${key}>`, depth + 1)
      }
    })
  }
  visit(anim.layers, frame, '', 0)
  return out
}

/** Deep approximate equality; returns a description of the first difference or null. */
export function diff(a: unknown, b: unknown, tolerance: number, path = ''): string | null {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b))
      ? null
      : `${path}: ${a} ≠ ${b}`
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} ≠ ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], tolerance, `${path}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      const d = diff(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        tolerance,
        `${path}.${key}`,
      )
      if (d) return d
    }
    return null
  }
  return a === b ? null : `${path}: ${String(a)} ≠ ${String(b)}`
}

/** Compares two snapshots (optionally only keys under `prefixB` in `b`, stripped). */
export function snapshotDiff(
  a: Snapshot,
  b: Snapshot,
  tolerance = 2e-3,
  prefixB = '',
): string | null {
  const bKeys = [...b.keys()].filter((k) => k.startsWith(prefixB) && k.length > prefixB.length)
  const stripped = new Map(bKeys.map((k) => [k.slice(prefixB.length), b.get(k)!]))
  const keys = new Set([...a.keys(), ...stripped.keys()])
  for (const key of keys) {
    if (!a.has(key)) return `layer ${key} only visible after`
    if (!stripped.has(key)) return `layer ${key} only visible before`
    const d = diff(a.get(key), stripped.get(key), tolerance, key)
    if (d) return d
  }
  return null
}

/** Frames 0, step, 2·step… strictly below `end`. */
export function frames(start: number, end: number, step = 1): number[] {
  const out: number[] = []
  for (let t = start; t < end - 1e-9; t += step) out.push(Math.round(t * 1000) / 1000)
  return out
}
