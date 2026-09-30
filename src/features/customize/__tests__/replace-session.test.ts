import { beforeEach, describe, expect, it } from 'vitest'
import { getAt, type NodePath } from '@/lottie/path'
import { ReplaceError } from '@/lottie/replace'
import type {
  Animation,
  ImageLayer,
  Layer,
  PrecompAsset,
  ShapeItem,
  ShapeLayer,
} from '@/lottie/types'
import { getDoc, isDirty, loadDocument, redo, undo, updateDoc, useDocument } from '@/store/document'
import { computeReplace, DEFAULT_SETTINGS, type ReplaceContent } from '../replace/compute'
import { ReplaceSession, StaleSessionError } from '../replace/session'

const stat = <T>(k: T) => ({ a: 0 as const, k })
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const OTHER = 'data:image/png;base64,AAAAAAAA'

function rectGroup(name: string, w: number, h: number, color = [1, 0, 0, 1]): ShapeItem {
  return {
    ty: 'gr',
    nm: name,
    it: [
      { ty: 'rc', p: stat([w / 2, h / 2]), s: stat([w, h]), r: stat(0) },
      { ty: 'fl', c: stat(color), o: stat(100), r: 1 },
      { ty: 'tr', p: stat([0, 0]), a: stat([0, 0]), s: stat([100, 100]), r: stat(0), o: stat(100) },
    ],
  } as unknown as ShapeItem
}

const imageLayer = (ind: number, refId: string, nm: string): ImageLayer => ({
  ty: 2,
  ind,
  nm,
  refId,
  ip: 0,
  op: 60,
  st: 0,
  ks: { p: stat([100, 100, 0]), a: stat([0, 0, 0]), s: stat([100, 100, 100]) },
})

function makeDoc(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 400,
    h: 400,
    assets: [
      { id: 'image_0', w: 100, h: 50, u: '', p: PNG, e: 1 },
      {
        id: 'comp_logo',
        layers: [
          {
            ty: 4,
            ind: 1,
            nm: 'Mark',
            ip: 0,
            op: 60,
            st: 0,
            ks: {},
            shapes: [rectGroup('Mark', 80, 80)],
          } as ShapeLayer,
        ],
      },
    ],
    layers: [
      imageLayer(1, 'image_0', 'Photo A'),
      imageLayer(2, 'image_0', 'Photo B'),
      {
        ty: 0,
        ind: 3,
        nm: 'Logo',
        refId: 'comp_logo',
        ip: 0,
        op: 60,
        st: 0,
        w: 400,
        h: 400,
        ks: {},
      } as Layer,
      {
        ty: 0,
        ind: 4,
        nm: 'Logo again',
        refId: 'comp_logo',
        ip: 0,
        op: 60,
        st: 0,
        w: 400,
        h: 400,
        ks: {},
      } as Layer,
    ],
  } as Animation
}

const svgContent: ReplaceContent = {
  kind: 'shapes',
  name: 'star',
  shapes: [rectGroup('Star', 20, 10, [0, 0, 1, 1])],
}
const imageContent: ReplaceContent = { kind: 'image', name: 'new', dataUri: OTHER, w: 40, h: 40 }

const input = (target: NodePath, content: ReplaceContent, settings = DEFAULT_SETTINGS) => ({
  target,
  content,
  settings,
  frame: 0,
  box: { x: 0, y: 0, w: 100, h: 50 },
})

describe('computeReplace', () => {
  it('replaces every layer showing the image and embeds the new image once', () => {
    const base = makeDoc()
    const out = computeReplace(base, input(['layers', 0], imageContent))
    expect(out.instances).toBe(2)
    const layers = out.doc.layers as ImageLayer[]
    expect(layers[0].refId).toBe(layers[1].refId)
    const images = out.doc.assets!.filter((a) => 'p' in a)
    expect(images).toHaveLength(1)
    expect((images[0] as { p: string }).p).toBe(OTHER)
    // The old picture is gone from the file; the base document is untouched.
    expect(out.doc.assets!.some((a) => a.id === 'image_0')).toBe(false)
    expect(base.assets!.some((a) => a.id === 'image_0')).toBe(true)
  })

  it('replaces only the target when not everywhere, keeping the image the other layer uses', () => {
    const out = computeReplace(
      makeDoc(),
      input(['layers', 0], svgContent, { ...DEFAULT_SETTINGS, everywhere: false }),
    )
    expect(out.instances).toBe(1)
    expect(out.doc.layers[0].ty).toBe(4)
    expect((out.doc.layers[1] as ImageLayer).refId).toBe('image_0')
    expect(out.doc.assets!.some((a) => a.id === 'image_0')).toBe(true)
  })

  it('moves the target path when removing the old image shifts the compositions', () => {
    const base = makeDoc()
    // An image layer inside the composition that follows the image asset.
    ;(base.assets![1] as PrecompAsset).layers.push(imageLayer(2, 'image_0', 'Inner photo'))
    base.layers = [base.layers[2]]
    const out = computeReplace(base, input(['assets', 1, 'layers', 1], svgContent))
    expect(out.doc.assets!.some((a) => a.id === 'image_0')).toBe(false)
    expect(out.target).toEqual(['assets', 0, 'layers', 1])
    expect(getAt<Layer>(out.doc, out.target)?.ty).toBe(4)
  })

  it('replaces a shared composition for all its layers, or detaches a copy', () => {
    const all = computeReplace(makeDoc(), input(['layers', 2], svgContent))
    expect(all.doc.assets!.filter((a) => 'layers' in a)).toHaveLength(1)
    expect(all.warnings).toContain('shared-precomp')

    const one = computeReplace(
      makeDoc(),
      input(['layers', 2], svgContent, { ...DEFAULT_SETTINGS, everywhere: false }),
    )
    expect(one.doc.assets!.filter((a) => 'layers' in a)).toHaveLength(2)
    const refs = one.doc.layers.slice(2).map((l) => (l as { refId: string }).refId)
    expect(refs[0]).not.toBe(refs[1])
    expect(refs[1]).toBe('comp_logo')
  })

  it('applies offsets relative to the element size and a single color', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      offsetX: 10,
      offsetY: -20,
      style: 'color' as const,
      color: '#00ff00',
    }
    const out = computeReplace(makeDoc(), input(['layers', 2], svgContent, settings))
    const comp = out.doc.assets!.find((a) => a.id === 'comp_logo') as PrecompAsset
    const wrapper = (comp.layers[0] as ShapeLayer).shapes[0] as { it: ShapeItem[] }
    const tr = wrapper.it[wrapper.it.length - 1] as unknown as { p: { k: number[] } }
    const plain = computeReplace(makeDoc(), input(['layers', 2], svgContent))
    const plainComp = plain.doc.assets!.find((a) => a.id === 'comp_logo') as PrecompAsset
    const plainWrapper = (plainComp.layers[0] as ShapeLayer).shapes[0] as { it: ShapeItem[] }
    const p0 = (plainWrapper.it[plainWrapper.it.length - 1] as unknown as { p: { k: number[] } }).p
      .k
    expect(tr.p.k[0] - p0[0]).toBeCloseTo(10, 3) // 10% of 100
    expect(tr.p.k[1] - p0[1]).toBeCloseTo(-10, 3) // −20% of 50
    const json = JSON.stringify(wrapper)
    expect(json).toContain('[0,1,0,1]')
    expect(json).not.toContain('"ty":"st"')
  })

  it('throws the engine error for an invalid target', () => {
    expect(() => computeReplace(makeDoc(), input(['layers', 9], svgContent))).toThrow(ReplaceError)
  })
})

describe('ReplaceSession', () => {
  beforeEach(() => {
    loadDocument(makeDoc(), { fileName: 'test.json' })
  })

  it('previews every change as one history entry and applies it as one undo step', () => {
    const base = getDoc()
    const session = ReplaceSession.start(['layers', 2], 'Replace Logo')!
    expect(session.update(svgContent, DEFAULT_SETTINGS).ok).toBe(true)
    expect(session.update(svgContent, { ...DEFAULT_SETTINGS, scale: 50 }).ok).toBe(true)
    expect(session.update(imageContent, DEFAULT_SETTINGS).ok).toBe(true)
    expect(useDocument.getState().past).toHaveLength(1)
    expect(session.apply()).toBe(true)
    const s = useDocument.getState()
    expect(s.past).toHaveLength(1)
    expect(s.past[0].label).toBe('Replace Logo')
    expect(s.past[0].closed).toBe(true)
    // Later edits get their own entries.
    updateDoc('Rename', (d) => {
      d.layers[0].nm = 'Renamed'
    })
    expect(useDocument.getState().past).toHaveLength(2)
    undo()
    undo()
    expect(getDoc()).toBe(base)
    redo()
    expect(getDoc()!.layers[2].ty).toBe(2)
  })

  it('cancel restores the document and leaves nothing to redo', () => {
    const base = getDoc()
    const session = ReplaceSession.start(['layers', 0], 'Replace')!
    session.update(svgContent, DEFAULT_SETTINGS)
    session.update(svgContent, { ...DEFAULT_SETTINGS, fit: 'cover' })
    session.cancel()
    const s = useDocument.getState()
    expect(s.doc).toBe(base)
    expect(s.past).toHaveLength(0)
    expect(s.future).toHaveLength(0)
  })

  it('cancel leaves a file that had no changes without the "edited" mark', () => {
    expect(isDirty()).toBe(false)
    const session = ReplaceSession.start(['layers', 0], 'Replace')!
    session.update(svgContent, DEFAULT_SETTINGS)
    expect(isDirty()).toBe(true)
    session.cancel()
    expect(isDirty()).toBe(false)
  })

  it('cancel keeps the "edited" mark of a file that already had changes', () => {
    updateDoc('Rename', (d) => {
      d.nm = 'changed'
    })
    const session = ReplaceSession.start(['layers', 0], 'Replace')!
    session.update(svgContent, DEFAULT_SETTINGS)
    session.cancel()
    expect(isDirty()).toBe(true)
  })

  it('cancel without any preview changes nothing', () => {
    const base = getDoc()
    ReplaceSession.start(['layers', 0], 'Replace')!.cancel()
    expect(getDoc()).toBe(base)
  })

  it('keeps the replaced element selected', () => {
    const session = ReplaceSession.start(['layers', 2], 'Replace')!
    session.update(svgContent, DEFAULT_SETTINGS)
    expect(useDocument.getState().selection.nodes).toEqual([['layers', 2]])
  })

  it('stops when the document changed under it', () => {
    const session = ReplaceSession.start(['layers', 0], 'Replace')!
    session.update(svgContent, DEFAULT_SETTINGS)
    undo()
    const result = session.update(svgContent, DEFAULT_SETTINGS)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBeInstanceOf(StaleSessionError)
    expect(session.apply()).toBe(false)
  })

  it('reports engine errors without touching the document', () => {
    const base = getDoc()
    const session = ReplaceSession.start(['layers', 0], 'Replace')!
    const result = session.update({ kind: 'shapes', name: 'x', shapes: [] }, DEFAULT_SETTINGS)
    expect(result.ok).toBe(false)
    expect(getDoc()).toBe(base)
  })

  it('does not start for elements that cannot be replaced', () => {
    expect(ReplaceSession.start(['layers', 9], 'x')).toBeNull()
    expect(ReplaceSession.start(['assets', 0], 'x')).toBeNull()
  })
})
