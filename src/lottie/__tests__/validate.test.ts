import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { pathKey } from '../path'
import type { Animation } from '../types'
import {
  applyFixes,
  canFix,
  issuesForTarget,
  playerLevels,
  summarizeIssues,
  validate,
  type Issue,
  type IssueCode,
  type ValidateContext,
} from '../validate'
import {
  bezier,
  doc,
  fill,
  group,
  imageAsset,
  jpegUri,
  kf,
  layer,
  nullLayer,
  p,
  path,
  pngUri,
  precompLayer,
  rect,
  tr,
  type J,
} from './insights.fixtures'
import testJsonText from '../../../docs/test.json?raw'
import bounceText from '../../samples/bounce.json?raw'
import gradientBlobText from '../../samples/gradient-blob.json?raw'
import likeText from '../../samples/like.json?raw'
import loaderText from '../../samples/loader.json?raw'
import orbitText from '../../samples/orbit.json?raw'
import successText from '../../samples/success.json?raw'
import toggleText from '../../samples/toggle.json?raw'
import typingText from '../../samples/typing.json?raw'

const FILES: Record<string, string> = {
  'docs/test.json': testJsonText,
  bounce: bounceText,
  loader: loaderText,
  success: successText,
  like: likeText,
  'gradient-blob': gradientBlobText,
  typing: typingText,
  toggle: toggleText,
  orbit: orbitText,
}
const load = (name: string) => JSON.parse(FILES[name]) as Animation

const ALL_CODES = (d: Animation, ctx?: ValidateContext) => validate(d, ctx).map((i) => i.code)

function issue(d: Animation, code: IssueCode, match: Record<string, unknown> = {}): Issue {
  const found = validate(d).find(
    (i) => i.code === code && Object.entries(match).every(([k, v]) => i.params[k] === v),
  )
  if (!found) throw new Error(`No ${code} issue; got ${ALL_CODES(d).join(', ')}`)
  return found
}

function has(d: Animation, code: IssueCode, match: Record<string, unknown> = {}): boolean {
  return validate(d).some(
    (i) => i.code === code && Object.entries(match).every(([k, v]) => i.params[k] === v),
  )
}

/** Applies the fixes of the given issues like the app does (inside an immer recipe). */
function fix(d: Animation, issues: Issue | Issue[], only?: (string | number)[][]): Animation {
  const list = Array.isArray(issues) ? issues : [issues]
  return produce(d, (draft) => {
    applyFixes(draft as Animation, list, only)
  })
}

const paths = (i: Issue) => i.paths.map(pathKey)
const L = (d: Animation, i: number) => (d.layers as unknown as J[])[i]

/** A clean 512 × 512, 60 fps, 3 s document (no issues for any target, Telegram included). */
const clean = (layers: J[] = [layer(1)], extra: J = {}) =>
  doc(layers, { fr: 60, op: 180, ...extra })

describe('clean documents', () => {
  it('reports nothing for a well-formed animation', () => {
    expect(
      validate(
        clean([
          layer(1),
          layer(2, { parent: 1 }),
          layer(3, { ks: { p: kf([0, [0, 0, 0]], [30, [10, 0, 0]]) } }),
        ]),
      ),
    ).toEqual([])
  })

  it('has no errors in the real-world test file', () => {
    const d = load('docs/test.json')
    const all = issuesForTarget(validate(d), 'all')
    expect(summarizeIssues(all)).toMatchObject({ errors: 0, warnings: 1, infos: 1 })
    expect(all.map((i) => i.params.feature)).toEqual(['expressions', 'paint.gradientOpacity'])
    expect(all[0].paths.map(pathKey)).toEqual(['layers/17/shapes/5/it/5/s'])
  })

  it('has no issues in the built-in samples for general players', () => {
    for (const id of ['bounce', 'loader', 'success', 'gradient-blob', 'toggle', 'orbit']) {
      const d = load(id)
      expect(issuesForTarget(validate(d), 'all'), id).toEqual([])
    }
  })
})

describe('document', () => {
  it('checks frame rate, range and size', () => {
    expect(ALL_CODES(doc([layer(1)], { fr: 0 }))).toContain('doc.frameRate')
    expect(ALL_CODES(doc([layer(1)], { ip: 10, op: 10 }))).toContain('doc.range')
    expect(ALL_CODES(doc([layer(1)], { w: 0 }))).toContain('doc.size')
  })

  it('repairs a missing or malformed version without changing its meaning', () => {
    const missing = doc([layer(1)], { v: undefined })
    const i = issue(missing, 'doc.version')
    expect(i.platforms).toEqual([{ player: 'ios', level: 'x' }])
    expect(i.safe).toBe(true)
    expect(fix(missing, i).v).toBe('5.12.0')

    const short = doc([layer(1)], { v: '5.7' })
    const j = issue(short, 'doc.version', { value: '5.7' })
    expect(j.platforms).toEqual([{ player: 'android', level: 'x' }])
    expect(fix(short, j).v).toBe('5.7.0')
    expect(
      fix(doc([], { v: '5.7.1-beta' }), issue(doc([], { v: '5.7.1-beta' }), 'doc.version')).v,
    ).toBe('5.7.1')
  })

  it('flags legacy versions, with a warning when colors are 0–255', () => {
    expect(issue(doc([], { v: '4.1.0' }), 'doc.legacyVersion')).toMatchObject({
      severity: 'warning',
      params: { colors: 1 },
    })
    expect(issue(doc([], { v: '4.8.0' }), 'doc.legacyVersion')).toMatchObject({
      severity: 'info',
      params: { colors: 0 },
    })
    expect(has(doc([], { v: '5.0.0' }), 'doc.legacyVersion')).toBe(false)
  })

  it('rounds a fractional canvas size', () => {
    const d = doc([layer(1)], { w: 512.4 })
    const i = issue(d, 'value.notInteger', { field: 'w' })
    expect(i.safe).toBe(true)
    expect(fix(d, i).w).toBe(512)
  })

  it('warns about heavy documents', () => {
    const many = doc(Array.from({ length: 500 }, (_, i) => layer(i + 1)))
    expect(issue(many, 'perf.layers').params.count).toBe(500)
    const masks = doc([
      layer(1, {
        hasMask: true,
        masksProperties: Array.from({ length: 50 }, () => ({
          mode: 'a',
          pt: p(bezier([[0, 0]])),
          o: p(100),
          x: p(0),
        })),
      }),
    ])
    expect(has(masks, 'perf.masks')).toBe(true)
    const keys = doc([
      layer(1, {
        ks: {
          o: kf(...Array.from({ length: 10_000 }, (_, i) => [i, i % 100] as [number, number])),
        },
      }),
    ])
    expect(issue(keys, 'perf.keyframes').params.count).toBe(10_000)
    expect(issue(doc([layer(1)], { op: 1000 }), 'perf.frames').severity).toBe('info')
    expect(issue(doc([layer(1)], { w: 5000 }), 'perf.canvas').params).toEqual({
      width: 5000,
      height: 512,
    })
    expect(ALL_CODES(doc([layer(1)]), { rawBytes: 6 * 1024 * 1024 })).toContain('perf.fileSize')
    expect(ALL_CODES(doc([layer(1)]), { rawBytes: 1024 })).not.toContain('perf.fileSize')
  })
})

const codes = (d: Animation, ctx?: ValidateContext) =>
  issuesForTarget(validate(d, ctx), 'telegram')
    .map((i) => i.code)
    .filter((c) => c.startsWith('telegram'))

describe('Telegram stickers', () => {
  it('checks size, frame rate, duration and compressed size', () => {
    expect(codes(clean(), { gzipBytes: 60_000 })).toEqual([])
    expect(codes(doc([layer(1)], { w: 500, fr: 30, op: 150 }), { gzipBytes: 70_000 })).toEqual([
      'telegram.size',
      'telegram.fps',
      'telegram.duration',
      'telegram.fileSize',
    ])
  })

  it('treats forbidden features as errors for Telegram only', () => {
    const d = clean([layer(1, { ks: { o: { a: 0, k: 100, x: 'value' } } })])
    const expr = issuesForTarget(validate(d), 'telegram').find(
      (i) => i.params.feature === 'expressions',
    )
    expect(expr?.severity).toBe('error')
    expect(
      issuesForTarget(validate(d), 'all').find((i) => i.params.feature === 'expressions')?.severity,
    ).toBe('warning')
    expect(issuesForTarget(validate(d), 'web')).toEqual([])
  })
})

describe('layers', () => {
  it('assigns missing indices', () => {
    const d = doc([layer(1), layer(0, { ind: undefined }), layer(7)])
    const i = issue(d, 'layer.missingInd')
    expect(paths(i)).toEqual(['layers/1'])
    expect(fix(d, i).layers.map((l) => l.ind)).toEqual([1, 8, 7])
  })

  it('renumbers duplicate indices, safe only when nothing points at them', () => {
    const unreferenced = doc([layer(1), layer(1), layer(2)])
    const a = issue(unreferenced, 'layer.duplicateInd')
    expect(a).toMatchObject({ severity: 'error', safe: true, params: { ind: 1 } })
    expect(paths(a)).toEqual(['layers/0', 'layers/1'])
    expect(fix(unreferenced, a).layers.map((l) => l.ind)).toEqual([1, 3, 2])

    const referenced = doc([layer(1), layer(1), layer(2, { parent: 1 })])
    const b = issue(referenced, 'layer.duplicateInd')
    expect(b.safe).toBe(false)
    const fixed = fix(referenced, b)
    expect(fixed.layers.map((l) => l.ind)).toEqual([1, 3, 2])
    expect(fixed.layers[2].parent).toBe(1)
  })

  it('removes parents that point nowhere', () => {
    const d = doc([layer(1, { parent: 9 }), layer(2, { parent: 1 })])
    const i = issue(d, 'layer.parentMissing', { ind: '9' })
    expect(i.safe).toBe(true)
    const fixed = fix(d, i)
    expect(L(fixed, 0).parent).toBeUndefined()
    expect(L(fixed, 1).parent).toBe(1)
  })

  it('breaks parent loops', () => {
    const d = doc([
      layer(1, { parent: 1 }),
      layer(2, { parent: 3 }),
      layer(3, { parent: 2 }),
      layer(4, { parent: 2 }),
    ])
    const i = issue(d, 'layer.parentCycle')
    expect(i.count).toBe(2)
    expect(paths(i)).toEqual(['layers/0', 'layers/1', 'layers/2'])
    const fixed = fix(d, i)
    expect(has(fixed, 'layer.parentCycle')).toBe(false)
    expect(L(fixed, 2).parent).toBe(2)
    expect(L(fixed, 3).parent).toBe(2)
  })

  it('repairs timing and transform', () => {
    const d = doc([
      layer(1, { sr: 0 }),
      layer(2, { st: undefined }),
      layer(3, { ip: undefined }),
      layer(4, { ks: undefined }),
    ])
    expect(fix(d, issue(d, 'layer.stretchZero')).layers[0].sr).toBe(1)
    expect(fix(d, issue(d, 'layer.missingStart')).layers[1].st).toBe(0)
    const inOut = issue(d, 'layer.missingInOut')
    expect(inOut.safe).toBe(false)
    expect(fix(d, inOut).layers[2]).toMatchObject({ ip: 0, op: 60 })
    const ks = fix(d, issue(d, 'layer.missingTransform')).layers[3].ks
    expect(ks).toMatchObject({ o: { k: 100 }, s: { k: [100, 100, 100] } })
  })

  it('finds layers that are never visible', () => {
    const d = doc(
      [
        layer(1, { ip: 10, op: 10 }),
        layer(2, { ip: 60, op: 90 }),
        precompLayer(3, 'a', { ip: 0, op: 30 }),
      ],
      {
        assets: [
          { id: 'a', layers: [layer(1, { ip: 40, op: 50 }), layer(2)] },
          { id: 'unused', layers: [layer(1, { ip: 500, op: 600 })] },
        ],
      },
    )
    expect(paths(issue(d, 'layer.neverVisible', { reason: 'empty' }))).toEqual(['layers/0'])
    expect(paths(issue(d, 'layer.neverVisible', { reason: 'outside' }))).toEqual([
      'layers/1',
      'assets/0/layers/0',
    ])
  })

  it('reorders ddd before ks for ThorVG', () => {
    const l = layer(1)
    delete l.ddd
    const d = doc([{ ...l, ddd: 1 }])
    const i = issue(d, 'layer.keyOrder3d')
    expect(i.platforms).toEqual([{ player: 'thorvg', level: 'x' }])
    const keys = Object.keys(L(fix(d, i), 0))
    expect(keys.indexOf('ddd')).toBeLessThan(keys.indexOf('ks'))
  })

  it('rounds fractional indices consistently and flags fractional enums as unsafe', () => {
    const d = doc([layer(1.5), layer(2, { parent: 1.5, bm: 1.5 })])
    const ind = issue(d, 'value.notInteger', { field: 'ind' })
    const parent = issue(d, 'value.notInteger', { field: 'parent' })
    expect(ind.safe && parent.safe).toBe(true)
    expect(issue(d, 'value.notInteger', { field: 'bm' }).safe).toBe(false)
    const fixed = fix(d, [ind, parent])
    expect(fixed.layers[0].ind).toBe(2)
    expect(fixed.layers[1].parent).toBe(2)
  })

  it('converts numeric booleans', () => {
    const d = doc([layer(1, { hd: 1 })])
    const i = issue(d, 'value.notBoolean', { field: 'hd' })
    expect(i.platforms?.map((x) => x.player)).toEqual(['android', 'thorvg', 'skottie'])
    expect(fix(d, i).layers[0].hd).toBe(true)
  })
})

describe('assets', () => {
  it('reports missing and mismatched references', () => {
    const d = doc(
      [
        precompLayer(1, 'nope'),
        layer(2, { ty: 2, refId: 'comp' }),
        layer(3, { ty: 2, refId: 'img' }),
      ],
      {
        assets: [{ id: 'comp', layers: [] }, imageAsset('img', pngUri(2, 2), 2, 2)],
      },
    )
    const missing = validate(d).filter((i) => i.code === 'asset.missing')
    expect(missing.map((i) => [i.params.id, i.params.kind, paths(i)])).toEqual([
      ['nope', 'precomp', ['layers/0']],
      ['comp', 'image', ['layers/1']],
    ])
  })

  it('finds precomposition recursion', () => {
    const d = doc([precompLayer(1, 'a')], { assets: [{ id: 'a', layers: [precompLayer(1, 'a')] }] })
    expect(paths(issue(d, 'asset.cycle'))).toEqual(['assets/0'])
  })

  it('renames duplicate asset ids', () => {
    const d = doc([precompLayer(1, 'a')], {
      assets: [
        { id: 'a', layers: [] },
        { id: 'a', layers: [layer(1)] },
      ],
    })
    const i = issue(d, 'asset.duplicateId', { id: 'a' })
    expect(paths(i)).toEqual(['assets/1'])
    expect(fix(d, i).assets?.map((a) => a.id)).toEqual(['a', 'a_2'])
  })

  it('removes unused assets, following precompositions', () => {
    const d = doc([precompLayer(1, 'used')], {
      assets: [
        { id: 'used', layers: [layer(1, { ty: 2, refId: 'img1' })] },
        { id: 'orphan', layers: [layer(1, { ty: 2, refId: 'img2' })] },
        imageAsset('img1', pngUri(1, 1), 1, 1),
        imageAsset('img2', pngUri(1, 1), 1, 1),
        imageAsset('img3', pngUri(1, 1), 1, 1),
      ],
    })
    const i = issue(d, 'asset.unused')
    expect(i).toMatchObject({ severity: 'info', safe: true })
    expect(paths(i)).toEqual(['assets/1', 'assets/3', 'assets/4'])
    expect(fix(d, i).assets?.map((a) => a.id)).toEqual(['used', 'img1'])
  })

  it('gives precompositions a size', () => {
    const d = doc([precompLayer(1, 'a', { w: undefined, h: undefined })], {
      assets: [{ id: 'a', w: 100, h: 50, layers: [] }],
    })
    const i = issue(d, 'precomp.missingSize')
    expect(i.safe).toBe(false)
    expect(fix(d, i).layers[0]).toMatchObject({ w: 100, h: 50 })
  })

  it('completes image assets from the file header', () => {
    const noU = doc([], { assets: [{ id: 'a', w: 4, h: 4, p: pngUri(4, 4), e: 1 }] })
    const a = issue(noU, 'image.missingFields')
    expect(a).toMatchObject({ safe: true, fix: 'completeImage' })
    expect(fix(noU, a).assets?.[0]).toMatchObject({ u: '' })

    const noSize = doc([], { assets: [{ id: 'b', u: '', p: jpegUri(64, 32), e: 1 }] })
    const b = issue(noSize, 'image.missingFields')
    expect(b.safe).toBe(false)
    expect(fix(noSize, b).assets?.[0]).toMatchObject({ w: 64, h: 32 })

    const external = doc([], { assets: [{ id: 'c', u: 'images/', p: 'c.png' }] })
    expect(issue(external, 'image.missingFields').fix).toBeUndefined()
  })

  it('distinguishes external files and URLs', () => {
    const d = doc([], {
      assets: [
        { id: 'a', w: 1, h: 1, u: 'images/', p: 'a.png', e: 0 },
        { id: 'b', w: 1, h: 1, u: '', p: 'https://example.com/b.png', e: 0 },
      ],
    })
    expect(paths(issue(d, 'image.external', { kind: 'file' }))).toEqual(['assets/0'])
    expect(paths(issue(d, 'image.external', { kind: 'url' }))).toEqual(['assets/1'])
  })

  it('flags huge, stretched and oversized images', () => {
    const huge = doc([], { assets: [imageAsset('a', pngUri(100, 100, 6, 600 * 1024), 100, 100)] })
    expect(issue(huge, 'image.huge').params.bytes).toBeGreaterThan(500 * 1024)
    const stretched = doc([], { assets: [imageAsset('b', pngUri(200, 100), 100, 100)] })
    expect(issue(stretched, 'image.aspect').params).toEqual({
      declared: '100 × 100',
      actual: '200 × 100',
    })
    const oversized = doc([], {
      assets: [imageAsset('c', pngUri(2000, 2000, 6, 120 * 1024), 200, 200)],
    })
    expect(issue(oversized, 'image.oversized').severity).toBe('info')
    const retina = doc([], { assets: [imageAsset('d', pngUri(400, 400, 6, 120 * 1024), 200, 200)] })
    expect(has(retina, 'image.oversized')).toBe(false)
  })
})

const gradient = (values: unknown) => ({
  ty: 'gf',
  g: { p: 2, k: values },
  s: p([0, 0]),
  e: p([1, 1]),
  o: p(100),
  t: 1,
})

describe('shapes', () => {
  it('adds a missing shapes list and reports empty shape layers', () => {
    const d = doc([
      layer(1, { shapes: undefined }),
      layer(2, { shapes: [group([fill()])] }),
      layer(3, { shapes: [], td: 1 }),
      layer(4, { tt: 1 }),
    ])
    const missing = issue(d, 'shape.missingShapes')
    expect(fix(d, missing).layers[0]).toMatchObject({ shapes: [] })
    // Layer 3 is a matte source: empty on purpose.
    expect(paths(issue(d, 'shape.emptyLayer'))).toEqual(['layers/1'])
  })

  it('normalizes group transforms', () => {
    const noTr = { ty: 'gr', it: [rect(), fill()] }
    const early = { ty: 'gr', it: [tr(), rect(), fill()] }
    const twice = { ty: 'gr', it: [rect(), tr({ o: p(50) }), fill(), tr({ o: p(20) })] }
    const d = doc([layer(1, { shapes: [noTr, early, twice, { ty: 'gr' }] })])
    const missing = issue(d, 'shape.groupTransform', { reason: 'missing' })
    expect(missing.platforms?.map((x) => x.player)).toEqual(['web-svg', 'web-canvas'])
    const order = issue(d, 'shape.groupTransform', { reason: 'order' })
    const multiple = issue(d, 'shape.groupTransform', { reason: 'multiple' })
    const noItems = issue(d, 'shape.groupNoItems')
    const fixed = fix(d, [missing, order, multiple, noItems])
    const shapes = (fixed.layers[0] as unknown as { shapes: { it: J[] }[] }).shapes
    for (const g of shapes) {
      expect(g.it[g.it.length - 1].ty).toBe('tr')
      expect(g.it.filter((x) => x.ty === 'tr')).toHaveLength(1)
    }
    expect(shapes[2].it[2]).toMatchObject({ o: { k: 20 } })
    expect(has(fixed, 'shape.groupTransform')).toBe(false)
  })

  it('repairs path tangents but not broken vertices', () => {
    const shortTangents = {
      v: [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      i: [[0, 0]],
      o: 'x',
      c: true,
    }
    const brokenVertices = { v: [[0, 0], 'bad'], i: [], o: [], c: false }
    const d = doc([
      layer(1, { shapes: [path({ ks: p(shortTangents) }), path({ ks: p(brokenVertices) })] }),
    ])
    const list = validate(d).filter((i) => i.code === 'shape.pathMalformed')
    expect(list.map((i) => [paths(i), i.fix])).toEqual([
      [['layers/0/shapes/0/ks'], 'repairPath'],
      [['layers/0/shapes/1/ks'], undefined],
    ])
    const fixed = fix(d, list[0])
    const ks = (fixed.layers[0] as unknown as { shapes: { ks: { k: J } }[] }).shapes[0].ks.k
    expect(ks.i).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
    expect(ks.o).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
  })

  it('flags path morphs with different vertex counts', () => {
    const d = doc([
      layer(1, {
        shapes: [
          path({
            ks: kf(
              [
                0,
                bezier([
                  [0, 0],
                  [1, 1],
                ]),
              ],
              [
                10,
                bezier([
                  [0, 0],
                  [1, 1],
                  [2, 2],
                ]),
              ],
            ),
          }),
        ],
      }),
    ])
    expect(paths(issue(d, 'shape.vertexCount'))).toEqual(['layers/0/shapes/0/ks'])
  })

  it('removes the internal "ms" item', () => {
    const d = doc([layer(1, { shapes: [group([rect(), fill(), { ty: 'ms' }])] })])
    const fixed = fix(d, issue(d, 'shape.internal'))
    expect(
      (fixed.layers[0] as unknown as { shapes: { it: J[] }[] }).shapes[0].it.map((x) => x.ty),
    ).toEqual(['rc', 'fl', 'tr'])
  })

  it('checks gradient data against the stop count', () => {
    const ok = doc([layer(1, { shapes: [gradient(p([0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1]))] })])
    expect(has(ok, 'gradient.stops')).toBe(false)
    const short = doc([layer(1, { shapes: [gradient(p([0, 1, 0, 0]))] })])
    expect(has(short, 'gradient.stops')).toBe(true)
    const odd = doc([
      layer(1, {
        shapes: [gradient(kf([0, [0, 1, 0, 0, 1, 0, 0, 1, 0]], [10, [0, 1, 0, 0, 1, 0, 0, 1, 0]]))],
      }),
    ])
    expect(has(odd, 'gradient.stops')).toBe(true)
  })

  it('adds known defaults for missing required properties', () => {
    const d = doc([
      layer(1, {
        shapes: [
          group([
            { ty: 'rc', p: p([0, 0]), s: p([10, 10]) },
            { ty: 'fl', c: p([1, 1, 1, 1]) },
            { ty: 'el', p: p([0, 0]) },
          ]),
        ],
      }),
    ])
    const list = validate(d).filter((i) => i.code === 'prop.missing')
    expect(list.map((i) => [i.params.key, i.fix ?? null])).toEqual([
      ['r', 'addDefaultProperty'],
      ['o', 'addDefaultProperty'],
      ['s', null],
    ])
    const fixed = fix(d, list.filter(canFix))
    const it0 = (fixed.layers[0] as unknown as { shapes: { it: J[] }[] }).shapes[0].it
    expect(it0[0].r).toEqual({ a: 0, k: 0 })
    expect(it0[1].o).toEqual({ a: 0, k: 100 })
  })
})

describe('properties', () => {
  it('turns single keyframes into static values', () => {
    const d = doc([
      layer(1, {
        ks: { o: { a: 1, k: [{ t: 0, s: [50] }] }, p: { a: 1, k: [{ t: 5, s: [1, 2, 0] }] } },
        shapes: [
          path({
            ks: {
              a: 1,
              k: [
                {
                  t: 0,
                  s: [
                    bezier([
                      [0, 0],
                      [5, 5],
                    ]),
                  ],
                },
              ],
            },
          }),
        ],
      }),
    ])
    const i = issue(d, 'prop.singleKeyframe')
    expect(i.count).toBe(3)
    expect(i.platforms?.map((x) => x.player)).toEqual(['web-svg', 'web-canvas', 'web-html'])
    const fixed = L(fix(d, i), 0) as { ks: J; shapes: { ks: J }[] }
    expect(fixed.ks.o).toEqual({ a: 0, k: 50 })
    expect(fixed.ks.p).toEqual({ a: 0, k: [1, 2, 0] })
    expect(fixed.shapes[0].ks.k).toEqual(
      bezier([
        [0, 0],
        [5, 5],
      ]),
    )
  })

  it('adds linear easing where it is missing, matching per-dimension handles', () => {
    const d = doc([
      layer(1, {
        ks: {
          o: {
            a: 1,
            k: [
              { t: 0, s: [0] },
              { t: 10, s: [100] },
            ],
          },
          s: {
            a: 1,
            k: [
              { t: 0, s: [0, 0, 100], o: { x: [0.2, 0.2, 0.2], y: [0, 0, 0] } },
              { t: 10, s: [100, 100, 100] },
            ],
          },
          r: {
            a: 1,
            k: [
              { t: 0, s: [0], h: 1 },
              { t: 10, s: [90] },
            ],
          },
        },
      }),
    ])
    const i = issue(d, 'prop.missingEasing')
    expect(paths(i)).toEqual(['layers/0/ks/o', 'layers/0/ks/s'])
    const ks = (L(fix(d, i), 0) as { ks: Record<string, { k: J[] }> }).ks
    expect(ks.o.k[0]).toMatchObject({ o: { x: 0, y: 0 }, i: { x: 1, y: 1 } })
    expect(ks.s.k[0].i).toEqual({ x: [1, 1, 1], y: [1, 1, 1] })
  })

  it('sorts keyframes, converting legacy end values first', () => {
    const d = doc([
      layer(1, {
        ks: {
          o: {
            a: 1,
            k: [
              { t: 10, s: [100], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
              { t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
              { t: 20, s: [50] },
            ],
          },
        },
      }),
    ])
    const fixed = L(fix(d, issue(d, 'prop.unsorted')), 0) as { ks: { o: { k: J[] } } }
    expect(fixed.ks.o.k.map((k) => k.t)).toEqual([0, 10, 20])
  })

  it('syncs the animated flag', () => {
    const d = doc([
      layer(1, {
        ks: {
          o: {
            a: 0,
            k: [
              { t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
              { t: 10, s: [100] },
            ],
          },
          r: { a: 1, k: 45 },
        },
      }),
    ])
    const list = validate(d).filter((i) => i.code === 'prop.animatedFlag')
    expect(list.map((i) => [paths(i), i.platforms?.map((x) => x.player)])).toEqual([
      [['layers/0/ks/o'], ['skottie']],
      [['layers/0/ks/r'], ['web-svg', 'web-canvas', 'web-html']],
    ])
    const ks = (L(fix(d, list), 0) as { ks: Record<string, J> }).ks
    expect(ks.o.a).toBe(1)
    expect(ks.r.a).toBe(0)
  })

  it('converts legacy keyframes', () => {
    const d = doc([
      layer(1, {
        ks: {
          o: { k: [{ t: 0, s: [0], e: [100], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 10 }] },
        },
      }),
    ])
    const i = issue(d, 'prop.legacyKeyframes')
    expect(i.severity).toBe('info')
    const k = (L(fix(d, i), 0) as { ks: { o: { k: J[] } } }).ks.o.k
    expect(k[0].e).toBeUndefined()
    expect(k[1].s).toEqual([100])
  })

  it('completes 3D rotations and reports split positions without dimensions', () => {
    const d = doc([layer(1, { ks: { rx: p(10), p: { s: true, x: p(1) } } })])
    const i = issue(d, 'prop.incomplete3d')
    const ks = (L(fix(d, i), 0) as { ks: J }).ks
    expect(Object.keys(ks)).toEqual(expect.arrayContaining(['rx', 'ry', 'rz', 'or']))
    expect(has(d, 'prop.splitPosition')).toBe(true)
  })

  it('finds null and non-finite numbers and zeroes them on request', () => {
    const d = doc([
      layer(1, {
        ks: {
          o: {
            a: 1,
            k: [
              { t: 0, s: [null], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
              { t: null, s: [100] },
            ],
          },
          r: p(Number.NaN),
        },
      }),
    ])
    const i = issue(d, 'value.nonFinite')
    expect(i.safe).toBe(false)
    expect(paths(i)).toEqual(['layers/0/ks/o/k/0/s/0', 'layers/0/ks/o/k/1/t', 'layers/0/ks/r/k'])
    const ks = (L(fix(d, i), 0) as { ks: { o: { k: J[] }; r: J } }).ks
    expect(ks.o.k[0].s).toEqual([0])
    expect(ks.o.k[1].t).toBe(0)
    expect(ks.r.k).toBe(0)
  })

  it('reports damaged keyframes instead of crashing, and removes them', () => {
    const lin = { o: { x: 0.5, y: 0.5 }, i: { x: 0.5, y: 0.5 } }
    const d = doc([
      layer(1, {
        ks: {
          o: { a: 1, k: [{ t: 0, s: [0], ...lin }, null, { s: [50] }, 7, { t: 20, s: [100] }] },
          p: {
            a: 1,
            k: [
              { t: 0, s: [0, 0, 0], ...lin },
              { t: 10, s: [10, 10, 0] },
            ],
          },
        },
        shapes: [
          group([
            {
              ty: 'sh',
              ks: {
                a: 1,
                k: [
                  {
                    t: 0,
                    s: [
                      bezier([
                        [0, 0],
                        [1, 1],
                      ]),
                    ],
                    ...lin,
                  },
                  null,
                  {
                    t: 9,
                    s: [
                      bezier([
                        [0, 0],
                        [2, 2],
                      ]),
                    ],
                  },
                ],
              },
            },
            fill({ c: { a: 1, k: [{ t: 0, s: [1, 0, 0, 1], ...lin }, 'oops'] } }),
          ]),
        ],
      }),
      layer(2, { ty: 5, t: { d: { k: [{ t: 0, s: { t: 'Hi', f: 'F', s: 10 } }, null] } } }),
    ])
    let issues: Issue[] = []
    expect(() => (issues = validate(d))).not.toThrow()
    const bad = issues.find((i) => i.code === 'prop.badKeyframe')!
    expect(bad.severity).toBe('error')
    expect(bad.safe).toBe(true)
    expect(paths(bad).sort()).toEqual([
      'layers/0/ks/o/k/1',
      'layers/0/ks/o/k/2',
      'layers/0/ks/o/k/3',
      'layers/0/shapes/0/it/0/ks/k/1',
      'layers/0/shapes/0/it/1/c/k/1',
      'layers/1/t/d/k/1',
    ])
    // Checks that assume keyframe objects are skipped for damaged lists.
    expect(
      issues.some(
        (i) => i.code === 'prop.missingEasing' && pathKey(i.paths[0]).startsWith('layers/0/ks/o'),
      ),
    ).toBe(false)
    const fixed = fix(d, bad)
    const o = (L(fixed, 0).ks as { o: { k: J[] } }).o
    expect(o.k.map((key) => key.t)).toEqual([0, 20])
    expect(validate(fixed).some((i) => i.code === 'prop.badKeyframe')).toBe(false)
    // Every safe fix together leaves nothing safe to fix.
    const all = fix(
      d,
      validate(d).filter((i) => i.fix && i.safe),
    )
    expect(() => validate(all)).not.toThrow()
  })
})

describe('mattes', () => {
  it('reports matted layers without a source', () => {
    const d = doc([layer(1, { tt: 1 }), layer(2, { tt: 1, tp: 42 })])
    expect(
      validate(d)
        .filter((i) => i.code === 'matte.noSource')
        .map((i) => i.params.reason),
    ).toEqual(['first', 'parent'])
  })

  it('flags sources that are not marked as mattes', () => {
    const d = doc([layer(1), layer(2, { tt: 1 }), layer(3, { td: true }), layer(4, { tt: 1 })])
    const missing = issue(d, 'matte.sourceFlag', { state: 'missing' })
    expect(missing).toMatchObject({ safe: false })
    const bool = issue(d, 'matte.sourceFlag', { state: 'value' })
    expect(bool).toMatchObject({ safe: true, platforms: [{ player: 'web-canvas', level: 'x' }] })
    const fixed = fix(d, [missing, bool])
    expect([L(fixed, 0).td, L(fixed, 2).td]).toEqual([1, 1])
  })

  it('unhides hidden sources and drops explicit visibility', () => {
    const d = doc([
      layer(1, { td: 1, hd: true }),
      layer(2, { tt: 1 }),
      layer(3, { td: 1, hd: false }),
      layer(4, { tt: 1 }),
    ])
    const hidden = issue(d, 'matte.hiddenSource')
    const visible = issue(d, 'matte.explicitVisible')
    expect(visible.platforms).toEqual([{ player: 'skottie', level: 'x' }])
    const fixed = fix(d, [hidden, visible])
    expect('hd' in L(fixed, 0)).toBe(false)
    expect('hd' in L(fixed, 2)).toBe(false)
  })

  it('moves a matte source directly above its target for adjacency players', () => {
    const d = doc([layer(1, { td: 1 }), layer(2), layer(3, { tt: 1, tp: 1 })])
    const i = issue(d, 'matte.notAdjacent')
    expect(i.platforms?.map((x) => x.player)).toEqual(['android', 'ios'])
    const fixed = fix(d, i)
    expect(fixed.layers.map((l) => l.ind)).toEqual([2, 1, 3])
    expect(has(fixed, 'matte.notAdjacent')).toBe(false)
  })

  it('offers no move when several layers share the source', () => {
    const d = doc([
      layer(1, { td: 1 }),
      layer(2),
      layer(3, { tt: 1, tp: 1 }),
      layer(4, { tt: 1, tp: 1 }),
    ])
    expect(
      validate(d)
        .filter((i) => i.code === 'matte.notAdjacent')
        .every((i) => !i.fix),
    ).toBe(true)
  })

  it('links the source explicitly for the canvas renderer', () => {
    const d = doc([layer(5, { td: 1 }), layer(2, { tt: 1 })])
    const i = issue(d, 'matte.canvasLookup')
    expect(i.safe).toBe(true)
    expect(L(fix(d, i), 1).tp).toBe(5)
    expect(has(doc([layer(1, { td: 1 }), layer(2, { tt: 1 })]), 'matte.canvasLookup')).toBe(false)
  })

  it('removes unused matte layers', () => {
    const d = doc([layer(1, { td: 1 }), layer(2), layer(3, { td: 1 }), layer(4, { tt: 1 })])
    const i = issue(d, 'matte.orphan')
    expect(paths(i)).toEqual(['layers/0'])
    expect(fix(d, i).layers.map((l) => l.ind)).toEqual([2, 3, 4])
    // Kept when it is a parent.
    const parent = doc([layer(1, { td: 1 }), layer(2, { parent: 1 })])
    expect(issue(parent, 'matte.orphan').fix).toBeUndefined()
  })
})

const mask = (extra: J = {}): J => ({
  inv: false,
  mode: 'a',
  pt: p(
    bezier([
      [0, 0],
      [1, 1],
    ]),
  ),
  o: p(100),
  x: p(0),
  ...extra,
})

describe('masks and effects', () => {
  it('enables masks and completes their settings', () => {
    const d = doc([layer(1, { masksProperties: [{ pt: p(bezier([[0, 0]])) }] })])
    const flag = issue(d, 'mask.flag')
    const fields = issue(d, 'mask.fields')
    const fixed = L(fix(d, [flag, fields]), 0) as { hasMask: boolean; masksProperties: J[] }
    expect(fixed.hasMask).toBe(true)
    expect(fixed.masksProperties[0]).toMatchObject({
      mode: 'a',
      inv: false,
      o: { k: 100 },
      x: { k: 0 },
    })
  })

  it('reorders inverted masks for ThorVG and converts numeric inv', () => {
    const inverted = { mode: 's', pt: p(bezier([[0, 0]])), o: p(100), x: p(0), inv: true }
    const d = doc([layer(1, { hasMask: true, masksProperties: [inverted, mask({ inv: 1 })] })])
    const order = issue(d, 'mask.keyOrder')
    const keys = Object.keys((L(fix(d, order), 0) as { masksProperties: J[] }).masksProperties[0])
    expect(keys.slice(0, 2)).toEqual(['inv', 'mode'])
    expect(issue(d, 'value.notBoolean', { field: 'inv' }).fix).toBe('toBoolean')
    expect(
      has(doc([layer(1, { hasMask: true, masksProperties: [mask()] })]), 'mask.keyOrder'),
    ).toBe(false)
  })

  it('handles disabled effects', () => {
    const d = doc([
      layer(1, {
        ef: [
          { ty: 29, en: 0, ef: [] },
          { ty: 25, ef: [] },
          { ty: 5, ef: [] },
        ],
      }),
    ])
    const off = issue(d, 'effect.disabled', { state: 'off' })
    const missing = issue(d, 'effect.disabled', { state: 'missing' })
    expect([off.safe, missing.safe]).toEqual([false, true])
    const fixed = L(fix(d, [off, missing]), 0) as { ef: J[] }
    expect(fixed.ef.map((e) => [e.ty, e.en])).toEqual([
      [25, 1],
      [5, undefined],
    ])
  })

  it('puts the effect type before its values for ThorVG', () => {
    const d = doc([layer(1, { ef: [{ ef: [], nm: 'Blur', ty: 29, en: 1 }] })])
    const keys = Object.keys((L(fix(d, issue(d, 'effect.keyOrder')), 0) as { ef: J[] }).ef[0])
    expect(keys[0]).toBe('ty')
  })
})

const text = (content: string, font = 'Main', extra: J = {}): J => ({
  ...layer(1, {
    ty: 5,
    t: { d: { k: [{ s: { t: content, f: font, s: 20, j: 0, tr: 0, ...extra }, t: 0 }] } },
  }),
  shapes: undefined,
})

const glyph = (ch: string) => ({
  ch,
  fFamily: 'Inter',
  style: 'Regular',
  size: 20,
  w: 10,
  data: {},
})

describe('text', () => {
  const fonts = { list: [{ fName: 'Main', fFamily: 'Inter', fStyle: 'Regular' }] }

  it('needs a font list with the used fonts', () => {
    expect(has(doc([text('a')]), 'text.noFonts')).toBe(true)
    expect(issue(doc([text('a', 'Other')], { fonts }), 'text.unknownFont').params.font).toBe(
      'Other',
    )
  })

  it('removes an empty glyph list', () => {
    const d = doc([text('a')], { fonts, chars: [] })
    const i = issue(d, 'text.emptyChars')
    expect(i.safe).toBe(false)
    expect('chars' in fix(d, i)).toBe(false)
  })

  it('lists characters without glyphs', () => {
    const d = doc([text('Hello\rWorld')], { fonts, chars: ['H', 'e', 'l', 'o'].map(glyph) })
    expect(issue(d, 'text.missingGlyphs').params).toEqual({ font: 'Inter', chars: 'Wrd' })
  })

  it('converts \\n line breaks', () => {
    const d = doc([text('one\ntwo\r\nthree')], { fonts })
    const i = issue(d, 'text.newline')
    expect(i.safe).toBe(true)
    const t = L(fix(d, i), 0).t as { d: { k: { s: { t: string } }[] } }
    expect(t.d.k[0].s.t).toBe('one\rtwo\rthree')
  })

  it('rounds fractional tracking for iOS', () => {
    const d = doc([text('a', 'Main', { tr: 12.5 })], { fonts })
    const i = issue(d, 'value.notInteger', { field: 'tr' })
    expect(i.platforms).toEqual([{ player: 'ios', level: 'x' }])
    const t = L(fix(d, i), 0).t as { d: { k: { s: { tr: number } }[] } }
    expect(t.d.k[0].s.tr).toBe(13)
  })
})

describe('feature support', () => {
  it('reports expressions with their players and removes them on request', () => {
    const d = doc([layer(1, { ks: { o: { a: 0, k: 100, x: 'time * 10' } } })])
    const i = validate(d).find((x) => x.params.feature === 'expressions')!
    expect(i).toMatchObject({
      code: 'compat',
      severity: 'error',
      fix: 'removeExpressions',
      safe: false,
    })
    expect(issuesForTarget([i], 'all')[0].severity).toBe('warning')
    expect(issuesForTarget([i], 'web')).toEqual([])
    const fixed = L(fix(d, i), 0) as { ks: { o: J } }
    expect(fixed.ks.o).toEqual({ a: 0, k: 100 })
  })

  it('removes cameras safely unless they are parents', () => {
    const d = doc([layer(1, { ty: 13, pe: p(500) }), layer(2)])
    const i = validate(d).find((x) => x.params.feature === 'layer.camera')!
    expect(i.safe).toBe(true)
    expect(fix(d, i).layers.map((l) => l.ind)).toEqual([2])
    const parent = doc([layer(1, { ty: 13 }), layer(2, { parent: 1 })])
    expect(validate(parent).find((x) => x.params.feature === 'layer.camera')?.safe).toBe(false)
  })

  it('groups occurrences of the same problem', () => {
    const d = doc(
      Array.from({ length: 12 }, (_, i) =>
        layer(i + 1, { shapes: [group([rect(), fill(), { ty: 'mm', mm: 1 }])] }),
      ),
    )
    const merge = validate(d).filter((x) => x.params.feature === 'mod.mergePaths')
    expect(merge).toHaveLength(1)
    expect(merge[0].count).toBe(12)
  })
})

describe('targets and summaries', () => {
  const issues = validate(
    doc([
      layer(1, { tt: 3 }),
      layer(2, { td: 1 }),
      layer(3, { shapes: [group([rect(), fill(), { ty: 'mm', mm: 1 }])] }),
      layer(4, { parent: 99 }),
    ]),
  )

  const luma = (t: Parameters<typeof issuesForTarget>[1]) =>
    issuesForTarget(issues, t).find((i) => i.params.feature === 'matte.luma')
  const merge = (t: Parameters<typeof issuesForTarget>[1]) =>
    issuesForTarget(issues, t).find((i) => i.params.feature === 'mod.mergePaths')
  it('re-grades issues for each target', () => {
    expect(luma('all')?.severity).toBe('error')
    expect(luma('web')).toBeUndefined()
    expect(luma('ios')?.platforms).toEqual([{ player: 'ios', level: 'x' }])
    expect(merge('android')?.severity).toBe('info')
    expect(merge('ios')?.severity).toBe('warning')
    // Universal issues are kept for every target.
    for (const t of ['all', 'web', 'ios', 'android', 'dotlottie', 'telegram'] as const) {
      expect(
        issuesForTarget(issues, t).some((i) => i.code === 'layer.parentMissing'),
        t,
      ).toBe(true)
    }
  })

  it('sorts errors first', () => {
    const list = issuesForTarget(issues, 'all')
    const ranks = list.map((i) => ['error', 'warning', 'info'].indexOf(i.severity))
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })

  it('summarizes counts and safe fixes', () => {
    const s = summarizeIssues(issuesForTarget(issues, 'all'))
    expect(s.errors).toBeGreaterThan(0)
    expect(s.fixable).toBeGreaterThan(0)
  })

  it('computes the worst level per player', () => {
    const levels = playerLevels(issuesForTarget(issues, 'all'), 'all')
    expect(levels.ios).toBe('x')
    expect(Object.keys(levels)).toEqual([
      'web-svg',
      'web-canvas',
      'ios',
      'android',
      'thorvg',
      'skottie',
    ])
  })

  it('grades players only by support problems and universal errors', () => {
    // A performance warning affects no player's support.
    const heavy = validate(doc([layer(1)], { w: 5000, h: 5000 }))
    expect(heavy.some((i) => i.code === 'perf.canvas')).toBe(true)
    expect(Object.values(playerLevels(issuesForTarget(heavy, 'all'), 'all'))).toEqual(
      Array(6).fill('y'),
    )
    // A structural error breaks the file everywhere.
    const broken = validate(doc([layer(1, { ks: undefined })]))
    expect(Object.values(playerLevels(issuesForTarget(broken, 'all'), 'all'))).toEqual(
      Array(6).fill('x'),
    )
  })

  it('keeps ids stable between validations', () => {
    const again = validate(
      doc([
        layer(1, { tt: 3 }),
        layer(2, { td: 1 }),
        layer(3, { shapes: [group([rect(), fill(), { ty: 'mm', mm: 1 }])] }),
        layer(4, { parent: 99 }),
      ]),
    )
    expect(again.map((i) => i.id)).toEqual(issues.map((i) => i.id))
  })
})

describe('applyFixes', () => {
  it('applies removals after in-place fixes so paths stay valid', () => {
    const d = doc([
      layer(1, { shapes: [group([{ ty: 'ms' }, rect(), fill()])] }),
      layer(2, { ks: { o: { a: 1, k: [{ t: 0, s: [5] }] } } }),
    ])
    const fixed = fix(
      d,
      validate(d).filter((i) => i.fix && i.safe),
    )
    expect(validate(fixed).filter((i) => i.fix && i.safe)).toEqual([])
    expect(L(fixed, 1).ks).toMatchObject({ o: { a: 0, k: 5 } })
  })

  it('can restrict a grouped fix to some occurrences', () => {
    const d = doc([layer(1, { sr: 0 }), layer(2, { sr: 0 })])
    const i = issue(d, 'layer.stretchZero')
    const fixed = fix(d, i, [['layers', 1]])
    expect(fixed.layers.map((l) => l.sr)).toEqual([0, 1])
  })

  it('fixes every safe issue of a badly broken file in one pass', () => {
    const d = doc(
      [
        layer(1, { parent: 1, masksProperties: [{ pt: p(bezier([[0, 0]])) }] }),
        layer(1, { hd: 0, shapes: [{ ty: 'gr', it: [rect(), fill()] }] }),
        layer(3, { tt: 1 }),
        layer(4, {
          ks: {
            o: {
              a: 1,
              k: [
                { t: 10, s: [0] },
                { t: 0, s: [1] },
              ],
            },
          },
        }),
      ],
      { v: undefined, assets: [{ id: 'x', layers: [] }] },
    )
    const before = validate(d).filter((i) => i.fix && i.safe)
    expect(before.length).toBeGreaterThan(5)
    const fixed = fix(d, before)
    expect(
      validate(fixed)
        .filter((i) => i.fix && i.safe)
        .map((i) => i.code),
    ).toEqual([])
    expect(fixed.v).toBe('5.12.0')
    expect(fixed.assets).toEqual([])
  })

  it('does nothing when the problem is already gone', () => {
    const d = doc([layer(1, { sr: 0 })])
    const stale = issue(d, 'layer.stretchZero')
    const healthy = doc([layer(1)])
    expect(fix(healthy, stale)).toBe(healthy)
  })

  it('knows every fix it emits', () => {
    const d = doc([layer(1, { ty: 13 }), nullLayer(2, { hd: 1 })], { v: '4', chars: [] })
    for (const i of validate(d)) if (i.fix) expect(canFix(i), i.fix).toBe(true)
  })
})
