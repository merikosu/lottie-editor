/**
 * Small builders for insights tests (compat, validate, stats, optimize). Documents are plain
 * JSON objects, deliberately loose: tests feed broken data on purpose.
 */
import type { Animation } from '../types'

export type J = Record<string, unknown>

/** Static property. */
export const p = (k: unknown): J => ({ a: 0, k })

const LIN_O = { x: 0.167, y: 0.167 }
const LIN_I = { x: 0.833, y: 0.833 }

/** Keyframed property with linear easing: [[t, value], …]. Scalars are wrapped in arrays. */
export function kf(...frames: [number, unknown][]): J {
  return {
    a: 1,
    k: frames.map(([t, v], i) => {
      // Keyframe values are arrays: numbers → [n], bezier paths → [path].
      const key: J = { t, s: Array.isArray(v) ? v : [v] }
      if (i < frames.length - 1) {
        key.o = { ...LIN_O }
        key.i = { ...LIN_I }
      }
      return key
    }),
  }
}

export const transform = (extra: J = {}): J => ({
  o: p(100),
  r: p(0),
  p: p([0, 0, 0]),
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
  ...extra,
})

export const rect = (extra: J = {}): J => ({
  ty: 'rc',
  p: p([0, 0]),
  s: p([100, 100]),
  r: p(0),
  ...extra,
})
export const ellipse = (extra: J = {}): J => ({ ty: 'el', p: p([0, 0]), s: p([50, 50]), ...extra })
export const fill = (extra: J = {}): J => ({
  ty: 'fl',
  c: p([1, 0, 0, 1]),
  o: p(100),
  r: 1,
  ...extra,
})
export const stroke = (extra: J = {}): J => ({
  ty: 'st',
  c: p([0, 0, 0, 1]),
  o: p(100),
  w: p(2),
  lc: 2,
  lj: 2,
  ...extra,
})

export const bezier = (points: number[][], closed = true): J => ({
  v: points,
  i: points.map(() => [0, 0]),
  o: points.map(() => [0, 0]),
  c: closed,
})

export const path = (extra: J = {}): J => ({
  ty: 'sh',
  ks: p(
    bezier([
      [0, 0],
      [10, 0],
      [10, 10],
    ]),
  ),
  ...extra,
})

export const group = (items: J[], extra: J = {}): J => ({
  ty: 'gr',
  it: [...items, tr()],
  ...extra,
})

export function layer(ind: number, extra: J = {}): J {
  return {
    ddd: 0,
    ind,
    ty: 4,
    nm: `Layer ${ind}`,
    sr: 1,
    ks: transform(),
    ao: 0,
    ip: 0,
    op: 60,
    st: 0,
    bm: 0,
    shapes: [group([rect(), fill()])],
    ...extra,
  }
}

export const nullLayer = (ind: number, extra: J = {}): J => {
  const l = layer(ind, { ty: 3, nm: `Null ${ind}`, ...extra })
  delete l.shapes
  return l
}

export const precompLayer = (ind: number, refId: string, extra: J = {}): J => {
  const l = layer(ind, { ty: 0, refId, w: 512, h: 512, nm: `Precomp ${ind}`, ...extra })
  delete l.shapes
  return l
}

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
    ...extra,
  } as unknown as Animation
}

/* ------------------------------- Image data ------------------------------ */

function base64(bytes: number[]): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

/** PNG header (signature + IHDR) with the given size and color type (6 = RGBA, 2 = RGB). */
export function pngUri(width: number, height: number, colorType = 6, padding = 0): string {
  const bytes = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32(width),
    ...u32(height),
    8,
    colorType,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]
  // IDAT chunk header so the tRNS scan stops.
  bytes.push(...u32(padding), 0x49, 0x44, 0x41, 0x54)
  for (let i = 0; i < padding; i++) bytes.push(i & 255)
  return `data:image/png;base64,${base64(bytes)}`
}

/** JPEG header: SOI, an APP0 segment, then SOF0 with the size. */
export function jpegUri(width: number, height: number): string {
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ]
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 255,
    height & 255,
    (width >> 8) & 255,
    width & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]
  return `data:image/jpeg;base64,${base64([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9])}`
}

/** WebP (VP8X extended header) with the given size and alpha flag. */
export function webpUri(width: number, height: number, alpha: boolean): string {
  const w = width - 1
  const h = height - 1
  const bytes = [
    0x52,
    0x49,
    0x46,
    0x46,
    30,
    0,
    0,
    0,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x58,
    10,
    0,
    0,
    0,
    alpha ? 0x10 : 0,
    0,
    0,
    0,
    w & 255,
    (w >> 8) & 255,
    (w >> 16) & 255,
    h & 255,
    (h >> 8) & 255,
    (h >> 16) & 255,
  ]
  return `data:image/webp;base64,${base64(bytes)}`
}

export function imageAsset(id: string, uri: string, w: number, h: number, extra: J = {}): J {
  return { id, w, h, u: '', p: uri, e: 1, ...extra }
}

/* ------------------------------ Damaged files ------------------------------ */

/** Mulberry32: small, fast, seedable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Container = Record<string, unknown> | unknown[]

/** Every object/array in the document with the key that leads to it. */
function containers(root: unknown): { parent: Container; key: string | number }[] {
  const out: { parent: Container; key: string | number }[] = []
  const stack: unknown[] = [root]
  while (stack.length) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      node.forEach((child, i) => {
        out.push({ parent: node, key: i })
        if (child && typeof child === 'object') stack.push(child)
      })
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        out.push({ parent: node as Record<string, unknown>, key })
        if (child && typeof child === 'object') stack.push(child)
      }
    }
  }
  return out
}

const JUNK: unknown[] = [
  null,
  0,
  -1,
  1.5,
  1e9,
  '',
  'x',
  true,
  false,
  [],
  {},
  [null],
  { k: null },
  [[]],
  { a: 1 },
]

/**
 * A copy of `anim` with `count` random damages: keys deleted, array items removed, values
 * replaced by junk (null, wrong types, empty containers).
 */
export function mutate(anim: Animation, random: () => number, count: number): Animation {
  const copy = JSON.parse(JSON.stringify(anim)) as Animation
  const slots = containers(copy)
  for (let n = 0; n < count && slots.length; n++) {
    const { parent, key } = slots[Math.floor(random() * slots.length)]
    const r = random()
    if (r < 0.25 && !Array.isArray(parent))
      delete (parent as Record<string, unknown>)[key as string]
    else if (r < 0.35 && Array.isArray(parent)) parent.splice(key as number, 1)
    else
      (parent as Record<string | number, unknown>)[key] = JUNK[Math.floor(random() * JUNK.length)]
  }
  return copy
}
