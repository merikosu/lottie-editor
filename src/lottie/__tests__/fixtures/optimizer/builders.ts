/**
 * Builders for optimizer tests: loose JSON documents (tests feed unusual data on purpose) and
 * synthetic worst cases (baked keyframes, hidden parents, matte pairs, shared precomps, legacy
 * keyframes, expressions, embedded images).
 */
import type { Animation } from '../../../types'

export type J = Record<string, unknown>

export const p = (k: unknown, extra: J = {}): J => ({ a: 0, k, ...extra })

const LIN_O = { x: [0.167], y: [0.167] }
const LIN_I = { x: [0.833], y: [0.833] }

export interface KfOptions {
  /** Easing handles (default: bodymovin's linear). */
  o?: J
  i?: J
  hold?: boolean
  /** Spatial tangents for vector values. */
  to?: number[]
  ti?: number[]
}

/** Keyframed property: [[t, value], …]; scalars are wrapped in arrays. */
export function kf(frames: [number, unknown][], opts: KfOptions = {}): J {
  return {
    a: 1,
    k: frames.map(([t, v], idx) => {
      const key: J = { t, s: Array.isArray(v) ? v : [v] }
      if (idx < frames.length - 1) {
        if (opts.hold) key.h = 1
        else {
          key.o = structuredClone(opts.o ?? LIN_O)
          key.i = structuredClone(opts.i ?? LIN_I)
        }
        if (opts.to) key.to = [...opts.to]
        if (opts.ti) key.ti = [...opts.ti]
      }
      return key
    }),
  }
}

export const ks = (extra: J = {}): J => ({
  o: p(100),
  r: p(0),
  p: p([256, 256, 0]),
  a: p([0, 0, 0]),
  s: p([100, 100, 100]),
  ...extra,
})

export const tr = (extra: J = {}): J => ({
  ty: 'tr',
  p: p([0, 0]),
  a: p([0, 0]),
  s: p([100, 100]),
  r: p(0),
  o: p(100),
  sk: p(0),
  sa: p(0),
  nm: 'Transform',
  ...extra,
})

export const rect = (extra: J = {}): J => ({
  ty: 'rc',
  d: 1,
  p: p([0, 0]),
  s: p([100, 60]),
  r: p(0),
  nm: 'Rect',
  hd: false,
  ...extra,
})
export const ellipse = (extra: J = {}): J => ({
  ty: 'el',
  d: 1,
  p: p([0, 0]),
  s: p([50, 50]),
  nm: 'Ellipse',
  ...extra,
})
export const fill = (extra: J = {}): J => ({
  ty: 'fl',
  c: p([1, 0, 0, 1]),
  o: p(100),
  r: 1,
  bm: 0,
  nm: 'Fill',
  hd: false,
  ...extra,
})
export const stroke = (extra: J = {}): J => ({
  ty: 'st',
  c: p([0, 0, 0, 1]),
  o: p(100),
  w: p(4),
  lc: 2,
  lj: 2,
  bm: 0,
  nm: 'Stroke',
  ...extra,
})

export const bezier = (
  points: number[][],
  closed = true,
  tangents?: { i: number[][]; o: number[][] },
): J => ({
  i: tangents?.i ?? points.map(() => [0, 0]),
  o: tangents?.o ?? points.map(() => [0, 0]),
  v: points,
  c: closed,
})

export const path = (k: unknown, extra: J = {}): J => ({
  ty: 'sh',
  d: 1,
  ks: isKeyframes(k) ? k : { a: 0, k },
  nm: 'Path',
  ...extra,
})

function isKeyframes(v: unknown): v is J {
  return typeof v === 'object' && v !== null && 'k' in v && Array.isArray((v as J).k)
}

export const group = (items: J[], extra: J = {}, transform: J = {}): J => ({
  ty: 'gr',
  it: [...items, tr(transform)],
  nm: 'Group',
  np: items.length + 1,
  cix: 2,
  bm: 0,
  ix: 1,
  mn: 'ADBE Vector Group',
  hd: false,
  ...extra,
})

let nextInd = 1

export function resetInd(): void {
  nextInd = 1
}

export const shapeLayer = (shapes: J[], extra: J = {}): J => ({
  ddd: 0,
  ind: nextInd++,
  ty: 4,
  nm: 'Shape Layer',
  sr: 1,
  ks: ks(),
  ao: 0,
  shapes,
  ip: 0,
  op: 60,
  st: 0,
  bm: 0,
  ...extra,
})

export const nullLayer = (extra: J = {}): J => ({
  ddd: 0,
  ind: nextInd++,
  ty: 3,
  nm: 'Null',
  sr: 1,
  ks: ks(),
  ao: 0,
  ip: 0,
  op: 60,
  st: 0,
  bm: 0,
  ...extra,
})

export const precompLayer = (refId: string, extra: J = {}): J => ({
  ddd: 0,
  ind: nextInd++,
  ty: 0,
  nm: `Comp ${refId}`,
  refId,
  sr: 1,
  ks: ks(),
  ao: 0,
  w: 512,
  h: 512,
  ip: 0,
  op: 60,
  st: 0,
  bm: 0,
  ...extra,
})

export const imageLayer = (refId: string, extra: J = {}): J => ({
  ddd: 0,
  ind: nextInd++,
  ty: 2,
  nm: 'Image',
  refId,
  sr: 1,
  ks: ks(),
  ao: 0,
  ip: 0,
  op: 60,
  st: 0,
  bm: 0,
  ...extra,
})

export function doc(layers: J[], extra: J = {}): Animation {
  return {
    v: '5.12.2',
    fr: 30,
    ip: 0,
    op: 60,
    w: 512,
    h: 512,
    nm: 'Test',
    ddd: 0,
    assets: [],
    layers,
    markers: [],
    ...extra,
  } as unknown as Animation
}

export const precompAsset = (id: string, layers: J[], extra: J = {}): J => ({
  id,
  nm: id,
  fr: 30,
  layers,
  ...extra,
})

/** 2×2 opaque red PNG (RGBA). */
export const PNG_2X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR42mP4z8DwH4QZYAwAR8oH+Rq28akAAAAASUVORK5CYII='

export const imageAsset = (id: string, uri = PNG_2X2, extra: J = {}): J => ({
  id,
  w: 2,
  h: 2,
  u: '',
  p: uri,
  e: 1,
  ...extra,
})

/* -------------------------------------------------------------------------- */
/*                               Worst cases                                  */
/* -------------------------------------------------------------------------- */

/**
 * A "baked" animation (plugin output): one keyframe per frame for position, rotation, opacity
 * and a path, with linear, eased, constant and hold stretches.
 */
export function bakedAnimation(frames = 600): Animation {
  resetInd()
  const pos: [number, unknown][] = []
  const rot: [number, unknown][] = []
  const opa: [number, unknown][] = []
  const shape: [number, unknown][] = []
  for (let f = 0; f <= frames; f++) {
    const u = f / frames
    // Linear first third, eased (smoothstep) middle, constant last third.
    const x =
      u < 1 / 3
        ? 100 + 300 * u
        : u < 2 / 3
          ? 200 + 100 * (3 * ((u - 1 / 3) * 3) ** 2 - 2 * ((u - 1 / 3) * 3) ** 3)
          : 300
    pos.push([f, [x, 256 + 20 * Math.sin(u * Math.PI * 4), 0]])
    rot.push([f, u * 720])
    opa.push([f, f < frames / 2 ? 100 : 50])
    const w = 40 + 10 * u
    shape.push([
      f,
      [
        bezier([
          [-w, -w],
          [w, -w],
          [w, w],
          [-w, w],
        ]),
      ],
    ])
  }
  const layer = shapeLayer([group([path(kf(shape)), fill()])], {
    ks: ks({ p: kf(pos), r: kf(rot), o: kf(opa) }),
    op: frames + 1,
  })
  return doc([layer], { op: frames + 1 })
}

/** Legacy keyframes: each carries its end value `e` and easing name `n`; the last only `t`. */
const legacyKf = (frames: [number, number[]][]): J => ({
  a: 1,
  k: [
    ...frames.slice(0, -1).map(([t, s], i) => ({
      t,
      s,
      e: frames[i + 1][1],
      i: { x: [0.833], y: [0.833] },
      o: { x: [0.167], y: [0.167] },
      n: ['0p833_0p833_0p167_0p167'],
    })),
    { t: frames[frames.length - 1][0] },
  ],
})

/** Legacy (Bodymovin 4.x) keyframes: `e` end values, `n` easing names, last key with only `t`. */
export function legacyAnimation(): Animation {
  resetInd()
  const layer = shapeLayer([group([rect(), fill()])], {
    ks: ks({
      p: legacyKf([
        [0, [100, 100, 0]],
        [30, [400, 100, 0]],
        [59, [400, 400, 0]],
      ]),
      s: legacyKf([
        [0, [100, 100, 100]],
        [59, [50, 50, 100]],
      ]),
    }),
  })
  return doc([layer], { v: '5.1.0' })
}
