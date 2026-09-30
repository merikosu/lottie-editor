import { describe, expect, it } from 'vitest'
import {
  affectedPlayers,
  buildScan,
  cellOf,
  detectFeatures,
  FEATURE_IDS,
  FEATURES,
  findParentCycles,
  findPrecompCycles,
  matteSourceIndex,
  PLAYERS,
  scanDocument,
  severityFor,
  TARGETS,
  verdict,
  worstLevel,
  type FeatureId,
} from '../compat'
import { pathKey } from '../path'
import {
  bezier,
  doc,
  ellipse,
  fill,
  group,
  kf,
  layer,
  nullLayer,
  p,
  path,
  precompLayer,
  rect,
  stroke,
  type J,
} from './insights.fixtures'

const keys = (paths: readonly (readonly (string | number)[])[]) => paths.map((x) => pathKey(x))

function features(d: ReturnType<typeof doc>): Map<FeatureId, string[]> {
  const out = new Map<FeatureId, string[]>()
  for (const [id, hit] of detectFeatures(d)) out.set(id, keys(hit.paths))
  return out
}

describe('support matrix', () => {
  it('has a valid cell for every player of every feature', () => {
    for (const id of FEATURE_IDS) {
      for (const player of PLAYERS) {
        const { level } = cellOf(id, player)
        expect(['y', 'p', 'n', 'x', '?'], `${id} / ${player}`).toContain(level)
      }
    }
  })

  it('rejects the features Telegram forbids in stickers', () => {
    const forbidden: FeatureId[] = [
      'expressions',
      'mask.any',
      'fx.any',
      'layer.image',
      'layer.solid',
      'layer.text',
      'transform.3d',
      'mod.mergePaths',
      'paint.polystar',
      'paint.gradientStroke',
      'mod.repeater',
      'time.stretch',
      'time.remap',
      'transform.autoOrient',
    ]
    for (const id of forbidden) expect(cellOf(id, 'telegram').level, id).toBe('x')
    expect(cellOf('paint.gradient', 'telegram').level).toBe('y')
    expect(cellOf('matte.alpha', 'telegram').level).toBe('y')
  })

  it('keeps notes as tuples', () => {
    expect(cellOf('layer.camera', 'web-svg')).toEqual({
      level: 'x',
      note: expect.stringContaining('camera'),
    })
    expect(cellOf('layer.shape', 'ios')).toEqual({ level: 'y' })
  })

  it('grades targets by their worst player', () => {
    expect(worstLevel(['y', 'p', 'n'])).toBe('n')
    expect(worstLevel(['y', '?'])).toBe('?')
    expect(worstLevel([])).toBe('y')
    expect(verdict('mod.mergePaths', 'all').level).toBe('n')
    expect(verdict('mod.mergePaths', 'android').level).toBe('p')
    expect(verdict('matte.luma', 'web').level).toBe('y')
    expect(verdict('matte.luma', 'ios').level).toBe('x')
    expect(verdict('expressions', 'dotlottie').perPlayer).toEqual([
      { player: 'thorvg', level: 'p', note: expect.any(String) },
    ])
  })

  it('maps levels to severities', () => {
    expect(severityFor('x')).toBe('error')
    expect(severityFor('n')).toBe('warning')
    expect(severityFor('p')).toBe('info')
    expect(severityFor('?')).toBe('info')
    expect(severityFor('y')).toBeNull()
  })

  it('lists affected players only', () => {
    expect(affectedPlayers('layer.shape')).toEqual([])
    expect(affectedPlayers('transform.layerSkew')).toEqual([{ player: 'ios', level: 'n' }])
  })

  it('keeps the HTML renderer and Telegram out of "all players"', () => {
    expect(TARGETS.all).not.toContain('web-html')
    expect(TARGETS.all).not.toContain('telegram')
    expect(TARGETS.telegram).toEqual(['telegram'])
  })

  it('describes every feature', () => {
    for (const id of FEATURE_IDS) {
      expect(FEATURES[id].detect.length, id).toBeGreaterThan(3)
    }
  })
})

describe('scanDocument', () => {
  const d = doc(
    [
      layer(1, { shapes: [group([group([ellipse(), fill()]), rect()]), path()] }),
      precompLayer(2, 'comp_a'),
      {
        ...layer(3, {
          ty: 5,
          t: { d: { k: [{ s: { t: 'Hi', f: 'Arial', s: 20 }, t: 0 }] }, a: [] },
        }),
        shapes: undefined,
      },
    ],
    {
      assets: [
        { id: 'comp_a', layers: [layer(1), precompLayer(2, 'comp_b')] },
        { id: 'comp_b', layers: [layer(1)] },
        { id: 'unused', layers: [layer(1)] },
        { id: 'img', w: 10, h: 10, u: '', p: 'img.png' },
      ],
    },
  )

  it('indexes compositions, layers and nested shapes with their paths', () => {
    const scan = scanDocument(d)
    expect(scan.comps.map((c) => c.id)).toEqual([null, 'comp_a', 'comp_b', 'unused'])
    expect(scan.comps.map((c) => pathKey(c.layersPath))).toEqual([
      'layers',
      'assets/0/layers',
      'assets/1/layers',
      'assets/2/layers',
    ])
    expect(keys(scan.layers.map((l) => l.path))).toContain('assets/0/layers/1')
    const shapePaths = keys(
      scan.shapes
        .filter((s) => s.layer.path[1] === 0 && s.layer.path.length === 2)
        .map((s) => s.path),
    )
    expect(shapePaths).toContain('layers/0/shapes/0/it/0/it/1')
    const inner = scan.shapes.find((s) => pathKey(s.path) === 'layers/0/shapes/0/it/0/it/0')
    expect(inner?.group && pathKey(inner.group.path)).toBe('layers/0/shapes/0/it/0')
  })

  it('classifies properties', () => {
    const scan = scanDocument(d)
    const kinds = new Map(scan.properties.map((pr) => [pathKey(pr.path), pr.kind]))
    expect(kinds.get('layers/0/ks/p')).toBe('value')
    expect(kinds.get('layers/0/shapes/1/ks')).toBe('path')
    expect(kinds.get('layers/2/t/d')).toBe('text')
  })

  it('marks compositions reachable from the root', () => {
    const scan = scanDocument(d)
    expect(scan.comps.map((c) => c.reachable)).toEqual([true, true, true, false])
  })

  it('counts glyph compositions as used', () => {
    const glyphs = doc([], {
      assets: [{ id: 'glyph', layers: [] }],
      chars: [{ ch: 'a', data: { refId: 'glyph' } }],
    })
    expect(scanDocument(glyphs).comps[1].reachable).toBe(true)
  })

  it('caches by document object; buildScan does not', () => {
    expect(scanDocument(d)).toBe(scanDocument(d))
    expect(buildScan(d)).not.toBe(scanDocument(d))
  })

  it('survives broken structures', () => {
    const broken = {
      layers: [null, 3, { ty: 4, shapes: 'x' }],
      assets: 'nope',
    } as unknown as ReturnType<typeof doc>
    const scan = scanDocument(broken)
    expect(scan.layers).toHaveLength(1)
    expect(scan.shapes).toHaveLength(0)
  })
})

const mask = (extra: J) => ({
  pt: p(
    bezier([
      [0, 0],
      [1, 1],
    ]),
  ),
  o: p(100),
  x: p(0),
  mode: 'a',
  inv: false,
  ...extra,
})

const text = (f: string): J => ({
  ...layer(1, {
    ty: 5,
    t: { d: { k: [{ s: { t: 'Ab', f, s: 10 }, t: 0 }] }, a: [{ s: {} }], p: { m: 0 } },
  }),
  shapes: undefined,
})

const gradient = (ty: string, values: number[], extra: J = {}): J => ({
  ty,
  g: { p: 2, k: p(values) },
  s: p([0, 0]),
  e: p([1, 1]),
  o: p(100),
  t: 1,
  ...extra,
})

describe('detectFeatures', () => {
  it('detects layer types and layer features', () => {
    const d = doc(
      [
        layer(1, { hd: true, mb: true, ao: 1, ddd: 1, sr: 2, bm: 3, ks: { sk: p(10) } }),
        precompLayer(2, 'c', { tm: kf([0, 0], [30, 1]) }),
        { ...nullLayer(3), bm: 8 },
        layer(4, { ty: 13, bm: 16 }),
        layer(5, { ty: 12, bm: 17 }),
        layer(6, { ty: 1, sc: '#ff0000', sw: 10, sh: 10 }),
      ],
      { assets: [{ id: 'c', layers: [] }] },
    )
    const f = features(d)
    expect(f.get('layer.hidden')).toEqual(['layers/0'])
    expect(f.get('layer.motionBlur')).toEqual(['layers/0'])
    expect(f.get('transform.autoOrient')).toEqual(['layers/0'])
    expect(f.get('transform.3d')).toEqual(['layers/0'])
    expect(f.get('time.stretch')).toEqual(['layers/0'])
    expect(f.get('transform.layerSkew')).toEqual(['layers/0/ks/sk'])
    expect(f.get('blend.basic')).toEqual(['layers/0'])
    expect(f.get('blend.advanced')).toEqual(['layers/2'])
    expect(f.get('blend.add')).toEqual(['layers/3'])
    expect(f.get('blend.hardMix')).toEqual(['layers/4'])
    expect(f.get('time.remap')).toEqual(['layers/1/tm'])
    expect(f.get('layer.camera')).toEqual(['layers/3'])
    expect(f.get('layer.unsupportedType')).toEqual(['layers/4'])
    expect(f.get('layer.solid')).toEqual(['layers/5'])
    expect(f.get('layer.null')).toEqual(['layers/2'])
  })

  it('treats a static zero skew as unused and 3D orientation as 3D', () => {
    const d = doc([layer(1, { ks: { sk: p(0), or: p([0, 0, 0]) } })])
    const f = features(d)
    expect(f.has('transform.layerSkew')).toBe(false)
    expect(f.get('transform.3d')).toEqual(['layers/0'])
  })

  it('detects mattes and matte parents', () => {
    const d = doc([
      layer(1, { td: 1 }),
      layer(2, { tt: 1 }),
      layer(3, { td: 1 }),
      layer(4, { tt: 3, tp: 3 }),
      layer(5, { td: 1, tt: 2 }),
      layer(6, { tt: 4 }),
    ])
    const f = features(d)
    expect(f.get('matte.alpha')).toEqual(['layers/1'])
    expect(f.get('matte.luma')).toEqual(['layers/3'])
    expect(f.get('matte.alphaInverted')).toEqual(['layers/4'])
    expect(f.get('matte.lumaInverted')).toEqual(['layers/5'])
    expect(f.get('matte.parent')).toEqual(['layers/3'])
    expect(f.get('matte.nested')).toEqual(['layers/4'])
  })

  it('detects mask modes and settings', () => {
    const d = doc([
      layer(1, {
        hasMask: true,
        masksProperties: [
          mask({}),
          mask({ mode: 's', inv: true }),
          mask({ mode: 'i', o: p(50) }),
          mask({ mode: 'l', x: p(4) }),
          mask({ mode: 'f', f: p(3) }),
          mask({ mode: 'd', o: kf([0, 100], [10, 50]) }),
        ],
      }),
    ])
    const f = features(d)
    expect(f.get('mask.any')).toEqual(['layers/0'])
    expect(f.get('mask.add')).toEqual(['layers/0/masksProperties/0'])
    expect(f.get('mask.subtract')).toEqual(['layers/0/masksProperties/1'])
    expect(f.get('mask.inverted')).toEqual(['layers/0/masksProperties/1'])
    expect(f.get('mask.intersect')).toEqual(['layers/0/masksProperties/2'])
    expect(f.get('mask.opacity')).toEqual([
      'layers/0/masksProperties/2',
      'layers/0/masksProperties/5',
    ])
    expect(f.get('mask.lightenDarken')).toEqual([
      'layers/0/masksProperties/3',
      'layers/0/masksProperties/5',
    ])
    expect(f.get('mask.expansion')).toEqual(['layers/0/masksProperties/3'])
    expect(f.get('mask.difference')).toEqual(['layers/0/masksProperties/4'])
    expect(f.get('mask.feather')).toEqual(['layers/0/masksProperties/4'])
  })

  it('tells glyph text from font text', () => {
    const d = doc([text('Glyph'), text('Plain')], {
      fonts: {
        list: [
          { fName: 'Glyph', fFamily: 'G', fStyle: 'Regular' },
          { fName: 'Plain', fFamily: 'P', fStyle: 'Bold' },
        ],
      },
      chars: [{ ch: 'A', fFamily: 'G', style: 'Regular', size: 10, w: 5, data: {} }],
    })
    const f = features(d)
    expect(f.get('text.glyphs')).toEqual(['layers/0/t/d'])
    expect(f.get('text.fonts')).toEqual(['layers/1/t/d'])
    expect(f.get('text.animators')).toEqual(['layers/0/t/a', 'layers/1/t/a'])
    expect(f.get('text.path')).toEqual(['layers/0/t/p', 'layers/1/t/p'])
    expect(f.get('layer.text')).toEqual(['layers/0', 'layers/1'])
  })

  it('detects effects by type and match name, and layer styles', () => {
    const d = doc([
      layer(1, {
        ef: [
          { ty: 5, mn: 'ADBE Slider Control', ef: [] },
          { ty: 29, mn: 'ADBE Gaussian Blur 2', ef: [] },
          { ty: 25, ef: [] },
          { ty: 7, mn: 'ADBE Fractal Noise', ef: [] },
          { ty: 31, mn: 'ADBE Mesh Warp', ef: [] },
          { ty: 35, ef: [] },
        ],
        sy: [{ ty: 1 }, { ty: 3 }],
      }),
    ])
    const f = features(d)
    expect(f.get('fx.any')).toEqual(['layers/0'])
    expect(f.get('fx.expressionControls')).toEqual(['layers/0/ef/0'])
    expect(f.get('fx.gaussianBlur')).toEqual(['layers/0/ef/1'])
    expect(f.get('fx.dropShadow')).toEqual(['layers/0/ef/2'])
    expect(f.get('fx.skottieOnly')).toEqual(['layers/0/ef/3'])
    expect(f.get('fx.unknown')).toEqual(['layers/0/ef/4'])
    expect(f.get('fx.transform')).toEqual(['layers/0/ef/5'])
    expect(f.get('style.dropShadow')).toEqual(['layers/0/sy/0'])
    expect(f.get('style.other')).toEqual(['layers/0/sy/1'])
  })

  it('detects shape items and paint features, including inside groups', () => {
    const d = doc([
      layer(1, {
        shapes: [
          group([
            { ty: 'sr', sy: 1 },
            gradient('gf', [0, 1, 0, 0, 1, 0, 0, 1], { r: 2 }),
            gradient('gs', [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0.5], {
              d: [{ n: 'd', v: p(4) }],
              w: p(1),
            }),
            { ty: 'tm', m: 2 },
            { ty: 'tm', m: 1 },
            { ty: 'rp' },
            { ty: 'rd' },
            { ty: 'mm', mm: 1 },
            { ty: 'op' },
            { ty: 'zz' },
            { ty: 'pb' },
            { ty: 'tw' },
          ]),
          stroke({ d: [{ n: 'd', v: p(2) }] }),
          fill({ r: 2, hd: true, bm: 3 }),
        ],
      }),
    ])
    const f = features(d)
    expect(f.get('paint.polystar')).toEqual(['layers/0/shapes/0/it/0'])
    expect(f.get('paint.gradient')).toEqual(['layers/0/shapes/0/it/1', 'layers/0/shapes/0/it/2'])
    expect(f.get('paint.gradientStroke')).toEqual(['layers/0/shapes/0/it/2'])
    expect(f.get('paint.gradientOpacity')).toEqual(['layers/0/shapes/0/it/2'])
    expect(f.get('paint.fillRuleEvenOdd')).toEqual(['layers/0/shapes/0/it/1', 'layers/0/shapes/2'])
    expect(f.get('paint.strokeDash')).toEqual(['layers/0/shapes/0/it/2', 'layers/0/shapes/1'])
    expect(f.get('mod.trimIndividually')).toEqual(['layers/0/shapes/0/it/3'])
    expect(f.get('mod.trim')).toEqual(['layers/0/shapes/0/it/4'])
    for (const id of [
      'mod.repeater',
      'mod.roundCorners',
      'mod.mergePaths',
      'mod.offsetPath',
      'mod.zigZag',
      'mod.puckerBloat',
      'mod.twist',
    ] as const) {
      expect(f.get(id), id).toHaveLength(1)
    }
    expect(f.get('paint.hiddenShape')).toEqual(['layers/0/shapes/2'])
    expect(f.get('blend.shape')).toEqual(['layers/0/shapes/2'])
  })

  it('reads gradient opacity from keyframes too', () => {
    const d = doc([
      layer(1, {
        shapes: [
          {
            ty: 'gf',
            g: { p: 1, k: kf([0, [0, 1, 1, 1, 0, 1]], [10, [0, 1, 1, 1, 0, 0.5]]) },
            s: p([0, 0]),
            e: p([1, 1]),
            o: p(100),
            t: 1,
          },
        ],
      }),
    ])
    expect(features(d).get('paint.gradientOpacity')).toEqual(['layers/0/shapes/0'])
  })

  it('finds expressions and slots anywhere, including text documents', () => {
    const d = doc(
      [
        layer(1, { ks: { o: { a: 0, k: 100, x: 'value * 2' }, p: { a: 0, k: [0, 0], x: '  ' } } }),
        {
          ...layer(2, {
            ty: 5,
            t: { d: { k: [{ s: { t: 'a', f: 'A', s: 1 }, t: 0 }], x: 'text' } },
          }),
          shapes: undefined,
        },
        layer(3, { shapes: [group([fill({ c: { a: 0, k: [1, 0, 0, 1], sid: 'brand' } })])] }),
      ],
      { slots: { brand: { p: { a: 0, k: [0, 0, 1, 1] } } } },
    )
    const f = features(d)
    expect(f.get('expressions')).toEqual(['layers/0/ks/o', 'layers/1/t/d'])
    expect(f.get('slots')).toEqual(['slots', 'layers/2/shapes/0/it/0/c'])
  })

  it('detects external images and sequences', () => {
    const d = doc([], {
      assets: [
        { id: 'a', w: 1, h: 1, u: 'images/', p: 'a.png', e: 0 },
        { id: 'b', w: 1, h: 1, u: '', p: 'data:image/png;base64,AAAA', e: 1 },
        { id: 'c', w: 1, h: 1, u: '', p: 'c_0.png', t: 'seq' },
      ],
    })
    const f = features(d)
    expect(f.get('image.external')).toEqual(['assets/0', 'assets/2'])
    expect(f.get('image.sequence')).toEqual(['assets/2'])
  })

  it('counts every occurrence but caps the paths', () => {
    const d = doc(Array.from({ length: 30 }, (_, i) => layer(i + 1, { hd: true })))
    const hit = detectFeatures(d, 10).get('layer.hidden')
    expect(hit?.count).toBe(30)
    expect(hit?.paths).toHaveLength(10)
  })

  it('finds nothing unusual in a plain shape animation', () => {
    const d = doc([layer(1, { ks: { p: kf([0, [0, 0, 0]], [30, [100, 0, 0]]) } })])
    const unusual = [...detectFeatures(d).keys()].filter((id) =>
      affectedPlayers(id).some((a) => a.player !== 'telegram'),
    )
    expect(unusual).toEqual([])
  })
})

describe('matteSourceIndex', () => {
  const layers: J[] = [
    { ind: 1, td: 1 },
    { ind: 5, tt: 1 },
    { ind: 7, td: 1 },
    { ind: 8, tt: 1, tp: 1 },
    { ind: 9, tt: 1 },
  ]

  it('uses tp, else the layer above (SVG, ThorVG, Skottie)', () => {
    expect(matteSourceIndex(layers, 1, 'web-svg')).toBe(0)
    expect(matteSourceIndex(layers, 3, 'web-svg')).toBe(0)
    expect(matteSourceIndex(layers, 4, 'web-svg')).toBe(3)
  })

  it('looks up ind − 1 in the canvas renderer', () => {
    expect(matteSourceIndex(layers, 1, 'web-canvas')).toBe(-1)
    expect(matteSourceIndex(layers, 4, 'web-canvas')).toBe(3)
  })

  it('always uses the layer above in adjacency players', () => {
    expect(matteSourceIndex(layers, 3, 'adjacent')).toBe(2)
  })

  it('returns -1 for layers without a matte or without a source', () => {
    expect(matteSourceIndex(layers, 0, 'web-svg')).toBe(-1)
    expect(matteSourceIndex([{ ind: 1, tt: 1 }], 0, 'web-svg')).toBe(-1)
    expect(matteSourceIndex([{ ind: 1, tt: 1, tp: 42 }], 0, 'web-svg')).toBe(-1)
  })
})

describe('findParentCycles', () => {
  it('finds self-parenting and loops once, starting at the lowest index', () => {
    const layers: J[] = [
      { ind: 1, parent: 1 },
      { ind: 2, parent: 3 },
      { ind: 3, parent: 4 },
      { ind: 4, parent: 2 },
      { ind: 5, parent: 2 },
      { ind: 6 },
    ]
    expect(findParentCycles(layers)).toEqual([[0], [1, 2, 3]])
  })

  it('ignores chains and missing parents', () => {
    expect(
      findParentCycles([
        { ind: 1 },
        { ind: 2, parent: 1 },
        { ind: 3, parent: 2 },
        { ind: 4, parent: 99 },
      ]),
    ).toEqual([])
  })

  it('follows the first layer when inds are duplicated', () => {
    expect(findParentCycles([{ ind: 1, parent: 2 }, { ind: 2, parent: 1 }, { ind: 1 }])).toEqual([
      [0, 1],
    ])
  })
})

describe('findPrecompCycles', () => {
  it('finds self and mutual recursion', () => {
    const d = doc([], {
      assets: [
        { id: 'a', layers: [precompLayer(1, 'a')] },
        { id: 'b', layers: [precompLayer(1, 'c')] },
        { id: 'c', layers: [precompLayer(1, 'b')] },
        { id: 'd', layers: [precompLayer(1, 'b')] },
      ],
    })
    expect(findPrecompCycles(d).sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns nothing for trees', () => {
    const d = doc([precompLayer(1, 'a')], {
      assets: [
        { id: 'a', layers: [precompLayer(1, 'b')] },
        { id: 'b', layers: [] },
      ],
    })
    expect(findPrecompCycles(d)).toEqual([])
  })
})
