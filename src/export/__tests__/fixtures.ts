/** Test documents for the export modules. */
import bounceJson from '../../samples/bounce.json?raw'
import orbitJson from '../../samples/orbit.json?raw'
import testJson from '../../../docs/test.json?raw'
import type { Animation, Layer } from '@/lottie/types'

/** The built-in bouncing ball: 512 × 512, 30 fps, 60 frames, three shape layers. */
export function loadBounce(): Animation {
  return JSON.parse(bounceJson) as Animation
}

/** Built-in sample with a reused precomp, a null and parenting (30 fps, 180 frames). */
export function loadOrbit(): Animation {
  return JSON.parse(orbitJson) as Animation
}

/** The user's real-world sticker: 512 × 512, 60 fps, 179 frames, precomps, 1 effect, 1 expression. */
export function loadTestJson(): Animation {
  return JSON.parse(testJson) as Animation
}

/** 1×1 red PNG. */
export const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

const transform = () => ({
  o: { a: 0, k: 100 },
  r: { a: 0, k: 0 },
  p: { a: 0, k: [50, 50, 0] },
  a: { a: 0, k: [0, 0, 0] },
  s: { a: 0, k: [100, 100, 100] },
})

/** A document using every feature Telegram forbids. */
export function forbiddenFeatures(): Animation {
  const layers = [
    {
      ty: 4,
      nm: 'Shapes',
      ind: 1,
      ip: 0,
      op: 30,
      st: 0,
      ks: { ...transform(), p: { a: 0, k: [0, 0, 0], x: 'wiggle(2, 10)' } },
      ao: 1,
      hasMask: true,
      masksProperties: [
        { mode: 'a', pt: { a: 0, k: { i: [], o: [], v: [], c: true } }, o: { a: 0, k: 100 } },
      ],
      ef: [{ ty: 5, nm: 'Slider', ef: [] }],
      shapes: [
        {
          ty: 'gr',
          nm: 'Group',
          it: [
            { ty: 'sr', nm: 'Star', sy: 1 },
            { ty: 'mm', nm: 'Merge', mm: 1 },
            { ty: 'gs', nm: 'Gradient stroke' },
            { ty: 'rp', nm: 'Repeater' },
          ],
        },
      ],
    },
    {
      ty: 1,
      nm: 'Solid',
      ind: 2,
      ip: 0,
      op: 30,
      st: 0,
      sc: '#ff0000',
      sw: 10,
      sh: 10,
      ks: transform(),
    },
    { ty: 2, nm: 'Picture', ind: 3, ip: 0, op: 30, st: 0, refId: 'image_0', ks: transform() },
    {
      ty: 5,
      nm: 'Title',
      ind: 4,
      ip: 0,
      op: 30,
      st: 0,
      t: { d: { k: [] } },
      ks: transform(),
      ddd: 1,
    },
    {
      ty: 0,
      nm: 'Remapped',
      ind: 5,
      ip: 0,
      op: 30,
      st: 0,
      refId: 'comp_0',
      tm: { a: 0, k: 0 },
      sr: 2,
      ks: transform(),
    },
  ] as unknown as Layer[]
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    nm: 'Forbidden',
    assets: [
      { id: 'image_0', w: 1, h: 1, u: '', p: PNG_DATA_URI, e: 1 },
      { id: 'comp_0', nm: 'Inner', layers: [] },
    ],
    layers,
  }
}
