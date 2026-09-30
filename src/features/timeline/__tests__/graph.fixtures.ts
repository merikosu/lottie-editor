/**
 * Fixture documents for the graph editor tests: every kind of curve the graph draws (1-D,
 * linked and per-dimension vectors, curved and straight motion paths, holds, colors, legacy
 * end values, split position) plus things it cannot draw (paths), and a stretched precomp.
 */
import { createAnimation } from '@/lottie/document'
import type { Animation, Layer } from '@/lottie/types'

const ease = (
  ox: number | number[],
  oy: number | number[],
  ix: number | number[],
  iy: number | number[],
) => ({
  o: { x: ox, y: oy },
  i: { x: ix, y: iy },
})

function ball(): Layer {
  return {
    ty: 4,
    nm: 'Ball',
    ind: 1,
    ip: 0,
    op: 90,
    st: 0,
    ks: {
      // 1-D, AE-style length-1 easing arrays.
      o: {
        a: 1,
        k: [
          { t: 0, s: [0], ...ease([0.4], [0], [0.6], [1]) },
          { t: 20, s: [100], ...ease([0.2], [0.3], [0.7], [0.8]) },
          { t: 40, s: [30] },
        ],
      },
      // Spatial: a curved segment, then a straight one (zero tangents).
      p: {
        a: 1,
        k: [
          { t: 0, s: [100, 100, 0], ...ease(0.3, 0, 0.7, 1), to: [40, -60, 0], ti: [-30, -40, 0] },
          { t: 30, s: [300, 120, 0], ...ease(0.25, 0.1, 0.75, 0.9), to: [0, 0, 0], ti: [0, 0, 0] },
          { t: 60, s: [300, 300, 0] },
        ],
      },
      // Per-dimension easing that differs between x and y (unlinked).
      s: {
        a: 1,
        k: [
          {
            t: 10,
            s: [100, 100, 100],
            ...ease([0.1, 0.5, 0.5], [0, 0.2, 0.2], [0.9, 0.5, 0.5], [1, 0.8, 0.8]),
          },
          { t: 50, s: [150, 80, 100] },
        ],
      },
      // Hold in the middle.
      r: {
        a: 1,
        k: [
          { t: 0, s: [0], ...ease(0.33, 0, 0.67, 1) },
          { t: 15, s: [90], h: 1 },
          { t: 30, s: [45], ...ease(0.33, 0, 0.67, 1) },
          { t: 45, s: [0] },
        ],
      },
      a: { a: 0, k: [0, 0, 0] },
    },
    shapes: [
      {
        ty: 'gr',
        nm: 'Group',
        it: [
          {
            ty: 'sh',
            ks: {
              a: 1,
              k: [
                {
                  t: 0,
                  s: [{ i: [[0, 0]], o: [[0, 0]], v: [[0, 0]], c: false }],
                  ...ease(0.3, 0, 0.7, 1),
                },
                { t: 30, s: [{ i: [[0, 0]], o: [[0, 0]], v: [[5, 5]], c: false }] },
              ],
            },
          },
          {
            ty: 'fl',
            c: {
              a: 1,
              k: [
                { t: 0, s: [1, 0, 0, 1], ...ease(0.3, 0, 0.7, 1) },
                { t: 30, s: [0, 0.5, 1, 1] },
              ],
            },
            o: { a: 0, k: 100 },
          },
          {
            ty: 'tr',
            p: { a: 0, k: [0, 0] },
            a: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
        ],
      },
    ],
  } as unknown as Layer
}

function split(): Layer {
  return {
    ty: 3,
    nm: 'Null',
    ind: 2,
    ip: 0,
    op: 90,
    st: 0,
    ks: {
      p: {
        s: true,
        x: {
          a: 1,
          k: [
            { t: 0, s: [0], ...ease([0.5], [0], [0.5], [1]) },
            { t: 24, s: [200] },
          ],
        },
        y: { a: 0, k: 50 },
      },
      // Legacy end values (bodymovin < 5.5).
      r: {
        a: 1,
        k: [
          { t: 0, s: [0], e: [180], ...ease(0.3, 0, 0.7, 1) },
          { t: 20, s: [180], e: [90], ...ease(0.3, 0, 0.7, 1) },
          { t: 40 },
        ],
      },
      o: { a: 0, k: 100 },
    },
  } as unknown as Layer
}

function precompLayer(): Layer {
  return {
    ty: 0,
    nm: 'Comp',
    ind: 3,
    refId: 'comp_1',
    ip: 10,
    op: 90,
    st: 10,
    sr: 2,
    w: 100,
    h: 100,
    ks: { o: { a: 0, k: 100 } },
  } as unknown as Layer
}

/** Document with the layers above (root) and one precomp (rotation keys at 0 → 20, local). */
export function graphDoc(): Animation {
  const doc = createAnimation({ frames: 90 })
  doc.layers = [ball(), split(), precompLayer()]
  doc.assets = [
    {
      id: 'comp_1',
      layers: [
        {
          ty: 3,
          nm: 'Inner',
          ind: 1,
          ip: 0,
          op: 60,
          st: 0,
          ks: {
            r: {
              a: 1,
              k: [
                { t: 0, s: [0], ...ease(0.33, 0, 0.67, 1) },
                { t: 20, s: [360] },
              ],
            },
          },
        },
      ],
    } as unknown as NonNullable<Animation['assets']>[number],
  ]
  return doc
}

export const P = {
  opacity: ['layers', 0, 'ks', 'o'],
  position: ['layers', 0, 'ks', 'p'],
  scale: ['layers', 0, 'ks', 's'],
  rotation: ['layers', 0, 'ks', 'r'],
  path: ['layers', 0, 'shapes', 0, 'it', 0, 'ks'],
  fill: ['layers', 0, 'shapes', 0, 'it', 1, 'c'],
  splitX: ['layers', 1, 'ks', 'p', 'x'],
  legacy: ['layers', 1, 'ks', 'r'],
  inner: ['assets', 0, 'layers', 0, 'ks', 'r'],
} as const
