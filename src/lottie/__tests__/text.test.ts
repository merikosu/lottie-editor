import { describe, expect, it } from 'vitest'
import {
  addFont,
  findFont,
  fontFamilyFor,
  fontLabel,
  cssFontFamily,
  fontStack,
  fontUsage,
  hasUniformText,
  isGenericFamily,
  listFonts,
  listTextLayers,
  missingGlyphs,
  patchTextDocument,
  setTextContent,
  textFromEditor,
  textKeyframeIndexAt,
  textKeyframes,
  textToEditor,
  usesGlyphs,
} from '../text'
import type { Animation, Layer, TextData, TextDocument, TextLayer } from '../types'

const doc = (t: string, extra: Partial<TextDocument> = {}): TextDocument => ({
  t,
  s: 24,
  f: 'Inter-Regular',
  ...extra,
})

function textData(...docs: [number, TextDocument][]): TextData {
  return { d: { k: docs.map(([t, s]) => ({ t, s })) } }
}

function textLayer(name: string, data: TextData): TextLayer {
  return { ty: 5, nm: name, ip: 0, op: 60, st: 0, ks: {}, t: data }
}

function anim(layers: Layer[], extra: Partial<Animation> = {}): Animation {
  return { v: '5.12.0', fr: 30, ip: 0, op: 60, w: 512, h: 512, layers, ...extra }
}

describe('line breaks', () => {
  it('converts stored breaks to editor newlines', () => {
    expect(textToEditor('a\rb')).toBe('a\nb')
    expect(textToEditor('a\r\nb')).toBe('a\nb')
    expect(textToEditor('a\u0003b')).toBe('a\nb')
    expect(textToEditor(undefined)).toBe('')
  })
  it('stores editor newlines as \\r', () => {
    expect(textFromEditor('a\nb\nc')).toBe('a\rb\rc')
    expect(textFromEditor('a\r\nb')).toBe('a\rb')
    expect(textFromEditor('plain')).toBe('plain')
  })
  it('round-trips', () => {
    const stored = 'Line 1\rLine 2\rLine 3'
    expect(textFromEditor(textToEditor(stored))).toBe(stored)
  })
})

describe('textKeyframes / textKeyframeIndexAt', () => {
  const data = textData([0, doc('A')], [10, doc('B')], [20, doc('C')])

  it('lists keyframes and skips malformed entries', () => {
    const broken = { d: { k: [{ t: 0, s: doc('ok') }, null, { t: 5 }] } } as unknown as TextData
    expect(textKeyframes(broken).map((k) => k.s.t)).toEqual(['ok'])
    expect(textKeyframes(undefined)).toEqual([])
  })
  it('finds the keyframe displayed at a frame (hold semantics)', () => {
    expect(textKeyframeIndexAt(data, -5)).toBe(0)
    expect(textKeyframeIndexAt(data, 0)).toBe(0)
    expect(textKeyframeIndexAt(data, 9.99)).toBe(0)
    expect(textKeyframeIndexAt(data, 10)).toBe(1)
    expect(textKeyframeIndexAt(data, 19)).toBe(1)
    expect(textKeyframeIndexAt(data, 500)).toBe(2)
  })
  it('returns -1 without keyframes', () => {
    expect(textKeyframeIndexAt({ d: { k: [] } }, 3)).toBe(-1)
    expect(textKeyframeIndexAt(undefined, 3)).toBe(-1)
  })
})

describe('setTextContent', () => {
  it('sets every keyframe by default and stores \\r breaks', () => {
    const data = textData([0, doc('A')], [10, doc('A')])
    setTextContent(data, 'Hello\nworld')
    expect(data.d.k.map((k) => k.s.t)).toEqual(['Hello\rworld', 'Hello\rworld'])
  })
  it('can target one keyframe', () => {
    const data = textData([0, doc('A')], [10, doc('B')])
    setTextContent(data, 'X', 1)
    expect(data.d.k.map((k) => k.s.t)).toEqual(['A', 'X'])
  })
  it('ignores out-of-range indices', () => {
    const data = textData([0, doc('A')])
    setTextContent(data, 'X', 3)
    expect(data.d.k[0].s.t).toBe('A')
  })
  it('detects uniform text', () => {
    expect(hasUniformText(textData([0, doc('A')], [5, doc('A')]))).toBe(true)
    expect(hasUniformText(textData([0, doc('A')], [5, doc('B')]))).toBe(false)
    expect(hasUniformText(textData([0, doc('A')]))).toBe(true)
  })
})

describe('patchTextDocument', () => {
  it('applies style fields to all keyframes', () => {
    const data = textData([0, doc('A')], [10, doc('B')])
    patchTextDocument(data, { s: 48, j: 2 })
    expect(data.d.k.map((k) => [k.s.s, k.s.j])).toEqual([
      [48, 2],
      [48, 2],
    ])
  })
  it('removes fields set to undefined', () => {
    const data = textData([0, doc('A', { sc: [1, 0, 0], sw: 2 })])
    patchTextDocument(data, { sc: undefined, sw: undefined })
    expect('sc' in data.d.k[0].s).toBe(false)
    expect('sw' in data.d.k[0].s).toBe(false)
  })
  it('copies arrays so documents do not share references', () => {
    const data = textData([0, doc('A')], [10, doc('B')])
    const color = [1, 0.5, 0]
    patchTextDocument(data, { fc: color })
    expect(data.d.k[0].s.fc).toEqual(color)
    expect(data.d.k[0].s.fc).not.toBe(color)
    expect(data.d.k[0].s.fc).not.toBe(data.d.k[1].s.fc)
  })
  it('can target one keyframe', () => {
    const data = textData([0, doc('A')], [10, doc('B')])
    patchTextDocument(data, { s: 10 }, 0)
    expect(data.d.k.map((k) => k.s.s)).toEqual([10, 24])
  })
})

describe('listTextLayers', () => {
  it('finds text layers in the root and in precomps', () => {
    const a = anim(
      [textLayer('Root text', textData([0, doc('A')])), { ty: 3, ip: 0, op: 60, st: 0, ks: {} }],
      {
        assets: [
          { id: 'comp_0', nm: 'Inner', layers: [textLayer('Inner text', textData([0, doc('B')]))] },
        ],
      },
    )
    const found = listTextLayers(a)
    expect(found.map((f) => [f.layer.nm, f.path, f.assetIndex, f.compName])).toEqual([
      ['Root text', ['layers', 0], null, ''],
      ['Inner text', ['assets', 0, 'layers', 0], 0, 'Inner'],
    ])
  })
})

function withFonts(): Animation {
  return anim(
    [textLayer('T', textData([0, doc('A', { f: 'Inter-Bold' })], [5, doc('B', { f: 'Mono' })]))],
    {
      fonts: {
        list: [
          { fName: 'Inter-Bold', fFamily: 'Inter', fStyle: 'Bold' },
          { fName: 'Mono', fFamily: 'JetBrains Mono', fStyle: 'Regular' },
        ],
      },
    },
  )
}

describe('fonts', () => {
  it('lists and finds fonts', () => {
    const a = withFonts()
    expect(listFonts(a).map((f) => f.fName)).toEqual(['Inter-Bold', 'Mono'])
    expect(findFont(a, 'Mono')?.fFamily).toBe('JetBrains Mono')
    expect(findFont(a, 'Nope')).toBeUndefined()
    expect(listFonts(anim([]))).toEqual([])
  })
  it('formats labels, hiding regular styles', () => {
    expect(fontLabel({ fName: 'Inter-Bold', fFamily: 'Inter', fStyle: 'Bold' })).toBe('Inter Bold')
    expect(fontLabel({ fName: 'Mono', fFamily: 'JetBrains Mono', fStyle: 'Regular' })).toBe(
      'JetBrains Mono',
    )
    expect(fontLabel({ fName: 'Raw-Name', fFamily: '' })).toBe('Raw-Name')
  })
  it('labels CSS font stacks by their first family', () => {
    expect(
      fontLabel({
        fName: 'Inter-SemiBold',
        fFamily: 'Inter Variable, Inter, system-ui, sans-serif',
        fStyle: 'SemiBold',
      }),
    ).toBe('Inter Variable SemiBold')
    expect(fontLabel({ fName: 'X', fFamily: '"Open Sans", sans-serif' })).toBe('Open Sans')
  })
  it('splits font stacks and recognizes generic families', () => {
    expect(fontStack('Inter Variable, "Open Sans", \'Roboto\' , sans-serif')).toEqual([
      'Inter Variable',
      'Open Sans',
      'Roboto',
      'sans-serif',
    ])
    expect(fontStack(undefined)).toEqual([])
    expect(isGenericFamily('Sans-Serif')).toBe(true)
    expect(isGenericFamily('system-ui')).toBe(true)
    expect(isGenericFamily('Inter')).toBe(false)
  })
  it('builds a CSS font-family value from a family or stack', () => {
    expect(cssFontFamily('Inter Variable, Inter, system-ui, sans-serif')).toBe(
      '"Inter Variable", "Inter", system-ui, sans-serif',
    )
    expect(cssFontFamily('Open Sans', 'var(--font-sans)')).toBe('"Open Sans", var(--font-sans)')
    expect(cssFontFamily('"Evil" Font"')).toBe('"Evil Font"')
    expect(cssFontFamily(undefined, 'serif')).toBe('serif')
  })
  it('resolves the render family with lottie-web fallbacks', () => {
    const a = withFonts()
    expect(fontFamilyFor(a, 'Mono')).toBe('JetBrains Mono')
    // Unknown names fall back to the first font of the list, like lottie-web.
    expect(fontFamilyFor(a, 'Unknown')).toBe('Inter')
    expect(fontFamilyFor(anim([]), 'Arial')).toBe('Arial')
  })
  it('adds fonts with unique names and reuses identical ones', () => {
    const a = anim([])
    const first = addFont(a, { family: 'Open Sans', style: 'Semi Bold', weight: '600' })
    expect(first).toBe('OpenSans-SemiBold')
    expect(a.fonts?.list[0]).toMatchObject({
      fFamily: 'Open Sans',
      fStyle: 'Semi Bold',
      fWeight: '600',
      fOrigin: 'n',
    })
    expect(addFont(a, { family: 'open sans', style: 'semi bold' })).toBe(first)
    expect(a.fonts?.list).toHaveLength(1)
    // A different family that collapses to the same fName gets a suffix.
    expect(addFont(a, { family: 'OpenSans', style: 'Semi  Bold ' })).toBe('OpenSans-SemiBold-2')
    expect(addFont(a, { family: 'Roboto' })).toBe('Roboto-Regular')
  })
  it('rejects empty family names', () => {
    expect(() => addFont(anim([]), { family: '  ' })).toThrow()
  })
  it('counts text layers per font across keyframes and comps', () => {
    const a = withFonts()
    a.assets = [{ id: 'c', layers: [textLayer('Inner', textData([0, doc('X', { f: 'Mono' })]))] }]
    const usage = fontUsage(a)
    expect(usage.get('Inter-Bold')).toBe(1)
    expect(usage.get('Mono')).toBe(2)
  })
})

describe('glyphs', () => {
  const chars = [
    { ch: 'H', fFamily: 'Inter', style: 'Bold' },
    { ch: 'i', fFamily: 'Inter', style: 'Bold' },
    { ch: ' ', fFamily: 'Inter', style: 'Bold' },
    { ch: 'x', fFamily: 'Other', style: 'Bold' },
  ]
  const font = { fFamily: 'Inter', fStyle: 'Bold' }

  it('detects glyph-based documents', () => {
    expect(usesGlyphs(anim([], { chars }))).toBe(true)
    expect(usesGlyphs(anim([]))).toBe(false)
    expect(usesGlyphs(anim([], { chars: [] }))).toBe(false)
  })
  it('lists unique missing characters for the font, ignoring line breaks', () => {
    const a = anim([], { chars })
    expect(missingGlyphs(a, 'Hi Hi', font)).toEqual([])
    expect(missingGlyphs(a, 'Hix\rHo!', font)).toEqual(['x', 'o', '!'])
  })
  it('matches family and style', () => {
    const a = anim([], { chars })
    expect(missingGlyphs(a, 'H', { fFamily: 'Inter', fStyle: 'Regular' })).toEqual(['H'])
    expect(missingGlyphs(a, 'x', { fFamily: 'Other', fStyle: 'Bold' })).toEqual([])
  })
  it('reports nothing when the document has no glyphs', () => {
    expect(missingGlyphs(anim([]), 'anything', font)).toEqual([])
  })
})
