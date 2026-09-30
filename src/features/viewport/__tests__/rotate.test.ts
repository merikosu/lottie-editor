import { describe, expect, it } from 'vitest'
import { getAt, type NodePath } from '@/lottie/path'
import type { Layer, ShapeItem } from '@/lottie/types'
import { rotateNode, rotatePivot, rotationAngle, unwrapAngle } from '../lib/rotate'
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
} from './gizmo-fixtures'

/** Screen angle (degrees) of b around a. */
const screenAngle = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI

describe('rotationAngle / unwrapAngle', () => {
  it('measures the pointer around the pivot in the frame the rotation turns', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0] }), shapes: [rect] })])
    const s = setup(doc, ['layers', 0])
    const a = s.target.anchor
    expect(rotationAngle(s.target, s.frame, a, { x: 300, y: 256 })).toBeCloseTo(0, 9)
    expect(rotationAngle(s.target, s.frame, a, { x: 256, y: 300 })).toBeCloseTo(90, 9)
    expect(rotationAngle(s.target, s.frame, a, { x: 256, y: 256 })).toBeNull()
  })

  it('unwraps across ±180° so full turns add up', () => {
    expect(unwrapAngle(170, -175)).toBe(185)
    expect(unwrapAngle(-170, 175)).toBe(-185)
    expect(unwrapAngle(350, 5)).toBe(365)
    expect(unwrapAngle(0, 30)).toBe(30)
  })
})

describe('rotateNode', () => {
  it('turns about the anchor point: only the rotation changes', () => {
    const doc = anim([
      layer({ ks: ks({ a: [10, 5, 0], p: [200, 220, 0], r: 12 }), shapes: [rect] }),
    ])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path)
    const edit = rotateNode(s.target, s.frame, 'anchor', 33.333, false)
    expect(edit.values).toEqual({ rotation: 45.33 })
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    expectNear(at(worldIn(next, path, s), { x: 10, y: 5 }), { x: 200, y: 220 })
  })

  it('turns about the box center with Alt (the position moves the center back)', () => {
    const doc = anim([layer({ ks: ks({ a: [40, 20, 0], p: [200, 220, 0] }), shapes: [rect] })])
    const path: NodePath = ['layers', 0]
    const s = setup(doc, path)
    const c = rotatePivot(s.target, s.frame, 'center')
    const edit = rotateNode(s.target, s.frame, 'center', 90, false)
    expect(edit.values.position).toBeDefined()
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    expectNear(at(worldIn(next, path, s), c), at(s.frame.world, c))
  })

  it('snaps the resulting rotation to 15° with Shift', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0], r: 7 }), shapes: [rect] })])
    const s = setup(doc, ['layers', 0])
    expect(rotateNode(s.target, s.frame, 'anchor', 0, true).rotation).toBe(0)
    expect(rotateNode(s.target, s.frame, 'anchor', 16, true).rotation).toBe(30)
    expect(rotateNode(s.target, s.frame, 'anchor', -30, true).rotation).toBe(-30)
  })

  it('follows the pointer on screen under rotated, scaled and flipped parents', () => {
    const rnd = random(5)
    for (let i = 0; i < 40; i++) {
      const flipX = rnd(0, 1) > 0.5 ? -1 : 1
      const flipNode = rnd(0, 1) > 0.5 ? -1 : 1
      const doc = anim([
        layer({
          ty: 3,
          ind: 1,
          ks: ks({
            p: [rnd(100, 400), rnd(100, 400), 0],
            s: [rnd(50, 150) * flipX, rnd(50, 150), 100],
            r: rnd(-180, 180),
          }),
        }),
        layer({
          ind: 2,
          parent: 1,
          ks: ks({
            a: [rnd(-30, 30), rnd(-20, 20), 0],
            p: [rnd(-50, 50), rnd(-50, 50), 0],
            s: [rnd(50, 150) * flipNode, rnd(50, 150), 100],
            r: rnd(-90, 90),
            sk: rnd(0, 1) > 0.5 ? rnd(-30, 30) : undefined,
            sa: rnd(-60, 60),
          }),
          shapes: [rect],
        }),
      ])
      const path: NodePath = ['layers', 1]
      const s = setup(doc, path)
      for (const pivot of ['anchor', 'center'] as const) {
        const c = rotatePivot(s.target, s.frame, pivot)
        const cw = at(s.frame.world, c)
        // The pointer starts on a content point and moves around the pivot on screen.
        const grab = { x: BOX.x + BOX.width, y: BOX.y }
        const start = at(s.frame.world, grab)
        const turn = rnd(-150, 150)
        const rad = (turn * Math.PI) / 180
        const dx = start.x - cw.x
        const dy = start.y - cw.y
        const pointer = {
          x: cw.x + dx * Math.cos(rad) - dy * Math.sin(rad),
          y: cw.y + dx * Math.sin(rad) + dy * Math.cos(rad),
        }
        const from = rotationAngle(s.target, s.frame, c, start)
        const to = rotationAngle(s.target, s.frame, c, pointer)
        if (from === null || to === null) continue
        const edit = rotateNode(s.target, s.frame, pivot, unwrapAngle(0, to - from), false)
        const next = expectDrawnAsPredicted(doc, path, s, edit)
        const after = worldIn(next, path, s)
        // The pivot stays; the grabbed point lies on the ray from the pivot to the pointer.
        expectNear(at(after, c), cw, 0.03)
        const moved = at(after, grab)
        const off = screenAngle(cw, moved) - screenAngle(cw, pointer)
        expect(Math.abs((((off % 360) + 540) % 360) - 180)).toBeLessThan(0.05)
      }
    }
  })

  it('turns a tilted 3D layer in its own plane: the grabbed point follows the pointer', () => {
    const rnd = random(8)
    for (let i = 0; i < 20; i++) {
      const doc = anim([
        layer({
          ddd: 1,
          ks: {
            ...ks({ a: [rnd(-30, 30), rnd(-20, 20), 0], p: [256, 256, 0] }),
            rx: stat(rnd(-50, 50)),
            ry: stat(rnd(-50, 50)),
            rz: stat(rnd(-90, 90)),
            or: stat([0, 0, rnd(-30, 30)]),
          } as Layer['ks'],
          shapes: [rect],
        } as Partial<Layer>),
      ])
      const path: NodePath = ['layers', 0]
      const s = setup(doc, path)
      const c = rotatePivot(s.target, s.frame, 'anchor')
      const cw = at(s.frame.world, c)
      const grab = { x: BOX.x + BOX.width, y: BOX.y + BOX.height }
      const start = at(s.frame.world, grab)
      const turn = (rnd(-120, 120) * Math.PI) / 180
      const pointer = {
        x: cw.x + (start.x - cw.x) * Math.cos(turn) - (start.y - cw.y) * Math.sin(turn),
        y: cw.y + (start.x - cw.x) * Math.sin(turn) + (start.y - cw.y) * Math.cos(turn),
      }
      const from = rotationAngle(s.target, s.frame, c, start)
      const to = rotationAngle(s.target, s.frame, c, pointer)
      if (from === null || to === null) continue
      const edit = rotateNode(s.target, s.frame, 'anchor', unwrapAngle(0, to - from), false)
      const next = expectDrawnAsPredicted(doc, path, s, edit, 0.05)
      const moved = at(worldIn(next, path, s), grab)
      const off = screenAngle(cw, moved) - screenAngle(cw, pointer)
      expect(Math.abs((((off % 360) + 540) % 360) - 180)).toBeLessThan(0.1)
    }
  })

  it('writes rz for 3D layers and keys an animated rotation at the playhead', () => {
    const threeD = anim([
      layer({
        ddd: 1,
        ks: {
          ...ks({ p: [256, 256, 0] }),
          rx: stat(0),
          ry: stat(0),
          rz: stat(10),
          or: stat([0, 0, 0]),
        } as Layer['ks'],
        shapes: [rect],
      } as Partial<Layer>),
    ])
    const s = setup(threeD, ['layers', 0])
    expect(s.target.rotationKey).toBe('rz')
    const edit = rotateNode(s.target, s.frame, 'anchor', 20, false)
    const next = expectDrawnAsPredicted(threeD, ['layers', 0], s, edit)
    expect(getAt(next, ['layers', 0, 'ks', 'rz', 'k'])).toBe(30)

    const animated = anim([
      layer({
        ks: {
          ...ks({ p: [256, 256, 0] }),
          r: {
            a: 1,
            k: [
              { t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
              { t: 20, s: [90] },
            ],
          },
        } as Layer['ks'],
        shapes: [rect],
      }),
    ])
    const t = setup(animated, ['layers', 0], 5)
    const turned = rotateNode(t.target, t.frame, 'anchor', 10, false)
    const written = expectDrawnAsPredicted(animated, ['layers', 0], t, turned)
    const keys = getAt<{ t: number; s: number[] }[]>(written, ['layers', 0, 'ks', 'r', 'k']) ?? []
    expect(keys.map((k) => k.t)).toEqual([0, 5, 20])
    expect(keys[1].s[0]).toBeCloseTo(t.target.rotation + 10, 2)
  })

  it('rotates a shape group through its tr, keeping a static [r] array form', () => {
    const doc = anim([
      layer({
        ks: ks({ p: [256, 256, 0], s: [100, -100, 100] }),
        shapes: [
          group([rect], { ...tr({ p: [20, 0] }), r: stat([5]) } as unknown as ShapeItem),
        ] as ShapeItem[],
      }),
    ])
    const path: NodePath = ['layers', 0, 'shapes', 0]
    const s = setup(doc, path)
    const edit = rotateNode(s.target, s.frame, 'center', 40, false)
    const next = expectDrawnAsPredicted(doc, path, s, edit)
    expect(getAt(next, [...path, 'it', 1, 'r', 'k'])).toEqual([45])
  })

  it('does nothing without a change', () => {
    const doc = anim([layer({ ks: ks({ p: [256, 256, 0], r: 30 }), shapes: [rect] })])
    const s = setup(doc, ['layers', 0])
    expect(rotateNode(s.target, s.frame, 'center', 0, false).values).toEqual({})
    expect(rotateNode(s.target, s.frame, 'center', 0.001, false).values).toEqual({})
  })
})
