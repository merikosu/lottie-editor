import { describe, expect, it } from 'vitest'
import testJsonText from '../../../docs/test.json?raw'
import { scanDocument } from '../compat'
import {
  compositionActivity,
  computeStats,
  gzipSize,
  imageHeaderInfo,
  inspectDataUri,
  isLayerEverVisible,
  measureDocument,
  measureJson,
  mergeIntervals,
  utf8Length,
} from '../stats'
import type { Animation } from '../types'
import {
  doc,
  ellipse,
  fill,
  group,
  imageAsset,
  jpegUri,
  kf,
  layer,
  nullLayer,
  p,
  pngUri,
  precompLayer,
  rect,
  webpUri,
  type J,
} from './insights.fixtures'

const testJson = () => JSON.parse(testJsonText) as Animation

describe('sizes', () => {
  it('counts UTF-8 bytes like TextEncoder', () => {
    for (const s of ['', 'abc', 'Привет', '日本語', '🎉 ok', 'a\u0080߿ࠀ￿']) {
      expect(utf8Length(s), s).toBe(new TextEncoder().encode(s).length)
    }
  })

  it('gzips deterministically and much smaller for repetitive JSON', () => {
    const text = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ t: i, s: [0, 0] })))
    expect(gzipSize(text)).toBe(gzipSize(text))
    expect(gzipSize(text)).toBeLessThan(text.length / 5)
  })

  it('measures raw, gzip and embedded images', () => {
    const uri = pngUri(4, 4)
    const d = doc([layer(1)], {
      assets: [imageAsset('img', uri, 4, 4), { id: 'ext', w: 1, h: 1, u: '', p: 'a.png' }],
    })
    const json = JSON.stringify(d)
    const size = measureJson(json, d)
    expect(size.raw).toBe(json.length)
    expect(size.gzip).toBeGreaterThan(0)
    expect(size.gzip).toBeLessThan(size.raw)
    expect(size.images).toBe(uri.length)
    expect(size.imageCount).toBe(1)
    expect(measureDocument(d)).toEqual(size)
    expect(measureJson(json, d, { gzip: false }).gzip).toBe(0)
  })
})

describe('embedded images', () => {
  it('reads PNG size and transparency', () => {
    expect(inspectDataUri(pngUri(640, 480, 6))).toMatchObject({
      mime: 'image/png',
      width: 640,
      height: 480,
      alpha: true,
    })
    expect(inspectDataUri(pngUri(32, 16, 2))).toMatchObject({ width: 32, height: 16, alpha: false })
  })

  it('reads JPEG size behind other segments', () => {
    expect(inspectDataUri(jpegUri(1920, 1080))).toMatchObject({
      mime: 'image/jpeg',
      width: 1920,
      height: 1080,
      alpha: false,
    })
  })

  it('reads WebP extended headers', () => {
    expect(inspectDataUri(webpUri(300, 200, true))).toMatchObject({
      width: 300,
      height: 200,
      alpha: true,
    })
    expect(inspectDataUri(webpUri(300, 200, false))).toMatchObject({ alpha: false })
  })

  it('reads lossy and lossless WebP and GIF headers', () => {
    // VP8 (lossy): frame tag + start code, then 14-bit sizes.
    const vp8 = new Uint8Array(30)
    vp8.set([0x52, 0x49, 0x46, 0x46], 0)
    vp8.set([0x57, 0x45, 0x42, 0x50], 8)
    vp8.set([0x56, 0x50, 0x38, 0x20], 12)
    vp8.set([100, 0, 50, 0], 26)
    expect(imageHeaderInfo(vp8)).toEqual({ width: 100, height: 50, alpha: false })
    // VP8L (lossless): 14-bit width-1 and height-1 packed after the signature byte.
    const vp8l = new Uint8Array(30)
    vp8l.set([0x52, 0x49, 0x46, 0x46], 0)
    vp8l.set([0x57, 0x45, 0x42, 0x50], 8)
    vp8l.set([0x56, 0x50, 0x38, 0x4c], 12)
    const w = 99
    const h = 49
    const bits = w | (h << 14) | (1 << 28)
    vp8l.set([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255], 21)
    expect(imageHeaderInfo(vp8l)).toEqual({ width: 100, height: 50, alpha: true })
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0])
    expect(imageHeaderInfo(gif)).toEqual({ width: 10, height: 20, alpha: true })
    expect(imageHeaderInfo(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('computes the decoded size from base64 and handles other data URIs', () => {
    const png = pngUri(1, 1, 6, 1000)
    const info = inspectDataUri(png)
    const payload = png.slice(png.indexOf(',') + 1)
    expect(info?.bytes).toBe(atob(payload).length)
    expect(inspectDataUri('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')).toMatchObject({
      mime: 'image/svg+xml',
      bytes: 11,
    })
    expect(inspectDataUri('images/a.png')).toBeNull()
    expect(inspectDataUri('data:image/png;base64')).toBeNull()
    const unknown = inspectDataUri('data:image/jpeg;base64,AAAA')
    expect(unknown).toMatchObject({ mime: 'image/jpeg', bytes: 3, alpha: false })
    expect(unknown?.width).toBeUndefined()
  })
})

describe('mergeIntervals', () => {
  it('sorts, merges overlaps and drops empty intervals', () => {
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 0, end: 5 },
        { start: 15, end: 30 },
        { start: 40, end: 40 },
        { start: 30, end: 31 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 31 },
    ])
  })
})

describe('compositionActivity', () => {
  it('maps precomp instances into inner time with st and sr', () => {
    const d = doc(
      [
        precompLayer(1, 'a', { ip: 10, op: 40, st: 10 }),
        precompLayer(2, 'a', { ip: 50, op: 60, st: 50, sr: 2 }),
      ],
      {
        op: 60,
        assets: [
          { id: 'a', layers: [precompLayer(1, 'b', { ip: 0, op: 100, st: 5 })] },
          { id: 'b', layers: [] },
        ],
      },
    )
    const activity = compositionActivity(d)
    const scan = scanDocument(d)
    expect(activity.get(scan.comps[0])).toEqual([{ start: 0, end: 60 }])
    expect(activity.get(scan.comps[1])).toEqual([{ start: 0, end: 30 }])
    // Nested: (t − 5) for t in [0, 30)
    expect(activity.get(scan.comps[2])).toEqual([{ start: -5, end: 25 }])
  })

  it('treats time-remapped instances as always active and skips unused comps', () => {
    const d = doc([precompLayer(1, 'a', { tm: kf([0, 0], [60, 2]) })], {
      assets: [
        { id: 'a', layers: [] },
        { id: 'unused', layers: [] },
      ],
    })
    const scan = scanDocument(d)
    expect(compositionActivity(d).get(scan.comps[1])).toEqual([{ start: -Infinity, end: Infinity }])
    expect(compositionActivity(d).get(scan.comps[2])).toEqual([])
  })

  it('terminates on precomp recursion', () => {
    const d = doc([precompLayer(1, 'a')], {
      assets: [{ id: 'a', layers: [precompLayer(1, 'a', { st: 1 })] }],
    })
    const activity = compositionActivity(d)
    expect(activity.get(scanDocument(d).comps[1])?.length).toBeGreaterThan(0)
  })

  it('finds layers that are never on screen', () => {
    const d = doc(
      [
        layer(1, { ip: 70, op: 90 }),
        layer(2, { ip: 30, op: 30 }),
        layer(3, { ip: -20, op: 5 }),
        precompLayer(4, 'a', { ip: 0, op: 20, st: 0 }),
      ],
      {
        op: 60,
        assets: [{ id: 'a', layers: [layer(1, { ip: 25, op: 50 }), layer(2, { ip: 10, op: 30 })] }],
      },
    )
    const scan = scanDocument(d)
    const visible = scan.layers.map((ref) => isLayerEverVisible(d, ref))
    expect(visible).toEqual([false, false, true, true, false, true])
  })
})

describe('computeStats', () => {
  it('counts layers, shapes, properties and features', () => {
    const d = doc(
      [
        layer(1, {
          hd: true,
          masksProperties: [
            { mode: 'a', pt: p({ v: [], i: [], o: [], c: true }), o: p(100), x: p(0) },
          ],
          ks: { o: kf([0, 0], [10, 100]), p: { a: 0, k: [0, 0, 0], x: 'wiggle(1,1)' } },
          ef: [{ ty: 29, ef: [] }],
          shapes: [
            group([rect(), fill()]),
            group([
              ellipse(),
              {
                ty: 'gf',
                g: { p: 1, k: p([0, 1, 1, 1]) },
                s: p([0, 0]),
                e: p([1, 1]),
                o: p(100),
                t: 1,
              },
            ]),
            { ty: 'tm', s: p(0), e: p(100), o: p(0) },
          ],
        }),
        {
          ...layer(2, {
            ty: 5,
            t: {
              d: {
                k: [
                  { s: { t: 'a', f: 'F' }, t: 0 },
                  { s: { t: 'b', f: 'F' }, t: 10 },
                ],
              },
            },
          }),
          shapes: undefined,
        },
        layer(3, { td: 1 }),
        layer(4, { tt: 1, ddd: 1 }),
        nullLayer(5),
        precompLayer(6, 'c'),
        layer(7, { ty: 2, refId: 'img' }),
      ],
      {
        markers: [{ tm: 0, cm: 'a', dr: 0 }],
        fonts: { list: [{ fName: 'F', fFamily: 'F' }] },
        assets: [
          { id: 'c', layers: [layer(1)] },
          imageAsset('img', pngUri(10, 10, 6, 100), 10, 10),
          { id: 'ext', w: 1, h: 1, u: '', p: 'x.png' },
        ],
      },
    )
    const s = computeStats(d)
    expect(s).toMatchObject({
      width: 512,
      height: 512,
      fps: 30,
      frames: 60,
      duration: 2,
      layers: 8,
      rootLayers: 7,
      hiddenLayers: 1,
      compositions: 1,
      precompLayers: 1,
      masks: 1,
      mattes: 1,
      effects: 1,
      expressions: 1,
      textLayers: 1,
      fonts: 1,
      imageAssets: 2,
      embeddedImages: 1,
      externalImages: 1,
      markers: 1,
    })
    expect(s.layersByKind).toMatchObject({ shape: 4, text: 1, null: 1, precomp: 1, image: 1 })
    expect(s.shapesByType.gr).toBeGreaterThanOrEqual(2)
    expect(s.animatedProperties).toBe(2) // opacity + the two-document source text
    expect(s.keyframes).toBe(4)
    expect(s.imageBytes).toBeGreaterThan(100)
    const ids = s.features.map((f) => f.id)
    expect(ids).toEqual([
      'masks',
      'mattes',
      'gradients',
      'trimPaths',
      'text',
      'images',
      'expressions',
      'effects',
      'threeD',
    ])
    expect(s.features.find((f) => f.id === 'mattes')?.layers).toEqual([['layers', 3]])
  })

  it('summarizes the real-world test file', () => {
    const s = computeStats(testJson())
    expect(s).toMatchObject({
      fps: 60,
      frames: 179,
      layers: 22,
      rootLayers: 21,
      precompLayers: 8,
      compositions: 1,
      expressions: 1,
      effects: 1,
      masks: 0,
    })
    expect(s.features.find((f) => f.id === 'gradients')?.count).toBe(19)
    expect(s.features.find((f) => f.id === 'trimPaths')?.count).toBe(2)
    expect(s.keyframes).toBeGreaterThan(400)
  })

  it('is cached per document object', () => {
    const d = doc([layer(1)])
    expect(computeStats(d)).toBe(computeStats(d))
  })

  it('tolerates empty and broken documents', () => {
    const s = computeStats({ layers: [] } as unknown as Animation)
    expect(s).toMatchObject({ layers: 0, frames: 0, duration: 0, features: [] })
    const broken = computeStats(doc([{ ty: 'weird' } as J, layer(1, { ks: null })]))
    expect(broken.layers).toBe(2)
  })
})
