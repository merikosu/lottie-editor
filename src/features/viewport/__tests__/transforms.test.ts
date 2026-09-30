import { describe, expect, it } from 'vitest'
import type { Animation, Layer, PrecompLayer, ShapeLayer, Transform } from '@/lottie/types'
import { applyToPoint, type Mat2D } from '../lib/matrix'
import {
  anchorPoints,
  autoOrientAngle,
  layerCompMatrix,
  layerPlacements,
  nodePlacements,
  precompFrameSize,
  transformMatrix,
} from '../lib/transforms'

/* -------------------------------------------------------------------------- */
/*          Reference: lottie-web's Matrix (row vectors, post-multiply)         */
/* -------------------------------------------------------------------------- */

type Row3 = [number, number, number, number, number, number] // a b c d tx ty: [x y 1]·M

class LottieMatrix {
  m: Row3 = [1, 0, 0, 1, 0, 0]
  private t(n: Row3) {
    const [a, b, c, d, e, f] = this.m
    this.m = [
      a * n[0] + b * n[2],
      a * n[1] + b * n[3],
      c * n[0] + d * n[2],
      c * n[1] + d * n[3],
      e * n[0] + f * n[2] + n[4],
      e * n[1] + f * n[3] + n[5],
    ]
    return this
  }
  translate(x: number, y: number) {
    return this.t([1, 0, 0, 1, x, y])
  }
  scale(x: number, y: number) {
    return this.t([x, 0, 0, y, 0, 0])
  }
  rotate(rad: number) {
    return this.t([Math.cos(rad), -Math.sin(rad), Math.sin(rad), Math.cos(rad), 0, 0])
  }
  skewFromAxis(ax: number, angle: number) {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return this.t([c, s, -s, c, 0, 0])
      .t([1, 0, Math.tan(ax), 1, 0, 0])
      .t([c, -s, s, c, 0, 0])
  }
  apply(x: number, y: number) {
    const [a, b, c, d, e, f] = this.m
    return { x: x * a + y * c + e, y: x * b + y * d + f }
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** lottie-web TransformProperty.processKeys, 2D subset. */
function lottieLocal(t: {
  a: number[]
  p: number[]
  s: number[]
  r: number
  sk: number
  sa: number
}) {
  return new LottieMatrix()
    .translate(-t.a[0], -t.a[1])
    .scale(t.s[0] / 100, t.s[1] / 100)
    .skewFromAxis(-rad(t.sk), rad(t.sa))
    .rotate(-rad(t.r))
    .translate(t.p[0], t.p[1])
}

/** lottie-web's 4×4 Matrix (row vectors: p' = p · M; operations append, applied in call order). */
class LottieMatrix4 {
  m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  private t(n: number[]) {
    const a = this.m
    const out = Array.from({ length: 16 }, () => 0)
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * n[k * 4 + c]
    this.m = out
    return this
  }
  times(other: LottieMatrix4) {
    return this.t(other.m)
  }
  translate(x: number, y: number, z: number) {
    return this.t([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
  }
  scale(x: number, y: number, z: number) {
    return this.t([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1])
  }
  rotateX(a: number) {
    const c = Math.cos(a)
    const s = Math.sin(a)
    return this.t([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1])
  }
  rotateY(a: number) {
    const c = Math.cos(a)
    const s = Math.sin(a)
    return this.t([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1])
  }
  rotateZ(a: number) {
    const c = Math.cos(a)
    const s = Math.sin(a)
    return this.t([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }
  skewFromAxis(ax: number, angle: number) {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return this.t([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      .t([1, 0, 0, 0, Math.tan(ax), 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      .t([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }
  /** A point of the z = 0 plane, flattened like the SVG renderer (to2dCSS). */
  apply(x: number, y: number) {
    const m = this.m
    return { x: x * m[0] + y * m[4] + m[12], y: x * m[1] + y * m[5] + m[13] }
  }
}

/** lottie-web TransformProperty.processKeys, 3D layers (or a 2D one with `twoD`, turning by `r`). */
function lottieLocal3(t: {
  a: number[]
  p: number[]
  s: number[]
  rx: number
  ry: number
  rz: number
  or: number[]
  sk: number
  sa: number
  r?: number
  twoD?: boolean
}) {
  const m = new LottieMatrix4()
    .translate(-t.a[0], -t.a[1], t.a[2])
    .scale(t.s[0] / 100, t.s[1] / 100, t.s[2] / 100)
  if (t.sk) m.skewFromAxis(-rad(t.sk), rad(t.sa))
  if (t.twoD) m.rotateZ(-rad(t.r ?? 0))
  else
    m.rotateZ(-rad(t.rz))
      .rotateY(rad(t.ry))
      .rotateX(rad(t.rx))
      .rotateZ(-rad(t.or[2]))
      .rotateY(rad(t.or[1]))
      .rotateX(rad(t.or[0]))
  return m.translate(t.p[0], t.p[1], -t.p[2])
}

/* -------------------------------------------------------------------------- */
/*                                   Fixtures                                 */
/* -------------------------------------------------------------------------- */

/** Deterministic pseudo-random numbers. */
function random(seed: number) {
  let s = seed
  return (min: number, max: number) => {
    s = (s * 16807) % 2147483647
    return min + ((s - 1) / 2147483646) * (max - min)
  }
}

const stat = <T>(k: T) => ({ a: 0 as const, k })

function ks(
  partial: Partial<Record<'a' | 'p' | 's', number[]>> & {
    r?: number
    sk?: number
    sa?: number
  } = {},
): Transform {
  return {
    a: stat(partial.a ?? [0, 0, 0]),
    p: stat(partial.p ?? [0, 0, 0]),
    s: stat(partial.s ?? [100, 100, 100]),
    r: stat(partial.r ?? 0),
    o: stat(100),
    ...(partial.sk !== undefined ? { sk: stat(partial.sk), sa: stat(partial.sa ?? 0) } : {}),
  }
}

function layer(extra: Partial<Layer> & { ty?: number } = {}): Layer {
  return { ty: 3, ip: 0, op: 100, st: 0, ks: ks(), ...extra } as Layer
}

function anim(layers: Layer[], assets: Animation['assets'] = []): Animation {
  return { v: '5.7.0', fr: 30, ip: 0, op: 100, w: 512, h: 512, layers, assets }
}

const expectPoint = (p: { x: number; y: number }, x: number, y: number, digits = 6) => {
  expect(p.x).toBeCloseTo(x, digits)
  expect(p.y).toBeCloseTo(y, digits)
}

/* -------------------------------------------------------------------------- */

describe('transformMatrix', () => {
  it('matches lottie-web on random transforms (incl. skew)', () => {
    let seed = 42
    const rnd = (min: number, max: number) => {
      seed = (seed * 16807) % 2147483647
      return min + ((seed - 1) / 2147483646) * (max - min)
    }
    for (let i = 0; i < 200; i++) {
      const t = {
        a: [rnd(-200, 200), rnd(-200, 200)],
        p: [rnd(-500, 500), rnd(-500, 500)],
        s: [rnd(-300, 300), rnd(-300, 300)],
        r: rnd(-720, 720),
        sk: rnd(-60, 60),
        sa: rnd(-180, 180),
      }
      const ours = transformMatrix(ks({ a: t.a, p: t.p, s: t.s, r: t.r, sk: t.sk, sa: t.sa }), 0)
      const ref = lottieLocal(t)
      for (const [x, y] of [
        [0, 0],
        [10, -20],
        [123.4, 56.7],
      ]) {
        const a = applyToPoint(ours, x, y)
        const b = ref.apply(x, y)
        expect(a.x).toBeCloseTo(b.x, 6)
        expect(a.y).toBeCloseTo(b.y, 6)
      }
    }
  })

  it('maps the anchor point to the position', () => {
    const m = transformMatrix(ks({ a: [50, 25], p: [300, 200], s: [200, 50], r: 37 }), 0)
    expectPoint(applyToPoint(m, 50, 25), 300, 200)
  })

  it('uses defaults for missing properties', () => {
    const m = transformMatrix({ p: stat([10, 20]) } as Transform, 0)
    expectPoint(applyToPoint(m, 1, 1), 11, 21)
    expect(transformMatrix(undefined, 0)).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('evaluates animated properties and separated position', () => {
    const t: Transform = {
      p: {
        s: true,
        x: {
          a: 1,
          k: [
            { t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
            { t: 10, s: [100] },
          ],
        },
        y: stat(5),
      },
      r: {
        a: 1,
        k: [
          { t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
          { t: 10, s: [90] },
        ],
      },
    } as unknown as Transform
    const m = transformMatrix(t, 5)
    expectPoint(applyToPoint(m, 0, 0), 50, 5)
    expectPoint(applyToPoint(m, 1, 0), 50 + Math.cos(rad(45)), 5 + Math.sin(rad(45)))
  })

  it('3D layers match lottie-web (4×4, flattened) on random transforms', () => {
    const rnd = random(99)
    for (let i = 0; i < 200; i++) {
      const v = {
        a: [rnd(-80, 80), rnd(-80, 80), rnd(-50, 50)],
        p: [rnd(-300, 300), rnd(-300, 300), rnd(-200, 200)],
        s: [rnd(-200, 200), rnd(-200, 200), rnd(20, 200)],
        rx: rnd(-180, 180),
        ry: rnd(-180, 180),
        rz: rnd(-180, 180),
        or: [rnd(-90, 90), rnd(-90, 90), rnd(-90, 90)],
        sk: rnd(0, 1) > 0.5 ? rnd(-40, 40) : 0,
        sa: rnd(-90, 90),
      }
      const t = {
        a: stat(v.a),
        p: stat(v.p),
        s: stat(v.s),
        rx: stat(v.rx),
        ry: stat(v.ry),
        rz: stat(v.rz),
        or: stat(v.or),
        ...(v.sk ? { sk: stat(v.sk), sa: stat(v.sa) } : {}),
      } as unknown as Transform
      const ours = transformMatrix(t, 0)
      const ref = lottieLocal3(v)
      for (const [x, y] of [
        [0, 0],
        [10, -20],
        [123.4, 56.7],
      ]) {
        const a = applyToPoint(ours, x, y)
        const b = ref.apply(x, y)
        expect(a.x).toBeCloseTo(b.x, 6)
        expect(a.y).toBeCloseTo(b.y, 6)
      }
    }
  })

  it('3D layers without x/y rotations turn by rz plus the z orientation', () => {
    const t = {
      p: stat([0, 0, 0]),
      rx: stat(0),
      ry: stat(0),
      rz: stat(20),
      or: stat([0, 0, 25]),
    } as unknown as Transform
    const m = transformMatrix(t, 0)
    expectPoint(applyToPoint(m, 1, 0), Math.cos(rad(45)), Math.sin(rad(45)))
  })

  it('composes parent chains with a 3D layer in 3D before flattening', () => {
    const rnd = random(7)
    for (let i = 0; i < 50; i++) {
      const parentV = {
        a: [rnd(-40, 40), rnd(-40, 40), rnd(-40, 40)],
        p: [rnd(0, 512), rnd(0, 512), rnd(-100, 100)],
        s: [rnd(50, 150), rnd(50, 150), rnd(50, 150)],
        rx: rnd(-80, 80),
        ry: rnd(-80, 80),
        rz: rnd(-180, 180),
        or: [0, 0, 0],
        sk: 0,
        sa: 0,
      }
      // A 2D child with a z position: the parent's tilt projects it on screen.
      const child = {
        a: [rnd(-20, 20), rnd(-20, 20), 0],
        p: [rnd(-60, 60), rnd(-60, 60), rnd(-80, 80)],
        r: rnd(-90, 90),
      }
      const layers = [
        layer({
          ind: 1,
          ddd: 1,
          ks: {
            a: stat(parentV.a),
            p: stat(parentV.p),
            s: stat(parentV.s),
            rx: stat(parentV.rx),
            ry: stat(parentV.ry),
            rz: stat(parentV.rz),
            or: stat([0, 0, 0]),
            o: stat(100),
          } as unknown as Transform,
        } as Partial<Layer>),
        layer({ ind: 2, parent: 1, ks: ks({ a: child.a, p: child.p, r: child.r }) }),
      ]
      const ours = layerCompMatrix(layers, layers[1], 0)
      const ref = lottieLocal3({
        ...child,
        s: [100, 100, 100],
        rx: 0,
        ry: 0,
        rz: 0,
        or: [0, 0, 0],
        sk: 0,
        sa: 0,
        twoD: true,
      }).times(lottieLocal3(parentV))
      for (const [x, y] of [
        [0, 0],
        [15, -7],
      ]) {
        const a = applyToPoint(ours, x, y)
        const b = ref.apply(x, y)
        expect(a.x).toBeCloseTo(b.x, 6)
        expect(a.y).toBeCloseTo(b.y, 6)
      }
    }
  })

  it('never produces NaN from broken values', () => {
    const t = { p: stat([NaN, 'x']), s: stat([]), r: stat(NaN) } as unknown as Transform
    const m = transformMatrix(t, 0)
    expect(m.every(Number.isFinite)).toBe(true)
  })
})

describe('auto-orient', () => {
  const moving: Transform = {
    p: {
      a: 1,
      k: [
        { t: 0, s: [0, 0, 0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 10, s: [100, 100, 0] },
      ],
    },
  } as unknown as Transform

  it('follows the direction of travel (before, during and after the keyframes)', () => {
    expect(autoOrientAngle(moving.p, 5)).toBeCloseTo(45, 4)
    expect(autoOrientAngle(moving.p, -5)).toBeCloseTo(45, 4)
    expect(autoOrientAngle(moving.p, 50)).toBeCloseTo(45, 4)
  })

  it('is zero for static positions', () => {
    expect(autoOrientAngle(stat([1, 2]) as never, 5)).toBe(0)
    expect(autoOrientAngle(undefined, 5)).toBe(0)
  })

  it('is applied only to layers with ao: 1', () => {
    const doc = anim([layer({ ks: moving }), layer({ ks: moving, ao: 1 } as Partial<Layer>)])
    const plain = layerCompMatrix(doc.layers, doc.layers[0], 5)
    const oriented = layerCompMatrix(doc.layers, doc.layers[1], 5)
    expectPoint(applyToPoint(plain, 1, 0), 51, 50)
    expectPoint(applyToPoint(oriented, 1, 0), 50 + Math.SQRT1_2, 50 + Math.SQRT1_2)
  })
})

describe('parenting', () => {
  it('applies the parent chain (grandparent · parent · child)', () => {
    const grand = layer({ ind: 1, ks: ks({ p: [100, 0] }) })
    const parent = layer({ ind: 2, parent: 1, ks: ks({ r: 90 }) })
    const child = layer({ ind: 3, parent: 2, ks: ks({ p: [10, 0] }) })
    const doc = anim([child, parent, grand])
    const m = layerCompMatrix(doc.layers, child, 0)
    // child origin at (10, 0) → rotated 90° by the parent → (0, 10) → moved by the grandparent
    expectPoint(applyToPoint(m, 0, 0), 100, 10)
  })

  it('ignores parenting cycles and missing parents', () => {
    const a = layer({ ind: 1, parent: 2, ks: ks({ p: [1, 0] }) })
    const b = layer({ ind: 2, parent: 1, ks: ks({ p: [0, 1] }) })
    const orphan = layer({ ind: 3, parent: 99, ks: ks({ p: [5, 5] }) })
    const doc = anim([a, b, orphan])
    expectPoint(applyToPoint(layerCompMatrix(doc.layers, a, 0), 0, 0), 1, 1)
    expectPoint(applyToPoint(layerCompMatrix(doc.layers, orphan, 0), 0, 0), 5, 5)
  })
})

describe('placements', () => {
  const inner = layer({ ind: 1, ks: ks({ p: [10, 20] }), ip: 0, op: 50 })
  const precompA = {
    id: 'comp_a',
    layers: [inner],
  }
  const instance = (p: number[], st: number, extra: Partial<PrecompLayer> = {}): PrecompLayer =>
    ({
      ty: 0,
      refId: 'comp_a',
      w: 100,
      h: 100,
      ip: 0,
      op: 100,
      st,
      ks: ks({ p, s: [50, 50] }),
      ...extra,
    }) as PrecompLayer

  it('root layers have exactly one placement', () => {
    const doc = anim([layer({ ks: ks({ p: [5, 6] }) })])
    const pl = layerPlacements(doc, ['layers', 0], 12)
    expect(pl).toHaveLength(1)
    expect(pl[0].frame).toBe(12)
    expect(pl[0].visible).toBe(true)
    expectPoint(applyToPoint(pl[0].matrix, 0, 0), 5, 6)
  })

  it('precomp children get one placement per instance, with mapped time', () => {
    const doc = anim([instance([100, 100], 0), instance([300, 300], 40)], [precompA])
    const pl = layerPlacements(doc, ['assets', 0, 'layers', 0], 45)
    expect(pl).toHaveLength(2)
    // instance 1: inner frame 45, scale 50% → (10,20) → (5,10) + (100,100)
    expect(pl[0].frame).toBe(45)
    expectPoint(applyToPoint(pl[0].matrix, 0, 0), 105, 110)
    // instance 2 starts at 40: inner frame 5
    expect(pl[1].frame).toBe(5)
    expectPoint(applyToPoint(pl[1].matrix, 0, 0), 305, 310)
  })

  it('time stretch and time remap map the inner frame like lottie-web', () => {
    const stretched = instance([0, 0], 10, { sr: 2 })
    const remapped = instance([0, 0], 10, {
      tm: {
        a: 1,
        k: [
          { t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
          { t: 30, s: [1] },
        ],
      },
    })
    const doc = anim([stretched, remapped], [precompA])
    const pl = layerPlacements(doc, ['assets', 0, 'layers', 0], 30)
    expect(pl[0].frame).toBe(10) // (30 − 10) / 2
    expect(pl[1].frame).toBeCloseTo(30, 6) // tm = 1 s at fr 30, st ignored
  })

  it('visibility follows ranges and hidden flags along the chain', () => {
    const doc = anim(
      [instance([0, 0], 0, { ip: 0, op: 20 }), instance([0, 0], 0, { hd: true })],
      [precompA],
    )
    const at10 = layerPlacements(doc, ['assets', 0, 'layers', 0], 10)
    expect(at10.map((p) => p.visible)).toEqual([true, false])
    const at30 = layerPlacements(doc, ['assets', 0, 'layers', 0], 30)
    expect(at30[0].visible).toBe(false) // precomp out of range
    const at60 = layerPlacements(doc, ['assets', 0, 'layers', 0], 60)
    expect(at60.every((p) => !p.visible)).toBe(true) // inner layer op = 50
  })

  it('hidden layers keep inRange (their anchor can be shown) but are not visible', () => {
    const doc = anim(
      [layer({ hd: true, ks: ks({ p: [1, 2] }) }), instance([0, 0], 0, { hd: true })],
      [precompA],
    )
    const own = layerPlacements(doc, ['layers', 0], 10)[0]
    expect(own.visible).toBe(false)
    expect(own.inRange).toBe(true)
    // Children of a hidden precomp are not rendered at all.
    const child = layerPlacements(doc, ['assets', 0, 'layers', 0], 10)[0]
    expect(child.visible).toBe(false)
    expect(child.inRange).toBe(false)
    const anchor = anchorPoints(doc, ['layers', 0], 10)[0]
    expect(anchor.inRange).toBe(true)
    expect(anchor.visible).toBe(false)
  })

  it('nested precomps multiply instances', () => {
    const outerAsset = {
      id: 'comp_b',
      layers: [instance([0, 0], 0), instance([50, 0], 0)],
    }
    const doc = anim(
      [
        { ...instance([0, 0], 0), refId: 'comp_b' } as PrecompLayer,
        { ...instance([200, 0], 0), refId: 'comp_b' } as PrecompLayer,
      ],
      [precompA, outerAsset],
    )
    expect(layerPlacements(doc, ['assets', 0, 'layers', 0], 1)).toHaveLength(4)
  })

  it('self-referencing precomps terminate', () => {
    const loop = { id: 'comp_a', layers: [instance([0, 0], 0)] }
    const doc = anim([instance([0, 0], 0)], [loop])
    const pl = layerPlacements(doc, ['assets', 0, 'layers', 0], 1)
    expect(pl.length).toBeLessThanOrEqual(64)
  })

  it('unused precomp assets have no placements', () => {
    const doc = anim([], [precompA])
    expect(layerPlacements(doc, ['assets', 0, 'layers', 0], 0)).toEqual([])
    expect(layerPlacements(doc, ['layers', 9], 0)).toEqual([])
    expect(layerPlacements(doc, ['assets', 0], 0)).toEqual([])
  })
})

describe('shape groups and anchors', () => {
  const group = {
    ty: 'gr',
    nm: 'Group',
    it: [
      { ty: 'rc', p: stat([0, 0]), s: stat([10, 10]), r: stat(0) },
      {
        ty: 'gr',
        it: [{ ty: 'tr', ...ks({ p: [5, 0] }) }],
      },
      { ty: 'tr', ...ks({ a: [1, 1], p: [20, 20], s: [200, 200] }) },
    ],
  }
  const shapeLayer = {
    ty: 4,
    ip: 0,
    op: 100,
    st: 0,
    ks: ks({ p: [100, 100] }),
    shapes: [group],
  } as unknown as ShapeLayer

  it('group placements include the group transforms', () => {
    const doc = anim([shapeLayer])
    const pl = nodePlacements(doc, ['layers', 0, 'shapes', 0], 0)
    expect(pl).toHaveLength(1)
    // content (1,1) is the group's anchor → group position (20,20) → layer (120,120)
    expectPoint(applyToPoint(pl[0].matrix, 1, 1), 120, 120)
    const nested = nodePlacements(doc, ['layers', 0, 'shapes', 0, 'it', 1], 0)
    expectPoint(
      applyToPoint(nested[0].matrix, 0, 0),
      100 + 20 + (5 - 1) * 2,
      100 + 20 + (0 - 1) * 2,
    )
  })

  it('hidden groups hide their content; a hidden target stays in range', () => {
    const hiddenGroup = { ...group, hd: true }
    const doc = anim([{ ...shapeLayer, shapes: [hiddenGroup] } as unknown as ShapeLayer])
    const own = nodePlacements(doc, ['layers', 0, 'shapes', 0], 0)[0]
    expect(own.visible).toBe(false)
    expect(own.inRange).toBe(true)
    const inside = nodePlacements(doc, ['layers', 0, 'shapes', 0, 'it', 1], 0)[0]
    expect(inside.visible).toBe(false)
    expect(inside.inRange).toBe(false)
    const item = nodePlacements(doc, ['layers', 0, 'shapes', 0, 'it', 0], 0)[0]
    expect(item.inRange).toBe(false)
  })

  it('non-group items use their containing group coordinates', () => {
    const doc = anim([shapeLayer])
    const rect = nodePlacements(doc, ['layers', 0, 'shapes', 0, 'it', 0], 0)
    const grp = nodePlacements(doc, ['layers', 0, 'shapes', 0], 0)
    expect(rect[0].matrix).toEqual(grp[0].matrix)
    expect(nodePlacements(doc, ['layers', 0, 'shapes', 5], 0)).toEqual([])
    expect(nodePlacements(doc, ['layers', 0, 'ks'], 0)).toEqual([])
  })

  it('anchor points land on the transformed anchor', () => {
    const doc = anim([layer({ ks: ks({ a: [30, 40], p: [200, 100], r: 45 }) }), shapeLayer])
    expectPoint(anchorPoints(doc, ['layers', 0], 0)[0], 200, 100)
    expectPoint(anchorPoints(doc, ['layers', 1, 'shapes', 0], 0)[0], 120, 120)
  })

  it('precomp frame size falls back to the document size', () => {
    const doc = anim([])
    expect(precompFrameSize(doc, { w: 10, h: 20 } as PrecompLayer)).toEqual({
      width: 10,
      height: 20,
    })
    expect(precompFrameSize(doc, {} as PrecompLayer)).toEqual({ width: 512, height: 512 })
  })
})

describe('matrix sanity', () => {
  it('Mat2D is compatible with SVG matrix layout', () => {
    const m: Mat2D = transformMatrix(ks({ p: [7, 8] }), 0)
    expect(m[4]).toBe(7)
    expect(m[5]).toBe(8)
  })
})
