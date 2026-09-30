import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { getAt, type NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'
import { HANDLE_IDS, HANDLE_UV, type HandleId } from '../lib/gizmo'
import { artboardLines } from '../lib/snap'
import { resizeNode, resizePivot } from '../lib/resize'
import {
  BOX,
  anim,
  at,
  expectDrawnAsPredicted,
  expectNear,
  group,
  ks,
  layer,
  random,
  rect,
  setup,
  stat,
  tr,
  worldIn,
  write,
  type Setup,
} from './gizmo-fixtures'

const OPPOSITE = { pivot: 'opposite', uniform: false } as const

/** Content point of a handle on the box. */
const handleAt = (s: Setup, h: HandleId) => {
  const [u, v] = HANDLE_UV[h]
  const { box } = s.frame
  return { x: box.x + u * box.width, y: box.y + v * box.height }
}

/** Parent chain + node with random rotation, scale (flips included), skew and anchor. */
function randomDoc(rnd: ReturnType<typeof random>): Animation {
  const parent = layer({
    ty: 3,
    ind: 1,
    ks: ks({
      a: [rnd(-40, 40), rnd(-40, 40), 0],
      p: [rnd(100, 400), rnd(100, 400), 0],
      s: [rnd(40, 200) * (rnd(0, 1) > 0.7 ? -1 : 1), rnd(40, 200), 100],
      r: rnd(-180, 180),
    }),
  })
  const node = layer({
    ind: 2,
    parent: 1,
    ks: ks({
      a: [rnd(-60, 60), rnd(-40, 40), 0],
      p: [rnd(-100, 100), rnd(-100, 100), 0],
      s: [rnd(30, 250) * (rnd(0, 1) > 0.7 ? -1 : 1), rnd(30, 250), 100],
      r: rnd(-360, 360),
      sk: rnd(0, 1) > 0.5 ? rnd(-40, 40) : undefined,
      sa: rnd(-90, 90),
    }),
    shapes: [rect],
  })
  return anim([parent, node])
}

describe('resizeNode', () => {
  it('keeps the opposite handle in place and brings the dragged one to the pointer', () => {
    const rnd = random(11)
    for (let i = 0; i < 40; i++) {
      const doc = randomDoc(rnd)
      const path: NodePath = ['layers', 1]
      const s = setup(doc, path)
      for (const handle of HANDLE_IDS) {
        const delta = { x: rnd(-60, 60), y: rnd(-60, 60) }
        const edit = resizeNode(s.target, s.frame, handle, delta, OPPOSITE)
        const next = expectDrawnAsPredicted(doc, path, s, edit)
        const after = worldIn(next, path, s)
        // The opposite handle (the pivot) does not move.
        const [u, v] = HANDLE_UV[handle]
        const opposite = {
          x: BOX.x + (1 - u) * BOX.width,
          y: BOX.y + (1 - v) * BOX.height,
        }
        expectNear(at(after, opposite), at(s.frame.world, opposite), 0.02, `pivot ${handle}`)
        if (u !== 0.5 && v !== 0.5) {
          // A corner lands exactly under the pointer.
          const h = at(s.frame.world, handleAt(s, handle))
          expectNear(at(after, handleAt(s, handle)), { x: h.x + delta.x, y: h.y + delta.y }, 0.05)
        }
      }
    }
  })

  it('moves only the dragged edge: the edge handle slides along its own axis', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0], r: 30 }), shapes: [rect] })])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path)
    const edit = resizeNode(s.target, s.frame, 'e', { x: 40, y: 0 }, OPPOSITE)
    // Only the x scale changes; the left edge stays.
    expect(edit.scale[1]).toBe(100)
    expect(edit.scale[0]).toBeGreaterThan(100)
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    const after = worldIn(next, path, s)
    for (const p of [
      { x: BOX.x, y: BOX.y },
      { x: BOX.x, y: BOX.y + BOX.height },
    ])
      expectNear(at(after, p), at(s.frame.world, p))
    // The drag is projected on the rotated x axis: 40 px right → 40·cos 30° along it.
    expect(edit.scale[0]).toBeCloseTo(100 + (40 * Math.cos(Math.PI / 6) * 100) / BOX.width, 1)
  })

  it('keeps proportions with Shift (corners follow the diagonal, edges scale both axes)', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0], s: [50, 120, 100] }), shapes: [rect] })])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path)
    for (const handle of ['se', 'nw', 'e', 'n'] as const) {
      const edit = resizeNode(
        s.target,
        s.frame,
        handle,
        { x: 37, y: -11 },
        {
          pivot: 'opposite',
          uniform: true,
        },
      )
      expect(edit.scale[0] / edit.scale[1]).toBeCloseTo(50 / 120, 3)
      expectDrawnAsPredicted(doc, path, s, edit)
    }
    // Along the diagonal (the box is 50 × 72 on the artboard) the corner follows the pointer.
    const edit = resizeNode(
      s.target,
      s.frame,
      'se',
      { x: 25, y: 36 },
      {
        pivot: 'opposite',
        uniform: true,
      },
    )
    const after = worldIn(write(doc, s, edit), path, s)
    const se = at(s.frame.world, handleAt(s, 'se'))
    expectNear(at(after, handleAt(s, 'se')), { x: se.x + 25, y: se.y + 36 }, 0.05)
  })

  it('flips when the handle crosses the pivot', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0] }), shapes: [rect] })])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path)
    // The box is 100 wide: 150 px left puts the right edge 50 px left of the left edge.
    const edit = resizeNode(s.target, s.frame, 'e', { x: -150, y: 0 }, OPPOSITE)
    expect(edit.scale[0]).toBeCloseTo(-50, 5)
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    const after = worldIn(next, path, s)
    expectNear(at(after, { x: 50, y: 0 }), { x: 156, y: 256 })
    expectNear(at(after, { x: -50, y: 0 }), { x: 206, y: 256 })
  })

  it('never collapses a side below the minimum size', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0] }), shapes: [rect] })])
    const s = setup(doc, ['layers', 0])
    const edit = resizeNode(s.target, s.frame, 'e', { x: -100, y: 0 }, { ...OPPOSITE, minSize: 2 })
    expect(Math.abs(edit.scale[0])).toBeCloseTo(2, 5)
    expect(edit.scale[0]).not.toBe(0)
  })

  it('with Alt scales about the anchor point of a layer (the position does not change)', () => {
    const doc = anim([
      layer({ ks: ks({ a: [20, -10, 0], p: [200, 180, 0], r: -25 }), shapes: [rect] }),
    ])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path)
    const edit = resizeNode(
      s.target,
      s.frame,
      'se',
      { x: 30, y: 30 },
      {
        pivot: 'anchor',
        uniform: false,
      },
    )
    expect(edit.values.position).toBeUndefined()
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    expectNear(at(worldIn(next, path, s), { x: 20, y: -10 }), { x: 200, y: 180 })
  })

  it('with Alt scales a group about its box center', () => {
    const doc = anim([
      layer({
        ks: ks({ p: [256, 256, 0] }),
        shapes: [group([rect], tr({ p: [10, 20], a: [0, 0] }))] as ShapeItem[],
      }),
    ])
    const path: NodePath = ['layers', 0, 'shapes', 0]
    const s = setup(doc, path)
    const c = resizePivot(s.target, s.frame, 'e', 'anchor')
    expect(c).toEqual({ x: 0, y: 0 })
    const edit = resizeNode(
      s.target,
      s.frame,
      'e',
      { x: 20, y: 0 },
      {
        pivot: 'anchor',
        uniform: false,
      },
    )
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    expectNear(at(worldIn(next, path, s), c), at(s.frame.world, c))
    // Both edges moved by 20 (the box grew by 40 around its center).
    expect(edit.scale[0]).toBeCloseTo(140, 5)
  })

  it('uses the box center on an axis where the anchor lies on the dragged edge', () => {
    const doc = anim([layer({ ks: ks({ a: [50, 0, 0], p: [256, 256, 0] }), shapes: [rect] })])
    const s = setup(doc, ['layers', 0])
    expect(resizePivot(s.target, s.frame, 'e', 'anchor')).toEqual({ x: 0, y: 0 })
    expect(resizePivot(s.target, s.frame, 'n', 'anchor')).toEqual({ x: 50, y: 0 })
    // Anchor at the bottom (like a bouncing ball): x still scales about it, y about the center.
    const ball = anim([layer({ ks: ks({ a: [20, 30, 0], p: [256, 256, 0] }), shapes: [rect] })])
    const b = setup(ball, ['layers', 0])
    expect(resizePivot(b.target, b.frame, 'se', 'anchor')).toEqual({ x: 20, y: 0 })
    const edit = resizeNode(
      b.target,
      b.frame,
      'se',
      { x: 15, y: 12 },
      {
        pivot: 'anchor',
        uniform: false,
      },
    )
    const next = expectDrawnAsPredicted(ball, ['layers', 0], b, edit)
    expectNear(
      at(worldIn(next, ['layers', 0], b), { x: 20, y: 0 }),
      at(b.frame.world, { x: 20, y: 0 }),
    )
  })

  it('edits the transform of a shape group (nested, inside a parented layer)', () => {
    const inner = group([rect], tr({ p: [30, 0], s: [80, 120], r: 45, a: [5, 5] }))
    const outer = group([inner], tr({ p: [-20, 10], r: -30, s: [150, 90] }))
    const doc = anim([
      layer({ ty: 3, ind: 1, ks: ks({ p: [256, 256, 0], s: [-100, 100, 100], r: 20 }) }),
      layer({ ind: 2, parent: 1, ks: ks({ p: [15, -5, 0] }), shapes: [outer] as ShapeItem[] }),
    ])
    const path: NodePath = ['layers', 1, 'shapes', 0, 'it', 0]
    const s = setup(doc, path)
    expect(s.target.transformPath).toEqual([...path, 'it', 1])
    expect(s.target.dims).toBe(2)
    for (const handle of ['nw', 's', 'e'] as const) {
      const edit = resizeNode(s.target, s.frame, handle, { x: 12, y: -18 }, OPPOSITE)
      const next = expectDrawnAsPredicted(doc, path, s, edit)
      expect(getAt<number[]>(next, [...path, 'it', 1, 's', 'k'])).toHaveLength(2)
    }
  })

  it('keeps a separated position separated and only keys the dimensions that change', () => {
    const doc = anim([
      layer({
        ks: {
          ...ks({ a: [0, 0, 0] }),
          p: {
            s: true,
            x: {
              a: 1,
              k: [
                { t: 0, s: [100], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
                { t: 20, s: [300] },
              ],
            },
            y: stat(200),
          },
        } as Layer['ks'],
        shapes: [rect],
      }),
    ])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path, 10)
    // Dragging the top edge only moves the position's y (the box is not rotated).
    const edit = resizeNode(s.target, s.frame, 'n', { x: 0, y: -30 }, OPPOSITE)
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    const p = getAt<Record<string, unknown>>(next, ['layers', 0, 'ks', 'p'])
    expect(p?.s).toBe(true)
    // x keeps its two keys; y (static) got its new value.
    expect((getAt<unknown[]>(next, ['layers', 0, 'ks', 'p', 'x', 'k']) ?? []).length).toBe(2)
    expect(getAt(next, ['layers', 0, 'ks', 'p', 'y', 'k'])).toBe(185)
  })

  it('auto-keys animated scale and position at the playhead', () => {
    const doc = anim([
      layer({
        ks: {
          ...ks(),
          p: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
              { t: 30, s: [300, 100, 0] },
            ],
          },
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 100], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
              { t: 30, s: [200, 200, 100] },
            ],
          },
        } as Layer['ks'],
        shapes: [rect],
      }),
    ])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path, 15)
    const edit = resizeNode(s.target, s.frame, 'se', { x: 20, y: 10 }, OPPOSITE)
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    const times = (p: string) =>
      (getAt<{ t: number }[]>(next, ['layers', 0, 'ks', p, 'k']) ?? []).map((k) => k.t)
    expect(times('s')).toEqual([0, 15, 30])
    expect(times('p')).toEqual([0, 15, 30])
    // The keys around it are untouched.
    expect(getAt(next, ['layers', 0, 'ks', 's', 'k', 2, 's'])).toEqual([200, 200, 100])
  })

  it('creates a missing scale property', () => {
    const doc = anim([layer({ ks: { p: stat([256, 256, 0]) } as Layer['ks'], shapes: [rect] })])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path)
    const edit = resizeNode(s.target, s.frame, 'se', { x: 50, y: 30 }, OPPOSITE)
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    expect(getAt(next, ['layers', 0, 'ks', 's', 'k'])).toEqual([150, 150, 100])
  })

  it('works in each instance of a precomp shown several times (st / sr offsets)', () => {
    const inner = layer({
      ind: 1,
      ks: {
        ...ks({ p: [100, 100, 0] }),
        s: {
          a: 1,
          k: [
            { t: 0, s: [100, 100, 100], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
            { t: 40, s: [50, 50, 100] },
          ],
        },
      } as Layer['ks'],
      shapes: [rect],
    })
    const doc = anim(
      [
        layer({ ty: 0, refId: 'comp', ind: 1, st: 0, ks: ks({ p: [0, 0, 0] }) } as Partial<Layer>),
        layer({
          ty: 0,
          refId: 'comp',
          ind: 2,
          st: 10,
          sr: 2,
          ks: ks({ p: [300, 200, 0], s: [-150, 80, 100], r: 60 }),
        } as Partial<Layer>),
      ],
      [{ id: 'comp', layers: [inner] }] as Animation['assets'],
    )
    const path: NodePath = ['assets', 0, 'layers', 0]
    // Root frame 30: the second instance shows its composition at (30 − 10) / 2 = 10.
    const s = setup(doc, path, 30, 1)
    expect(s.target.frame).toBe(10)
    const edit = resizeNode(s.target, s.frame, 'ne', { x: -15, y: 25 }, OPPOSITE)
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    const sw = { x: BOX.x, y: BOX.y + BOX.height }
    expectNear(at(worldIn(next, path, s), sw), at(s.frame.world, sw))
    const keys = getAt<{ t: number }[]>(next, [...path, 'ks', 's', 'k']) ?? []
    expect(keys.map((k) => k.t)).toEqual([0, 10, 40])
  })

  it('works on 3D layers (tilted by rx / ry, flattened like lottie-web) and under 3D parents', () => {
    const rnd = random(21)
    for (let i = 0; i < 20; i++) {
      const tilted = (extra: object) =>
        ({
          ...ks({
            a: [rnd(-30, 30), rnd(-20, 20), rnd(-20, 20)],
            p: [rnd(-60, 60), rnd(-60, 60), rnd(-50, 50)],
          }),
          rx: stat(rnd(-60, 60)),
          ry: stat(rnd(-60, 60)),
          rz: stat(rnd(-180, 180)),
          or: stat([rnd(-20, 20), rnd(-20, 20), rnd(-20, 20)]),
          ...extra,
        }) as Layer['ks']
      const doc = anim([
        layer({ ty: 3, ind: 1, ddd: 1, ks: tilted({ p: stat([256, 256, 0]) }) } as Partial<Layer>),
        layer({ ind: 2, parent: 1, ddd: 1, ks: tilted({}), shapes: [rect] } as Partial<Layer>),
      ])
      const path: NodePath = ['layers', 1]
      const s = setup(doc, path)
      expect(s.target.rotationKey).toBe('rz')
      for (const handle of ['se', 'n', 'w'] as const) {
        const edit = resizeNode(
          s.target,
          s.frame,
          handle,
          { x: rnd(-20, 20), y: rnd(-20, 20) },
          OPPOSITE,
        )
        const next = expectDrawnAsPredicted(doc, path, s, edit, 0.05)
        const [u, v] = HANDLE_UV[handle]
        const opposite = { x: BOX.x + (1 - u) * BOX.width, y: BOX.y + (1 - v) * BOX.height }
        expectNear(at(worldIn(next, path, s), opposite), at(s.frame.world, opposite), 0.05)
      }
    }
  })

  it('does nothing for a drag that comes back to where it started', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0], r: 33 }), shapes: [rect] })])
    const s = setup(doc, ['layers', 0])
    const edit = resizeNode(s.target, s.frame, 'sw', { x: 0, y: 0 }, OPPOSITE)
    expect(edit.values).toEqual({})
  })

  it('snaps the dragged edge to lines (axis-aligned boxes only)', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0] }), shapes: [rect] })])
    const s = setup(doc, ['layers', 0])
    // Right edge at x = 306; the artboard's right edge is at 512. Drag it to 509.
    const snap = { lines: artboardLines(512, 512), threshold: 6 }
    const edit = resizeNode(s.target, s.frame, 'e', { x: 203, y: 0 }, { ...OPPOSITE, snap })
    expect(at(edit.world, { x: 50, y: 0 }).x).toBeCloseTo(512, 6)
    expect(edit.guides.x?.at).toBe(512)
    // Rotated boxes do not snap.
    const turned = anim([layer({ ks: ks({ p: [256, 256, 0], r: 10 }), shapes: [rect] })])
    const t = setup(turned, ['layers', 0])
    const free = resizeNode(t.target, t.frame, 'e', { x: 203, y: 0 }, { ...OPPOSITE, snap })
    expect(free.guides.x).toBeNull()
  })

  it('snaps with quarter turns (content x runs along the artboard y)', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0], r: 90 }), shapes: [rect] })])
    const s = setup(doc, ['layers', 0])
    // The 'e' handle is at the bottom (y = 306); drag it to 509 → snaps to 512 (artboard y).
    const snap = { lines: artboardLines(512, 512), threshold: 6 }
    const edit = resizeNode(s.target, s.frame, 'e', { x: 0, y: 203 }, { ...OPPOSITE, snap })
    expect(at(edit.world, { x: 50, y: 0 }).y).toBeCloseTo(512, 6)
    expect(edit.guides.y?.at).toBe(512)
  })

  it('resizes a line (a box without height) along its length only', () => {
    const doc = anim([
      layer({ ks: ks({ p: [200, 150, 0], r: 30, a: [10, 0, 0] }), shapes: [rect] }),
    ])
    const path: NodePath = ['layers', 0]
    const line = { x: -50, y: 0, width: 100, height: 0 }
    const s = setup(doc, path, 0, 0, line)
    const edit = resizeNode(s.target, s.frame, 'e', { x: 30, y: -12 }, OPPOSITE)
    expect(edit.values.scale?.[1]).toBe(100)
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    const after = worldIn(next, path, s)
    // The other end stays; the dragged end follows the pointer along the line.
    expectNear(at(after, { x: -50, y: 0 }), at(s.frame.world, { x: -50, y: 0 }))
    const end = at(s.frame.world, { x: 50, y: 0 })
    const along = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) }
    const moved = at(after, { x: 50, y: 0 })
    expect((moved.x - end.x) * along.x + (moved.y - end.y) * along.y).toBeCloseTo(
      30 * along.x - 12 * along.y,
      1,
    )
    // Shift scales across it too (uniformly), about the other end.
    const uniform = resizeNode(
      s.target,
      s.frame,
      'e',
      { x: 30, y: 0 },
      { ...OPPOSITE, uniform: true },
    )
    expect(uniform.values.scale?.[0]).toBe(uniform.values.scale?.[1])
    expectDrawnAsPredicted(doc, path, s, uniform)
  })

  it('keeps the writes exact: repeated resizes do not drift', () => {
    let doc = anim([layer({ ks: ks({ a: [7, 3, 0], p: [256, 256, 0], r: 17 }), shapes: [rect] })])
    const path: NodePath = ['layers', 0]
    const first = setup(doc, path)
    const fixed = at(first.frame.world, { x: BOX.x, y: BOX.y })
    for (let i = 0; i < 10; i++) {
      const s = setup(doc, path)
      const edit = resizeNode(s.target, s.frame, 'se', { x: 3.7, y: -2.1 }, OPPOSITE)
      doc = write(doc, s, edit)
    }
    expectNear(at(worldIn(doc, path, first), { x: BOX.x, y: BOX.y }), fixed, 0.05)
    // Editing a frozen document never mutates it.
    expect(() => produce(doc, () => undefined)).not.toThrow()
  })
})
