import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAt, type NodePath } from '@/lottie/path'
import type { Animation, Layer } from '@/lottie/types'
import { loadDocument, selectKeyframes, updateDoc, useDocument } from '@/store/document'
import { play, usePlayback } from '@/store/playback'
import { applyToPoint } from '../lib/matrix'
import { nodePlacements } from '../lib/transforms'
import type { GizmoGeometry } from '../overlay'

vi.mock('../locks', () => ({ isLockedOnCanvas: () => false }))

const { TransformGesture } = await import('../transform-gesture')

const stat = <T>(k: T) => ({ a: 0 as const, k })

const rect = { ty: 'rc', p: stat([0, 0]), s: stat([100, 60]), r: stat(0) }

function doc(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 512,
    h: 512,
    layers: [
      {
        ty: 4,
        ip: 0,
        op: 60,
        st: 0,
        ks: {
          a: stat([0, 0, 0]),
          p: stat([256, 256, 0]),
          s: {
            a: 1,
            k: [
              { t: 0, s: [100, 100, 100], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
              { t: 40, s: [100, 100, 100] },
            ],
          },
          r: stat(0),
          o: stat(100),
        },
        shapes: [
          {
            ty: 'gr',
            nm: 'G',
            it: [
              rect,
              {
                ty: 'tr',
                p: stat([0, 0]),
                a: stat([0, 0]),
                s: stat([100, 100]),
                r: stat(0),
                o: stat(100),
              },
            ],
          },
        ],
      } as unknown as Layer,
    ],
  }
}

const BOX = { x: -50, y: -30, width: 100, height: 60 }

/** The gizmo the overlay would draw for `path` (from the document model). */
function gizmoOf(path: NodePath): GizmoGeometry {
  const d = useDocument.getState().doc
  if (!d) throw new Error('no document')
  const placement = nodePlacements(d, path, usePlayback.getState().frame)[0]
  const node = { path, chain: '', box: BOX, matrix: placement.matrix }
  return { box: BOX, matrix: placement.matrix, nodes: [node] }
}

/** The node of a single-node gizmo (a member of a selection's gizmo). */
const nodeOf = (path: NodePath) => gizmoOf(path).nodes[0]

const layerKs = () => getAt<Layer['ks']>(useDocument.getState().doc, ['layers', 0, 'ks'])
const history = () => useDocument.getState().past.map((e) => e.label)

beforeEach(() => {
  loadDocument(doc(), { fileName: 'a.json' })
  usePlayback.setState({ frame: 0 })
})

describe('TransformGesture', () => {
  it('previews without editing, then commits one undo step on release', () => {
    const g = new TransformGesture()
    // The 'se' handle is at (306, 286).
    expect(
      g.begin({ kind: 'resize', handle: 'se' }, gizmoOf(['layers', 0]), { x: 306, y: 286 }, null),
    ).toBe(true)
    let preview: Animation | null = null
    for (let i = 1; i <= 20; i++)
      preview =
        g.update({ x: 306 + i * 2.5, y: 286 + i * 1.5 }, { shift: false, alt: false }, null, 1) ??
        preview
    expect(getAt(preview, ['layers', 0, 'ks', 's', 'k', 0, 's'])).toEqual([150, 150, 100])
    // The document is untouched until the drag ends.
    expect(useDocument.getState().past).toHaveLength(0)
    expect(g.readout).toEqual({ kind: 'resize', width: 150, height: 90, scale: [150, 150] })
    g.finish()
    expect(history()).toEqual(['Resize layer'])
    expect(g.active).toBe(false)
    // The top-left corner stayed: position moved by half the growth.
    expect(getAt(layerKs(), ['p', 'k'])).toEqual([281, 271, 0])
  })

  it('leaves no trace when cancelled (Esc)', () => {
    const g = new TransformGesture()
    g.begin({ kind: 'resize', handle: 'e' }, gizmoOf(['layers', 0]), { x: 306, y: 256 }, null)
    g.update({ x: 350, y: 256 }, { shift: false, alt: false }, null, 1)
    g.cancel()
    g.finish()
    expect(useDocument.getState().past).toHaveLength(0)
    expect(useDocument.getState().future).toHaveLength(0)
  })

  it('does not write a drag that ends where it started', () => {
    const g = new TransformGesture()
    g.begin({ kind: 'resize', handle: 'e' }, gizmoOf(['layers', 0]), { x: 306, y: 256 }, null)
    g.update({ x: 350, y: 256 }, { shift: false, alt: false }, null, 1)
    g.update({ x: 306, y: 256 }, { shift: false, alt: false }, null, 1)
    g.finish()
    expect(useDocument.getState().past).toHaveLength(0)
  })

  it('rotates with a continuous angle over several turns and snaps with Shift', () => {
    const g = new TransformGesture()
    g.begin({ kind: 'rotate', corner: 'se' }, gizmoOf(['layers', 0]), { x: 356, y: 256 }, null)
    // Two full turns clockwise around the anchor (256, 256), then a quarter more.
    const steps = 72
    for (let i = 1; i <= steps * 2 + 18; i++) {
      const a = (i * 2 * Math.PI) / steps
      g.update(
        { x: 256 + 100 * Math.cos(a), y: 256 + 100 * Math.sin(a) },
        { shift: false, alt: false },
        null,
        1,
      )
    }
    expect(g.readout).toEqual({ kind: 'rotate', angle: 810 })
    g.update(
      { x: 256 + 100 * Math.cos(1.62), y: 256 + 100 * Math.sin(1.62) },
      { shift: true, alt: false },
      null,
      1,
    )
    expect((g.readout as { angle: number }).angle % 15).toBe(0)
    g.finish()
    expect(history()).toEqual(['Rotate layer'])
    // Rotating about the anchor never moves the position.
    expect(getAt(layerKs(), ['p', 'k'])).toEqual([256, 256, 0])
  })

  it('switches the pivot when Alt changes mid-drag', () => {
    const g = new TransformGesture()
    const gizmo = gizmoOf(['layers', 0])
    g.begin({ kind: 'resize', handle: 'e' }, gizmo, { x: 306, y: 256 }, null)
    g.update({ x: 326, y: 256 }, { shift: false, alt: false }, null, 1)
    const opposite = g.overlay?.geometry.outlines[0].quad[0]
    expect(opposite?.x).toBeCloseTo(206, 6)
    g.update({ x: 326, y: 256 }, { shift: false, alt: true }, null, 1)
    // About the anchor (the center here): the left edge moves out as much as the right one.
    expect(g.overlay?.geometry.outlines[0].quad[0].x).toBeCloseTo(186, 6)
    g.finish()
    expect(getAt(layerKs(), ['p', 'k'])).toEqual([256, 256, 0])
  })

  it('names group edits and keeps selected keys pointing at the same keys', () => {
    selectKeyframes([{ path: ['layers', 0, 'ks', 's'], index: 1 }])
    usePlayback.setState({ frame: 20 })
    const g = new TransformGesture()
    // The group transform: its content box maps like the layer's (identity group transform).
    const group: NodePath = ['layers', 0, 'shapes', 0]
    g.begin({ kind: 'rotate', corner: 'ne' }, gizmoOf(group), { x: 316, y: 216 }, null)
    const w = gizmoOf(group).matrix
    const start = applyToPoint(w, 60, -40)
    // From (60, −40) to (30, 20) around the anchor: a turn of about 67°.
    g.update({ x: start.x - 30, y: start.y + 60 }, { shift: false, alt: false }, null, 1)
    g.finish()
    expect(history()).toEqual(['Rotate group'])
    expect(useDocument.getState().selection.keyframes).toEqual([
      { path: ['layers', 0, 'ks', 's'], index: 1 },
    ])

    // A layer resize at frame 20 adds a scale key before the selected one: the ref follows it.
    const r = new TransformGesture()
    r.begin({ kind: 'resize', handle: 'se' }, gizmoOf(['layers', 0]), { x: 306, y: 286 }, null)
    r.update({ x: 320, y: 300 }, { shift: false, alt: false }, null, 1)
    r.finish()
    expect(useDocument.getState().selection.keyframes).toEqual([
      { path: ['layers', 0, 'ks', 's'], index: 2 },
    ])
  })

  it('scales and turns several nodes together about their bounds, in one undo step', () => {
    // A second layer at (400, 256): the selection's bounds are 206..450 × 226..286.
    updateDoc('Add', (d) => {
      const copy = JSON.parse(JSON.stringify(d.layers[0])) as Layer
      ;(copy.ks.p as { k: number[] }).k = [400, 256, 0]
      d.layers.push(copy)
    })
    const nodes = [nodeOf(['layers', 0]), nodeOf(['layers', 1])]
    const box = { x: 206, y: 226, width: 244, height: 60 }
    const group = { box, matrix: [1, 0, 0, 1, 0, 0] as const, nodes }
    const g = new TransformGesture()
    g.begin({ kind: 'resize', handle: 'e' }, group, { x: 450, y: 256 }, null)
    g.update({ x: 572, y: 256 }, { shift: false, alt: false }, null, 1)
    // 244 → 366 wide: ×1.5 along x, about the left edge.
    expect(g.readout).toEqual({ kind: 'resize', width: 366, height: 60, scale: [150, 100] })
    g.finish()
    expect(history()).toEqual(['Add', 'Resize 2 layers'])
    expect(getAt(useDocument.getState().doc, ['layers', 1, 'ks', 'p', 'k'])).toEqual([497, 256, 0])

    const r = new TransformGesture()
    const turned = {
      box,
      matrix: [1, 0, 0, 1, 0, 0] as const,
      nodes: [nodeOf(['layers', 0]), nodeOf(['layers', 1])],
    }
    // Around the center (328, 256): from the right, a quarter turn clockwise.
    r.begin({ kind: 'rotate', corner: 'se' }, turned, { x: 428, y: 256 }, null)
    r.update({ x: 328, y: 356 }, { shift: false, alt: false }, null, 1)
    expect(r.readout).toEqual({ kind: 'rotate', angle: 90 })
    r.finish()
    expect(history().at(-1)).toBe('Rotate 2 layers')
    expect(getAt(useDocument.getState().doc, ['layers', 0, 'ks', 'r', 'k'])).toBe(90)
  })

  it('pauses playback and is void when the document changes under it', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    play()
    const g = new TransformGesture()
    g.begin({ kind: 'resize', handle: 'se' }, gizmoOf(['layers', 0]), { x: 306, y: 286 }, null)
    expect(usePlayback.getState().playing).toBe(false)
    g.update({ x: 330, y: 300 }, { shift: false, alt: false }, null, 1)
    updateDoc('Other', (d) => {
      d.nm = 'changed'
    })
    g.finish()
    expect(history()).toEqual(['Other'])
  })
})
