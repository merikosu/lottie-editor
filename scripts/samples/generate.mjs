#!/usr/bin/env node
/**
 * Generates the built-in sample animations into src/samples/*.json.
 *
 *   node scripts/samples/generate.mjs
 *
 * The samples are original works made for this project. Each one is small, loops
 * seamlessly and exercises a different part of the format: trim paths, easing with overshoot,
 * repeaters, path morphing with gradients, text keyframes, color animation, precomps reused with
 * time offsets, parenting and null layers. `bounce.json` is hand-made and not generated here.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  anim,
  bezier,
  composition,
  ease,
  ellipse,
  fill,
  gradientFill,
  group,
  hex,
  nullLayer,
  path,
  pathAnim,
  precompLayer,
  r3,
  rect,
  repeater,
  shapeLayer,
  stroke,
  textLayer,
  transform,
  trim,
} from './lottie-builder.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../src/samples')

/** One palette for every sample: mid-luminance colors that read on dark and light backgrounds. */
const C = {
  blue: '#4C7DFF',
  teal: '#1FB89A',
  coral: '#FF6B4A',
  amber: '#FFB21E',
  rose: '#FF4F79',
  green: '#22B573',
  slate: '#8A94A6',
  moon: '#A9B3C6',
  white: '#FFFFFF',
  black: '#000000',
}

/* ---------------------------------------------------------------------------------------------- */
/* Loader: an arc whose head and tail take turns sprinting (trim start/end + offset + rotation).  */
/* ---------------------------------------------------------------------------------------------- */

function loader() {
  const size = [124, 124]
  return composition({
    nm: 'Loader',
    w: 256,
    h: 256,
    fr: 60,
    op: 90,
    layers: [
      shapeLayer({
        nm: 'Arc',
        ind: 1,
        op: 90,
        ks: transform({
          p: [128, 128, 0],
          r: anim([
            [0, 0, ease.linear],
            [90, 360],
          ]),
        }),
        shapes: [
          group('Arc', [
            ellipse(size),
            // The arc is [0,10] at the start and [60,70] at the end; the offset turns it back by
            // 60% (216°) so the last frame matches the first one.
            trim({
              s: anim([
                [0, 0, ease.standard],
                [45, 0, ease.standard],
                [90, 60],
              ]),
              e: anim([
                [0, 10, ease.standard],
                [45, 70, ease.standard],
                [90, 70],
              ]),
              o: anim([
                [0, 0, ease.linear],
                [90, -216],
              ]),
            }),
            stroke(hex(C.blue), 12, { lc: 2 }),
          ]),
        ],
      }),
      shapeLayer({
        nm: 'Track',
        ind: 2,
        op: 90,
        ks: transform({ p: [128, 128, 0] }),
        shapes: [group('Track', [ellipse(size), stroke(hex(C.slate), 12, { o: 22 })])],
      }),
    ],
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Success: ring draws on, the disc fills with an overshoot, the check draws, then it all fades.  */
/* ---------------------------------------------------------------------------------------------- */

function success() {
  const check = bezier(
    [
      [-27, 2],
      [-9, 20],
      [27, -17],
    ],
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    false,
  )
  return composition({
    nm: 'Success',
    w: 256,
    h: 256,
    fr: 60,
    op: 120,
    layers: [
      shapeLayer({
        nm: 'Badge',
        ind: 1,
        op: 120,
        ks: transform({
          p: [128, 128, 0],
          s: anim([
            [0, [100, 100, 100], ease.linear],
            [38, [100, 100, 100], ease.outCubic],
            [46, [107, 107, 100], ease.inOut],
            [58, [100, 100, 100], ease.linear],
            [100, [100, 100, 100], ease.inOut],
            [114, [88, 88, 100]],
          ]),
          o: anim([
            [0, 100, ease.linear],
            [100, 100, ease.inOut],
            [114, 0],
          ]),
        }),
        shapes: [
          group('Check', [
            path(check, 'Check Path'),
            trim({
              e: anim([
                [36, 0, ease.outCubic],
                [56, 100],
              ]),
            }),
            stroke(hex(C.white), 12, { lc: 2, lj: 2 }),
          ]),
          group('Disc', [ellipse([124, 124]), fill(hex(C.green))], {
            s: anim([
              [20, [0, 0], ease.outBack],
              [40, [100, 100]],
            ]),
          }),
          group('Ring', [
            ellipse([124, 124]),
            trim({
              e: anim([
                [0, 0, ease.inOutCubic],
                [30, 100],
              ]),
            }),
            stroke(hex(C.green), 6, { lc: 2 }),
          ]),
        ],
      }),
    ],
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Like: the heart squashes and pops while a ring and a repeater burst of dots fly out.          */
/* ---------------------------------------------------------------------------------------------- */

/** Material "favorite" outline (24×24 box), converted to Lottie vertices around the origin. */
function heartPath(scale) {
  const v = [
    [12, 21.35],
    [10.55, 20.03],
    [2, 8.5],
    [7.5, 3],
    [12, 5.09],
    [16.5, 3],
    [22, 8.5],
    [13.45, 20.04],
  ]
  const i = [
    [0, 0],
    [0, 0],
    [0, 3.78],
    [-3.08, 0],
    [-1.09, -1.28],
    [-1.74, 0],
    [0, -3.08],
    [5.15, -4.68],
  ]
  const o = [
    [0, 0],
    [-5.15, -4.67],
    [0, -3.08],
    [1.74, 0],
    [1.09, -1.28],
    [3.08, 0],
    [0, 3.78],
    [0, 0],
  ]
  const center = [12, 12.2]
  return bezier(
    v.map(([x, y]) => [(x - center[0]) * scale, (y - center[1]) * scale]),
    i.map(([x, y]) => [x * scale, y * scale]),
    o.map(([x, y]) => [x * scale, y * scale]),
  )
}

/** A burst particle: flies from `from` to `to` while shrinking to nothing. */
function burstDot(nm, color, size, from, to) {
  return group(nm, [
    ellipse(
      anim([
        [14, size, ease.inOut],
        [42, [0, 0]],
      ]),
      anim([
        [8, from, ease.outCubic],
        [36, to],
      ]),
    ),
    fill(hex(color)),
  ])
}

function like() {
  return composition({
    nm: 'Like',
    w: 256,
    h: 256,
    fr: 60,
    op: 90,
    layers: [
      shapeLayer({
        nm: 'Heart',
        ind: 1,
        op: 90,
        ks: transform({
          p: [128, 132, 0],
          s: anim([
            [0, [100, 100, 100], ease.inOut],
            [8, [80, 80, 100], ease.out],
            [22, [118, 118, 100], ease.inOut],
            [34, [95, 95, 100], ease.inOut],
            [46, [100, 100, 100]],
          ]),
        }),
        shapes: [group('Heart', [path(heartPath(4.6), 'Heart Path'), fill(hex(C.rose))])],
      }),
      shapeLayer({
        nm: 'Burst',
        ind: 2,
        ip: 8,
        op: 46,
        ks: transform({ p: [128, 132, 0] }),
        shapes: [
          group('Dots', [
            burstDot('Dot', C.coral, [18, 18], [0, -50], [0, -106]),
            burstDot('Spark', C.amber, [12, 12], [15, -46], [32, -92]),
            repeater({ copies: 8, r: 45 }),
          ]),
        ],
      }),
      shapeLayer({
        nm: 'Ring',
        ind: 3,
        ip: 6,
        op: 34,
        ks: transform({ p: [128, 132, 0] }),
        shapes: [
          group('Ring', [
            ellipse(
              anim([
                [6, [44, 44], ease.outCubic],
                [32, [196, 196]],
              ]),
            ),
            stroke(
              anim([
                [6, hex(C.rose), ease.linear],
                [32, hex(C.amber)],
              ]),
              anim([
                [6, 16, ease.outCubic],
                [32, 0],
              ]),
            ),
          ]),
        ],
      }),
    ],
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Gradient blob: two soft blobs morph through three shapes while rotating in opposite ways.      */
/* ---------------------------------------------------------------------------------------------- */

/** Smooth closed blob: `offsets` are radial deviations (fractions of `radius`) per vertex. */
function blob(radius, offsets, turn = 0) {
  const n = offsets.length
  const kappa = (4 / 3) * Math.tan(Math.PI / (2 * n))
  const v = []
  const i = []
  const o = []
  offsets.forEach((d, k) => {
    const theta = (2 * Math.PI * k) / n + turn
    const r = radius * (1 + d)
    const [cx, cy] = [Math.cos(theta), Math.sin(theta)]
    const len = r * kappa
    v.push([r * cx, r * cy])
    o.push([-cy * len, cx * len])
    i.push([cy * len, -cx * len])
  })
  return bezier(v, i, o)
}

/** Loops through three shapes twice (0 → 1 → 2 → 0 …), starting at `shift`. */
function morph(shapes, shift = 0) {
  return pathAnim([0, 1, 2, 0, 1, 2, 0].map((index, k) => [k * 30, shapes[(index + shift) % 3]]))
}

function gradientBlob() {
  const front = [
    blob(132, [0.08, -0.06, 0.1, -0.05, 0.07, -0.1]),
    blob(132, [-0.06, 0.11, -0.08, 0.09, -0.07, 0.05], 0.2),
    blob(132, [0.11, 0.02, -0.1, 0.06, 0.1, -0.07], -0.15),
  ]
  const back = [
    blob(104, [-0.05, 0.1, 0.04, -0.09, 0.07, 0.02], 0.4),
    blob(104, [0.08, -0.08, 0.1, 0.03, -0.06, 0.09], 0.1),
    blob(104, [0.02, 0.11, -0.08, 0.08, 0.05, -0.08], 0.6),
  ]
  // The small blob drifts around the big one on a gentle loop.
  const drift = anim(
    [
      [0, [316, 318, 0]],
      [45, [330, 288, 0]],
      [90, [300, 300, 0]],
      [135, [322, 330, 0]],
      [180, [316, 318, 0]],
    ].map(([t, v]) => [t, v, ease.easy]),
  )
  return composition({
    nm: 'Gradient blob',
    w: 512,
    h: 512,
    fr: 30,
    op: 180,
    layers: [
      shapeLayer({
        nm: 'Front blob',
        ind: 1,
        op: 180,
        ks: transform({
          p: [226, 222, 0],
          r: anim([
            [0, 0, ease.linear],
            [180, 360],
          ]),
        }),
        shapes: [
          group('Blob', [
            path(morph(front), 'Blob Path'),
            gradientFill({
              stops: [
                [0, C.blue],
                [1, C.teal],
              ],
              s: [-132, -132],
              e: [132, 132],
            }),
          ]),
        ],
      }),
      shapeLayer({
        nm: 'Back blob',
        ind: 2,
        op: 180,
        ks: transform({
          p: drift,
          r: anim([
            [0, 0, ease.linear],
            [180, -360],
          ]),
        }),
        shapes: [
          group('Blob', [
            path(morph(back, 1), 'Blob Path'),
            gradientFill({
              stops: [
                [0, C.amber],
                [1, C.coral],
              ],
              s: [-104, 104],
              e: [104, -104],
            }),
          ]),
        ],
      }),
    ],
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Typing: a chat bubble shows typing dots, stretches and types "Hello" (text keyframes).         */
/* ---------------------------------------------------------------------------------------------- */

/** The bubble rectangle grows to the right: its center sits at half its width. */
const bubbleCenter = (w) => [w / 2, 0]

/** Typing dot bounce, staggered by `delay` frames. */
function dotBounce(delay) {
  const keys = []
  for (let t = delay; t <= 40 + delay; t += 24) {
    keys.push([t, [0, 0], ease.out], [t + 6, [0, -10], ease.in], [t + 12, [0, 0], ease.linear])
  }
  return anim(keys)
}

function typing() {
  const height = 84
  const small = 136
  const wide = 172
  const left = 240 - wide / 2
  // Clockwise like the rectangle: with the nonzero fill rule, a tail wound the other way would
  // cut a notch where the two overlap.
  const tail = bezier(
    [
      [34, 36],
      [-8, 47],
      [6, 18],
    ],
    [
      [0, 0],
      [13, -3],
      [0, 13],
    ],
    [
      [-10, 3],
      [0, 0],
      [0, 0],
    ],
  )
  return composition({
    nm: 'Typing',
    w: 480,
    h: 270,
    fr: 30,
    op: 120,
    fonts: [
      {
        fName: 'Inter-SemiBold',
        fFamily: 'Inter Variable, Inter, system-ui, sans-serif',
        fStyle: 'SemiBold',
        fWeight: '600',
        ascent: 72.7,
      },
    ],
    layers: [
      textLayer({
        nm: 'Message',
        ind: 1,
        ip: 50,
        op: 120,
        parent: 3,
        ks: transform({ p: [30, 16, 0] }),
        keys: [
          [50, 'H'],
          [53, 'He'],
          [56, 'Hel'],
          [59, 'Hell'],
          [62, 'Hello'],
        ],
        font: 'Inter-SemiBold',
        size: 44,
        color: C.white,
      }),
      shapeLayer({
        nm: 'Typing dots',
        ind: 2,
        op: 46,
        parent: 3,
        ks: transform({
          o: anim([
            [36, 100, ease.inOut],
            [44, 0],
          ]),
        }),
        shapes: [0, 1, 2].map((k) =>
          group(`Dot ${k + 1}`, [ellipse([15, 15], [40 + k * 28, 0]), fill(hex(C.white))], {
            p: dotBounce(k * 4),
          }),
        ),
      }),
      shapeLayer({
        nm: 'Bubble',
        ind: 3,
        op: 120,
        ks: transform({
          a: [0, height / 2, 0],
          p: [left, 135 + height / 2, 0],
          s: anim([
            [0, [0, 0, 100], ease.outBackSoft],
            [12, [100, 100, 100], ease.linear],
            [104, [100, 100, 100], ease.inOut],
            [116, [92, 92, 100]],
          ]),
          o: anim([
            [0, 100, ease.linear],
            [104, 100, ease.inOut],
            [116, 0],
          ]),
        }),
        shapes: [
          group('Bubble', [
            rect(
              anim([
                [40, [small, height], ease.outBackSoft],
                [52, [wide, height]],
              ]),
              anim([
                [40, bubbleCenter(small), ease.outBackSoft],
                [52, bubbleCenter(wide)],
              ]),
              height / 2,
            ),
            path(tail, 'Tail'),
            fill(hex(C.blue)),
          ]),
        ],
      }),
    ],
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Toggle: a switch turns on and off; the knob stretches while it travels, a check draws on.      */
/* ---------------------------------------------------------------------------------------------- */

/** Off → on (frames 15–30) → off (60–75), holding in between. */
function knobTravel(a, b) {
  return [
    [0, [a, 0], ease.linear],
    [15, [a, 0], ease.inOutCubic],
    [30, [b, 0], ease.linear],
    [60, [b, 0], ease.inOutCubic],
    [75, [a, 0]],
  ]
}

function toggle() {
  const travel = 32
  const check = bezier(
    [
      [-9, 1],
      [-3, 7],
      [9, -6],
    ],
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    false,
  )
  return composition({
    nm: 'Toggle',
    w: 256,
    h: 256,
    fr: 30,
    op: 90,
    layers: [
      shapeLayer({
        nm: 'Switch',
        ind: 1,
        op: 90,
        ks: transform({ p: [128, 128, 0] }),
        shapes: [
          group(
            'Knob',
            [
              group('Check', [
                path(check, 'Check Path'),
                trim({
                  e: anim([
                    [22, 0, ease.outCubic],
                    [32, 100, ease.linear],
                    [60, 100, ease.inOut],
                    [66, 0],
                  ]),
                }),
                stroke(hex(C.teal), 4, { lc: 2, lj: 2 }),
              ]),
              group('Face', [ellipse([62, 62]), fill(hex(C.white))]),
              group('Shadow', [ellipse([62, 62], [0, 3]), fill(hex(C.black), 18)]),
            ],
            {
              p: anim(knobTravel(-travel, travel)),
              s: anim([
                [15, [100, 100], ease.inOut],
                [22, [116, 92], ease.inOut],
                [30, [100, 100], ease.linear],
                [60, [100, 100], ease.inOut],
                [67, [116, 92], ease.inOut],
                [75, [100, 100]],
              ]),
            },
          ),
          group('Track', [
            rect([144, 78], [0, 0], 39),
            fill(
              anim([
                [15, hex(C.slate), ease.inOut],
                [30, hex(C.teal), ease.linear],
                [60, hex(C.teal), ease.inOut],
                [75, hex(C.slate)],
              ]),
            ),
          ]),
        ],
      }),
    ],
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Orbit: one "planet" precomp used twice (time offset + scale), parented to a rotating null.     */
/* ---------------------------------------------------------------------------------------------- */

function orbit() {
  const ringHalf = (nm, s, e) =>
    group(nm, [ellipse([112, 34]), trim({ s, e, o: -90 }), stroke(hex(C.amber), 5, { lc: 2 })], {
      r: -18,
    })
  const planet = {
    id: 'planet',
    nm: 'Planet',
    fr: 30,
    layers: [
      shapeLayer({
        nm: 'Moon',
        ind: 1,
        op: 240,
        parent: 2,
        ks: transform({ p: [58, 0, 0] }),
        shapes: [group('Moon', [ellipse([16, 16]), fill(hex(C.moon))])],
      }),
      nullLayer({
        nm: 'Moon orbit',
        ind: 2,
        op: 240,
        ks: transform({
          p: [100, 100, 0],
          r: anim([
            [0, 0, ease.linear],
            [240, 1440],
          ]),
        }),
      }),
      shapeLayer({
        nm: 'Planet',
        ind: 3,
        op: 240,
        ks: transform({ p: [100, 100, 0] }),
        shapes: [
          ringHalf('Ring front', 50, 100),
          group('Body', [ellipse([60, 60]), fill(hex(C.blue))]),
          ringHalf('Ring back', 0, 50),
        ],
      }),
    ],
  }
  const spin = anim([
    [0, 0, ease.linear],
    [180, -360],
  ])
  const pulse = anim([
    [0, [100, 100], ease.inOut],
    [45, [114, 114], ease.inOut],
    [90, [100, 100], ease.inOut],
    [135, [114, 114], ease.inOut],
    [180, [100, 100]],
  ])
  return composition({
    nm: 'Orbit',
    w: 512,
    h: 512,
    fr: 30,
    op: 180,
    assets: [planet],
    layers: [
      precompLayer({
        nm: 'Planet A',
        ind: 1,
        refId: 'planet',
        w: 200,
        h: 200,
        op: 180,
        parent: 4,
        ks: transform({ p: [170, 0, 0], a: [100, 100, 0], r: spin }),
      }),
      precompLayer({
        nm: 'Planet B',
        ind: 2,
        refId: 'planet',
        w: 200,
        h: 200,
        op: 180,
        st: -30,
        parent: 4,
        ks: transform({ p: [-170, 0, 0], a: [100, 100, 0], s: [64, 64, 100], r: spin }),
      }),
      shapeLayer({
        nm: 'Sun',
        ind: 3,
        op: 180,
        ks: transform({ p: [256, 256, 0] }),
        shapes: [
          group('Core', [
            ellipse([92, 92]),
            gradientFill({
              type: 2,
              stops: [
                [0, '#FFD466'],
                [1, C.coral],
              ],
              s: [-10, -12],
              e: [52, 34],
            }),
          ]),
          group('Halo', [ellipse([136, 136]), fill(hex(C.amber), 20)], { s: pulse }),
        ],
      }),
      nullLayer({
        nm: 'Orbit',
        ind: 4,
        op: 180,
        ks: transform({
          p: [256, 256, 0],
          r: anim([
            [0, 0, ease.linear],
            [180, 360],
          ]),
        }),
      }),
      shapeLayer({
        nm: 'Orbit path',
        ind: 5,
        op: 180,
        ks: transform({ p: [256, 256, 0] }),
        shapes: [
          group('Path', [
            ellipse([340, 340]),
            stroke(hex(C.slate), 2, {
              o: 45,
              lc: 2,
              dashes: [
                { n: 'd', nm: 'dash', v: { a: 0, k: 2 } },
                { n: 'g', nm: 'gap', v: { a: 0, k: 10 } },
                { n: 'o', nm: 'offset', v: { a: 0, k: 0 } },
              ],
            }),
          ]),
        ],
      }),
    ],
  })
}

/* ---------------------------------------------------------------------------------------------- */

const samples = {
  loader: loader(),
  success: success(),
  like: like(),
  'gradient-blob': gradientBlob(),
  typing: typing(),
  toggle: toggle(),
  orbit: orbit(),
}

for (const [id, data] of Object.entries(samples)) {
  const text = JSON.stringify(data)
  writeFileSync(join(OUT, `${id}.json`), `${text}\n`)
  console.log(
    `${id.padEnd(14)} ${String(data.w).padStart(4)}×${String(data.h).padEnd(4)} ${data.fr} fps  ${data.op} f  ${r3(data.op / data.fr)} s  ${(text.length / 1024).toFixed(1)} KB`,
  )
}
