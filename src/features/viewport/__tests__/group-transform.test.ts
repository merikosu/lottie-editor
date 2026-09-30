import { describe, expect, it } from 'vitest'
import { chainKey } from '@/features/layers/instances'
import type { NodePath } from '@/lottie/path'
import type { Animation, ShapeItem } from '@/lottie/types'
import { boundsOfPoints, transformRect, type Rect } from '../lib/geometry'
import {
  groupResize,
  groupRotate,
  groupRotationAngle,
  type GroupMember,
} from '../lib/group-transform'
import { applyToPoint, type Mat2D } from '../lib/matrix'
import { artboardLines } from '../lib/snap'
import { applyTransform, planTransform } from '../lib/transform-edit'
import { nodePlacements } from '../lib/transforms'
import { produce } from 'immer'
import { BOX, anim, at, expectNear, group, ks, layer, random, rect, tr } from './gizmo-fixtures'

/** Members for `paths` (first occurrence each), drawn from the document model. */
function members(doc: Animation, paths: NodePath[], frame = 0): GroupMember[] {
  return paths.map((path) => {
    const placement = nodePlacements(doc, path, frame)[0]
    const target = planTransform(doc, path, frame, chainKey(placement.chain))
    if (!target) throw new Error('no target')
    return { target, frame: { box: BOX, world: placement.matrix } }
  })
}

/** Their selection box on the artboard. */
function boxOf(ms: GroupMember[]): Rect {
  const b = boundsOfPoints(ms.flatMap((m) => transformRect(m.frame.box, m.frame.world)))
  if (!b) throw new Error('no box')
  return b
}

function written(doc: Animation, ms: GroupMember[], edits: { values: object }[]): Animation {
  return produce(doc, (d) => {
    ms.forEach((m, i) => applyTransform(d, m.target, edits[i].values))
  })
}

const corners = (r: Rect) => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
]

/** Every member is drawn as E ∘ W (all corners), after writing. */
function expectExact(
  doc: Animation,
  paths: NodePath[],
  ms: GroupMember[],
  e: Mat2D,
  edits: { values: object }[],
) {
  const next = written(doc, ms, edits)
  paths.forEach((path, i) => {
    const after = nodePlacements(next, path, 0)[0].matrix
    for (const p of corners(ms[i].frame.box)) {
      const was = at(ms[i].frame.world, p)
      expectNear(at(after, p), applyToPoint(e, was.x, was.y), 0.05, `${path.join('/')}`)
    }
  })
}

/** A spread of root layers and a group, rotated, scaled, flipped, some parented. */
function scene(rnd: ReturnType<typeof random>, turned: boolean): Animation {
  const r = () => (turned ? rnd(-180, 180) : Math.round(rnd(-2, 2)) * 90)
  return anim([
    layer({
      ks: ks({ p: [rnd(50, 200), rnd(50, 200), 0], r: r(), s: [rnd(40, 150), rnd(40, 150), 100] }),
      shapes: [rect],
    }),
    layer({ ind: 5, ty: 3, ks: ks({ p: [300, 300, 0], r: r(), s: [-80, 80, 100] }) }),
    layer({
      parent: 5,
      ks: ks({ a: [10, 5, 0], p: [rnd(-60, 60), rnd(-60, 60), 0], r: r() }),
      shapes: [rect],
    }),
    layer({
      ks: ks({ p: [rnd(250, 450), rnd(50, 150), 0] }),
      shapes: [
        group(
          [rect],
          tr({ p: [rnd(-20, 20), rnd(-20, 20)], r: r(), s: [rnd(50, 120), rnd(50, 120)] }),
        ),
      ] as ShapeItem[],
    }),
  ])
}

const PATHS: NodePath[] = [
  ['layers', 0],
  ['layers', 2],
  ['layers', 3, 'shapes', 0],
]

describe('groupResize', () => {
  it('scales everything as one, exactly, when uniform (any rotation, parents, flips)', () => {
    const rnd = random(3)
    for (let i = 0; i < 20; i++) {
      const doc = scene(rnd, true)
      const ms = members(doc, PATHS)
      const box = boxOf(ms)
      const edit = groupResize(
        ms,
        box,
        'se',
        { x: rnd(-40, 80), y: rnd(-40, 80) },
        { pivot: 'opposite', uniform: true },
      )
      expectExact(doc, PATHS, ms, edit.world, edit.edits)
      // The opposite corner of the box stays.
      expectNear(applyToPoint(edit.world, box.x, box.y), { x: box.x, y: box.y }, 1e-9)
    }
  })

  it('scales axis-aligned nodes non-uniformly, exactly (quarter turns too)', () => {
    const rnd = random(4)
    for (let i = 0; i < 20; i++) {
      const doc = scene(rnd, false)
      const ms = members(doc, PATHS)
      const box = boxOf(ms)
      for (const handle of ['e', 'n', 'sw'] as const) {
        const edit = groupResize(
          ms,
          box,
          handle,
          { x: rnd(-40, 40), y: rnd(-40, 40) },
          { pivot: 'opposite', uniform: false },
        )
        expectExact(doc, PATHS, ms, edit.world, edit.edits)
      }
    }
  })

  it('never skews a turned node: it scales along its own axes and its center follows', () => {
    const doc = anim([
      layer({ ks: ks({ p: [150, 150, 0], r: 30 }), shapes: [rect] }),
      layer({ ks: ks({ p: [350, 300, 0] }), shapes: [rect] }),
    ])
    const paths: NodePath[] = [
      ['layers', 0],
      ['layers', 1],
    ]
    const ms = members(doc, paths)
    const box = boxOf(ms)
    const edit = groupResize(ms, box, 'e', { x: 100, y: 0 }, { pivot: 'opposite', uniform: false })
    const next = written(doc, ms, edit.edits)
    const after = nodePlacements(next, paths[0], 0)[0].matrix
    // Still a rectangle: its sides stay perpendicular.
    expect(after[0] * after[2] + after[1] * after[3]).toBeCloseTo(0, 6)
    // Its center went where the group's stretch takes it.
    const c0 = applyToPoint(ms[0].frame.world, 0, 0)
    expectNear(applyToPoint(after, 0, 0), applyToPoint(edit.world, c0.x, c0.y), 0.02)
    // The straight node is exact.
    expectExact(doc, [paths[1]], [ms[1]], edit.world, [edit.edits[1]])
  })

  it('mirrors every node when the group flips', () => {
    const doc = anim([
      layer({ ks: ks({ p: [150, 150, 0], r: 30 }), shapes: [rect] }),
      layer({ ks: ks({ p: [350, 300, 0] }), shapes: [rect] }),
    ])
    const paths: NodePath[] = [
      ['layers', 0],
      ['layers', 1],
    ]
    const ms = members(doc, paths)
    const box = boxOf(ms)
    const edit = groupResize(
      ms,
      box,
      'e',
      { x: -2 * box.width, y: 0 },
      { pivot: 'opposite', uniform: false },
    )
    for (const e of edit.edits) expect((e.scale[0] ?? 0) * (e.scale[1] ?? 0)).toBeLessThan(0)
  })

  it('scales about the box center with Alt and snaps the dragged edge', () => {
    const doc = anim([
      layer({ ks: ks({ p: [150, 150, 0] }), shapes: [rect] }),
      layer({ ks: ks({ p: [300, 250, 0] }), shapes: [rect] }),
    ])
    const paths: NodePath[] = [
      ['layers', 0],
      ['layers', 1],
    ]
    const ms = members(doc, paths)
    const box = boxOf(ms) // 100..350 × 120..280
    const centered = groupResize(ms, box, 'e', { x: 25, y: 0 }, { pivot: 'center', uniform: false })
    expectNear(applyToPoint(centered.world, box.x, 0), { x: box.x - 25, y: 0 }, 1e-9)
    expectExact(doc, paths, ms, centered.world, centered.edits)
    const snap = { lines: artboardLines(512, 512), threshold: 6 }
    const snapped = groupResize(
      ms,
      box,
      'e',
      { x: 160, y: 0 },
      { pivot: 'opposite', uniform: false, snap },
    )
    expect(applyToPoint(snapped.world, box.x + box.width, 0).x).toBeCloseTo(512, 9)
    expect(snapped.guides.x?.at).toBe(512)
  })
})

describe('groupRotate', () => {
  it('turns everything as one about the box center, exactly, under similarity parents', () => {
    const rnd = random(12)
    for (let i = 0; i < 20; i++) {
      const doc = scene(rnd, true)
      const ms = members(doc, PATHS)
      const box = boxOf(ms)
      const edit = groupRotate(ms, box, rnd(-200, 200), false)
      expectExact(doc, PATHS, ms, edit.world, edit.edits)
    }
  })

  it('measures the pointer around the box center and snaps to 15° with Shift', () => {
    const box = { x: 100, y: 100, width: 200, height: 100 }
    expect(groupRotationAngle(box, { x: 300, y: 150 })).toBeCloseTo(0, 9)
    expect(groupRotationAngle(box, { x: 200, y: 250 })).toBeCloseTo(90, 9)
    expect(groupRotationAngle(box, { x: 200, y: 150 })).toBeNull()
    const doc = anim([
      layer({ ks: ks({ p: [150, 150, 0] }), shapes: [rect] }),
      layer({ ks: ks({ p: [300, 250, 0] }), shapes: [rect] }),
    ])
    const ms = members(doc, [
      ['layers', 0],
      ['layers', 1],
    ])
    expect(groupRotate(ms, boxOf(ms), 22, true).angle).toBe(15)
    expect(groupRotate(ms, boxOf(ms), 23, true).angle).toBe(30)
  })

  it('keeps a node under a squashed parent centered on its path (no skew is written)', () => {
    const doc = anim([
      layer({ ind: 1, ty: 3, ks: ks({ p: [256, 256, 0], s: [200, 50, 100] }) }),
      layer({ parent: 1, ks: ks({ p: [-40, 0, 0] }), shapes: [rect] }),
      layer({ ks: ks({ p: [400, 100, 0] }), shapes: [rect] }),
    ])
    const paths: NodePath[] = [
      ['layers', 1],
      ['layers', 2],
    ]
    const ms = members(doc, paths)
    const edit = groupRotate(ms, boxOf(ms), 40, false)
    const next = written(doc, ms, edit.edits)
    const after = nodePlacements(next, paths[0], 0)[0].matrix
    const c0 = applyToPoint(ms[0].frame.world, 0, 0)
    expectNear(applyToPoint(after, 0, 0), applyToPoint(edit.world, c0.x, c0.y), 0.02)
    expect(edit.edits[0].values.scale).toBeUndefined()
  })
})
