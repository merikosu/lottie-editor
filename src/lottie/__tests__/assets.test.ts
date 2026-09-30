import { freeze, produce } from 'immer'
import { describe, expect, it } from 'vitest'
import {
  addFont,
  addImageAsset,
  addImageLayer,
  assetReferences,
  baseName,
  dataUriByteSize,
  dataUriToBytes,
  describeImage,
  extensionToMime,
  fitScale,
  fontNameFor,
  fontOrigin,
  fontWeightFor,
  fontUsage,
  imageFileName,
  imageSrc,
  imageStatus,
  imageUsage,
  listImageAssets,
  listPrecomps,
  matchFilesToImages,
  mimeToExtension,
  missingImages,
  parseDataUri,
  precompUsage,
  reachableAssetIds,
  removeAssets,
  removeFont,
  removeUnusedAssets,
  renameAsset,
  renameFont,
  replaceImageAsset,
  undefinedFonts,
  uniqueAssetId,
  uniqueFontName,
  unusedAssets,
  updateFont,
  validateAssetId,
} from '../assets'
import { createAnimation } from '../document'
import type { Animation, ImageAsset, Layer, PrecompAsset, TextLayer } from '../types'

/* --------------------------------- Fixtures -------------------------------- */

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const ks = () => ({ o: { a: 0 as const, k: 100 }, p: { a: 0 as const, k: [0, 0, 0] } })

function imageLayer(refId: string, ind: number, extra: Partial<Layer> = {}): Layer {
  return { ty: 2, refId, ind, ip: 0, op: 60, st: 0, ks: ks(), nm: `img ${ind}`, ...extra } as Layer
}

function precompLayer(refId: string, ind: number, extra: Record<string, unknown> = {}): Layer {
  return { ty: 0, refId, ind, ip: 0, op: 60, st: 0, ks: ks(), w: 200, h: 100, ...extra } as Layer
}

function textLayer(ind: number, fonts: string[]): TextLayer {
  return {
    ty: 5,
    ind,
    ip: 0,
    op: 60,
    st: 0,
    ks: ks(),
    t: { d: { k: fonts.map((f, i) => ({ t: i * 10, s: { t: 'Hi', s: 24, f } })) } },
  }
}

/** root → comp_a (used) → comp_b (nested) → image_1; comp_c unused → image_2; image_0 used at root. */
function fixture(): Animation {
  const anim = createAnimation({ width: 400, height: 300, frames: 90 })
  const images: ImageAsset[] = [
    { id: 'image_0', w: 10, h: 20, u: '', p: PNG_1PX, e: 1 },
    { id: 'image_1', w: 30, h: 30, u: 'images/', p: 'img_1.png', e: 0 },
    { id: 'image_2', w: 64, h: 64, u: '', p: 'https://cdn.example.com/a/logo.webp?v=2', e: 0 },
  ]
  const compB: PrecompAsset = { id: 'comp_b', layers: [imageLayer('image_1', 1)] }
  const compA: PrecompAsset = {
    id: 'comp_a',
    nm: 'Scene',
    layers: [precompLayer('comp_b', 1), imageLayer('image_0', 2)],
  }
  const compC: PrecompAsset = { id: 'comp_c', layers: [imageLayer('image_2', 1)] }
  anim.assets = [...images, compA, compB, compC]
  anim.layers = [
    precompLayer('comp_a', 1),
    imageLayer('image_0', 2),
    precompLayer('comp_a', 3, { w: 640, h: 360 }),
  ]
  return anim
}

/* -------------------------------- Data URIs -------------------------------- */

describe('data URIs', () => {
  it('parses headers without decoding', () => {
    expect(parseDataUri(PNG_1PX)).toEqual({ mime: 'image/png', base64: true, dataOffset: 22 })
    expect(parseDataUri('data:,Hello')).toEqual({
      mime: 'text/plain',
      base64: false,
      dataOffset: 6,
    })
    expect(parseDataUri('data:image/svg+xml;charset=utf-8,%3Csvg%3E')?.mime).toBe('image/svg+xml')
    expect(parseDataUri('DATA:IMAGE/JPEG;BASE64,AAAA')).toEqual({
      mime: 'image/jpeg',
      base64: true,
      dataOffset: 23,
    })
    expect(parseDataUri('images/a.png')).toBeNull()
    expect(parseDataUri('data:image/png;base64')).toBeNull()
  })

  it('computes decoded sizes (padding, whitespace, percent-encoding)', () => {
    expect(dataUriByteSize(PNG_1PX)).toBe(dataUriToBytes(PNG_1PX).length)
    expect(dataUriByteSize('data:application/octet-stream;base64,AAAA')).toBe(3)
    expect(dataUriByteSize('data:application/octet-stream;base64,AAA=')).toBe(2)
    expect(dataUriByteSize('data:application/octet-stream;base64,AA==')).toBe(1)
    expect(dataUriByteSize('data:application/octet-stream;base64,AA==\n')).toBe(1)
    expect(dataUriByteSize('data:image/svg+xml,%3Csvg%3E')).toBe(5)
    expect(dataUriByteSize('data:text/plain,%E2%82%AC')).toBe(3)
    expect(dataUriByteSize('not a uri')).toBe(0)
  })

  it('decodes payloads', () => {
    const png = dataUriToBytes(PNG_1PX)
    expect(String.fromCharCode(...png.slice(1, 4))).toBe('PNG')
    expect(new TextDecoder().decode(dataUriToBytes('data:image/svg+xml,%3Csvg%2F%3E'))).toBe(
      '<svg/>',
    )
    expect(() => dataUriToBytes('images/a.png')).toThrow()
  })

  it('maps media types and extensions', () => {
    expect(mimeToExtension('image/jpeg')).toBe('jpg')
    expect(mimeToExtension('IMAGE/SVG+XML')).toBe('svg')
    expect(mimeToExtension('application/x-unknown')).toBe('png')
    expect(mimeToExtension(null)).toBe('png')
    expect(extensionToMime('photo.JPEG')).toBe('image/jpeg')
    expect(extensionToMime('a/b/logo.svg?x=1')).toBe('image/svg+xml')
    expect(extensionToMime('webp')).toBe('image/webp')
    expect(extensionToMime('anim.json')).toBeNull()
  })

  it('extracts base names from paths and URLs', () => {
    expect(baseName('images/img_0.png')).toBe('img_0.png')
    expect(baseName('C:\\export\\images\\a.png')).toBe('a.png')
    expect(baseName('https://x.io/a/b.png?v=1#frag')).toBe('b.png')
    expect(baseName('')).toBe('')
  })
})

/* ------------------------------- Image assets ------------------------------ */

describe('image status and description', () => {
  const anim = fixture()
  const [embedded, relative, linked] = anim.assets as ImageAsset[]

  it('classifies embedded, linked and missing images', () => {
    expect(imageStatus(embedded)).toBe('embedded')
    expect(imageStatus(relative)).toBe('missing')
    expect(imageStatus(linked)).toBe('linked')
    // Data URIs work even when `e` is missing or 0 (players concatenate u + p).
    expect(imageStatus({ id: 'x', p: PNG_1PX, e: 0 })).toBe('embedded')
    // An absolute URL split across `u` and `p` is linked.
    expect(imageStatus({ id: 'x', u: 'https://cdn.io/img/', p: 'a.png' })).toBe('linked')
    expect(imageStatus({ id: 'x', u: '/images/', p: 'a.png' })).toBe('missing')
  })

  it('returns displayable sources', () => {
    expect(imageSrc(embedded)).toBe(PNG_1PX)
    expect(imageSrc(linked)).toBe('https://cdn.example.com/a/logo.webp?v=2')
    expect(imageSrc({ id: 'x', u: 'https://cdn.io/img/', p: 'a.png' })).toBe(
      'https://cdn.io/img/a.png',
    )
    expect(imageSrc(relative)).toBeNull()
  })

  it('suggests file names', () => {
    expect(imageFileName(embedded)).toBe('image_0.png')
    expect(imageFileName(relative)).toBe('img_1.png')
    expect(imageFileName(linked)).toBe('logo.webp')
    expect(imageFileName({ id: 'my img/1', p: 'data:image/jpeg;base64,AAAA' })).toBe('my_img_1.jpg')
  })

  it('describes images with sizes and caches frozen assets', () => {
    const frozen = freeze(structuredClone(embedded), true)
    const a = describeImage(frozen, 4)
    expect(a).toMatchObject({
      status: 'embedded',
      mime: 'image/png',
      index: 4,
      fileName: 'image_0.png',
    })
    expect(a.bytes).toBe(dataUriToBytes(PNG_1PX).length)
    const b = describeImage(frozen, 7)
    expect(b.index).toBe(7)
    expect(b.bytes).toBe(a.bytes)
    expect(describeImage(relative, 1)).toMatchObject({
      status: 'missing',
      mime: 'image/png',
      bytes: null,
      src: null,
    })
  })

  it('lists images in document order and finds missing ones', () => {
    expect(listImageAssets(anim).map((i) => [i.asset.id, i.index])).toEqual([
      ['image_0', 0],
      ['image_1', 1],
      ['image_2', 2],
    ])
    expect(missingImages(anim).map((a) => a.id)).toEqual(['image_1'])
    expect(listImageAssets(createAnimation())).toEqual([])
  })
})

/* ---------------------------------- Usage ---------------------------------- */

describe('usage and reachability', () => {
  const anim = fixture()

  it('collects references across all compositions', () => {
    const refs = assetReferences(anim)
    expect(refs.get('comp_a')).toEqual([
      ['layers', 0],
      ['layers', 2],
    ])
    expect(refs.get('image_0')).toEqual([
      ['layers', 1],
      ['assets', 3, 'layers', 1],
    ])
    expect(refs.get('image_1')).toEqual([['assets', 4, 'layers', 0]])
  })

  it('reports usage per asset kind, including unused entries', () => {
    const images = imageUsage(anim)
    expect([...images.keys()]).toEqual(['image_0', 'image_1', 'image_2'])
    expect(images.get('image_2')).toEqual([['assets', 5, 'layers', 0]])
    const precomps = precompUsage(anim)
    expect([...precomps.keys()]).toEqual(['comp_a', 'comp_b', 'comp_c'])
    expect(precomps.get('comp_c')).toEqual([])
    expect(precomps.get('comp_b')).toEqual([['assets', 3, 'layers', 0]])
  })

  it('finds assets reachable from the root through nested precomps', () => {
    expect([...reachableAssetIds(anim)].sort()).toEqual(['comp_a', 'comp_b', 'image_0', 'image_1'])
    // comp_c is unused, so the image only it references is unused too.
    expect(unusedAssets(anim)).toEqual(['image_2', 'comp_c'])
  })

  it('survives reference cycles and dangling refs', () => {
    const cyclic = createAnimation()
    cyclic.assets = [
      { id: 'a', layers: [precompLayer('b', 1)] },
      { id: 'b', layers: [precompLayer('a', 1), imageLayer('ghost', 2)] },
    ]
    cyclic.layers = [precompLayer('a', 1)]
    expect([...reachableAssetIds(cyclic)].sort()).toEqual(['a', 'b', 'ghost'])
    expect(unusedAssets(cyclic)).toEqual([])
  })

  it('ignores layers without refId and documents without assets', () => {
    const anim2 = createAnimation()
    delete anim2.assets
    anim2.layers = [{ ty: 3, ind: 1, ip: 0, op: 10, st: 0, ks: {} }]
    expect(assetReferences(anim2).size).toBe(0)
    expect(unusedAssets(anim2)).toEqual([])
    expect(imageUsage(anim2).size).toBe(0)
  })
})

/* ------------------------------- Identifiers ------------------------------- */

describe('asset ids', () => {
  it('generates the first free id', () => {
    const anim = fixture()
    expect(uniqueAssetId(anim, 'image')).toBe('image_3')
    expect(uniqueAssetId(anim, 'comp')).toBe('comp_0')
    expect(uniqueAssetId({ assets: undefined })).toBe('image_0')
  })

  it('validates new ids', () => {
    const anim = fixture()
    expect(validateAssetId(anim, '  ')).toBe('empty')
    expect(validateAssetId(anim, 'image_1')).toBe('duplicate')
    expect(validateAssetId(anim, 'image_1', 'image_1')).toBeNull()
    expect(validateAssetId(anim, ' logo ', 'image_1')).toBeNull()
  })

  it('renames an asset and every refId pointing to it', () => {
    const base = freeze(fixture(), true)
    const next = produce(base, (d) => {
      expect(renameAsset(d, 'comp_a', 'scene')).toBe(true)
    })
    expect(next.assets!.find((a) => a.id === 'scene')).toBeTruthy()
    expect((next.layers[0] as { refId: string }).refId).toBe('scene')
    expect((next.layers[2] as { refId: string }).refId).toBe('scene')
    // Unrelated subtrees keep their identity (structural sharing).
    expect(next.assets![4]).toBe(base.assets![4])
    expect(next.layers[1]).toBe(base.layers[1])
  })

  it('renames ids referenced from inside precomps', () => {
    const next = produce(fixture(), (d) => {
      renameAsset(d, 'image_0', 'logo')
    })
    expect((next.layers[1] as { refId: string }).refId).toBe('logo')
    expect(((next.assets![3] as PrecompAsset).layers[1] as { refId: string }).refId).toBe('logo')
  })

  it('refuses invalid renames', () => {
    const anim = fixture()
    expect(renameAsset(anim, 'image_0', 'image_1')).toBe(false)
    expect(renameAsset(anim, 'image_0', '')).toBe(false)
    expect(renameAsset(anim, 'image_0', 'image_0')).toBe(false)
    expect(renameAsset(anim, 'nope', 'x')).toBe(false)
    expect(anim.assets![0].id).toBe('image_0')
  })
})

/* ------------------------------ Editing images ----------------------------- */

describe('adding and replacing images', () => {
  it('adds embedded image assets with unique ids', () => {
    const anim = fixture()
    const id = addImageAsset(anim, PNG_1PX, 100.4, 50.6, ' Logo ')
    expect(id).toBe('image_3')
    expect(anim.assets![anim.assets!.length - 1]).toEqual({
      id,
      w: 100,
      h: 51,
      u: '',
      p: PNG_1PX,
      e: 1,
      nm: 'Logo',
    })
    expect(addImageAsset(anim, PNG_1PX, 1, 1)).toBe('image_4')
    const empty = createAnimation()
    delete empty.assets
    expect(addImageAsset(empty, PNG_1PX, 1, 1)).toBe('image_0')
    expect(empty.assets).toHaveLength(1)
  })

  it('replaces pixels keeping id and other fields', () => {
    const anim = fixture()
    const asset = anim.assets![1] as ImageAsset
    asset.nm = 'Hero'
    asset.sid = 'hero_slot'
    asset.t = 'seq'
    expect(replaceImageAsset(anim, 'image_1', PNG_1PX, 300, 150)).toBe(true)
    expect(anim.assets![1]).toEqual({
      id: 'image_1',
      w: 300,
      h: 150,
      u: '',
      p: PNG_1PX,
      e: 1,
      nm: 'Hero',
      sid: 'hero_slot',
    })
    expect(imageStatus(anim.assets![1] as ImageAsset)).toBe('embedded')
  })

  it('keeps the picture centered when the size changes (keepCenter)', () => {
    const anim = fixture()
    const asset = anim.assets!.find((a) => a.id === 'image_0') as ImageAsset
    asset.w = 200
    asset.h = 100
    // image_0 is shown by a root layer and by a layer of comp_a.
    const root = anim.layers[1]
    const nested = (anim.assets!.find((a) => a.id === 'comp_a') as PrecompAsset).layers[1]
    root.ks.a = { a: 0, k: [100, 50, 0] }
    nested.ks.a = {
      a: 1,
      k: [
        { t: 0, s: [100, 50, 0], o: { x: 0.2, y: 0.2 }, i: { x: 0.8, y: 0.8 } },
        { t: 10, s: [0, 0, 0] },
      ],
    }
    // A layer parented to the root image layer, and one with separated position dimensions.
    const child = precompLayer('comp_c', 7, {
      parent: root.ind,
      ks: { p: { a: 0, k: [10, 20, 0] } },
    })
    const splitChild = precompLayer('comp_c', 8, {
      parent: root.ind,
      ks: {
        p: {
          s: true,
          x: { a: 0, k: 5 },
          y: {
            a: 1,
            k: [
              { t: 0, s: [1] },
              { t: 5, s: [2] },
            ],
          },
        },
      },
    })
    anim.layers.push(child, splitChild)
    expect(replaceImageAsset(anim, 'image_0', PNG_1PX, 100, 100, { keepCenter: true })).toBe(true)
    expect(root.ks.a).toEqual({ a: 0, k: [50, 50, 0] })
    expect((nested.ks.a!.k as { s: number[] }[]).map((k) => k.s)).toEqual([
      [50, 50, 0],
      [-50, 0, 0],
    ])
    expect(child.ks.p).toEqual({ a: 0, k: [-40, 20, 0] })
    expect(splitChild.ks.p).toEqual({
      s: true,
      x: { a: 0, k: -45 },
      y: {
        a: 1,
        k: [
          { t: 0, s: [1] },
          { t: 5, s: [2] },
        ],
      },
    })
    // A layer without an anchor gets one.
    const bare = anim.assets!.find((a) => a.id === 'image_0') as ImageAsset
    bare.w = 100
    bare.h = 100
    delete root.ks.a
    replaceImageAsset(anim, 'image_0', PNG_1PX, 120, 80, { keepCenter: true })
    expect(root.ks.a).toEqual({ a: 0, k: [10, -10, 0] })
  })

  it('leaves anchors alone without keepCenter or when the size is kept', () => {
    const anim = fixture()
    const asset = anim.assets!.find((a) => a.id === 'image_0') as ImageAsset
    asset.w = 200
    asset.h = 100
    const before = JSON.stringify([anim.layers, anim.assets])
    replaceImageAsset(anim, 'image_0', PNG_1PX, 100, 100)
    const afterSize = JSON.stringify([anim.layers, anim.assets])
    expect(JSON.stringify(anim.layers)).toBe(JSON.stringify(JSON.parse(before)[0]))
    replaceImageAsset(anim, 'image_0', PNG_1PX, 100, 100, { keepCenter: true })
    expect(JSON.stringify([anim.layers, anim.assets])).toBe(afterSize)
  })

  it('does not replace precomps or unknown ids', () => {
    const anim = fixture()
    expect(replaceImageAsset(anim, 'comp_a', PNG_1PX, 1, 1)).toBe(false)
    expect(replaceImageAsset(anim, 'nope', PNG_1PX, 1, 1)).toBe(false)
  })

  it('removes assets by id and unused assets transitively', () => {
    const anim = fixture()
    expect(removeAssets(anim, ['image_1', 'nope'])).toEqual(['image_1'])
    expect(removeAssets(anim, [])).toEqual([])
    const anim2 = fixture()
    expect(removeUnusedAssets(anim2)).toEqual(['image_2', 'comp_c'])
    expect(anim2.assets!.map((a) => a.id)).toEqual(['image_0', 'image_1', 'comp_a', 'comp_b'])
    expect(removeUnusedAssets(anim2)).toEqual([])
  })

  it('matches dropped files to external images by base name', () => {
    const anim = fixture()
    const matches = matchFilesToImages(anim, ['IMG_1.PNG', 'logo.webp', 'image_0.png', 'other.png'])
    expect(matches.get('image_1')).toBe('IMG_1.PNG')
    // Linked images can be embedded from a local copy too (query strings are ignored).
    expect(matches.get('image_2')).toBe('logo.webp')
    // Already embedded images are never matched.
    expect(matches.has('image_0')).toBe(false)
    expect(matchFilesToImages(anim, []).size).toBe(0)
  })
})

/* ------------------------------- Image layers ------------------------------ */

describe('image layers', () => {
  it('computes the fit scale', () => {
    expect(fitScale(100, 100, 512, 512)).toBe(100)
    expect(fitScale(1024, 512, 512, 512)).toBe(50)
    expect(fitScale(1000, 3000, 512, 512)).toBeCloseTo(17.07, 2)
    expect(fitScale(0, 10, 512, 512)).toBe(100)
  })

  it('inserts at the top of the root composition, centered and fitted', () => {
    const anim = fixture()
    const path = addImageLayer(anim, { assetId: 'image_0', w: 800, h: 300, name: 'Photo' })
    expect(path).toEqual(['layers', 0])
    const layer = anim.layers[0] as Layer & { refId: string }
    expect(layer).toMatchObject({
      ty: 2,
      refId: 'image_0',
      nm: 'Photo',
      ind: 4,
      ip: 0,
      op: 90,
      st: 0,
    })
    expect(layer.ks.a).toEqual({ a: 0, k: [400, 150, 0] })
    expect(layer.ks.p).toEqual({ a: 0, k: [200, 150, 0] })
    expect(layer.ks.s).toEqual({ a: 0, k: [50, 50, 100] })
  })

  it('inserts into a precomposition using its instance size', () => {
    const anim = fixture()
    const compIndex = anim.assets!.findIndex((a) => a.id === 'comp_a')
    const layersPath = ['assets', compIndex, 'layers'] as const
    const path = addImageLayer(anim, { assetId: 'image_0', w: 20, h: 20, layersPath, index: 1 })
    expect(path).toEqual(['assets', compIndex, 'layers', 1])
    const layer = (anim.assets![compIndex] as PrecompAsset).layers[1]
    expect(layer.ind).toBe(3)
    expect(layer.ks.p).toEqual({ a: 0, k: [100, 50, 0] })
    expect(() => addImageLayer(anim, { assetId: 'x', w: 1, h: 1, layersPath: ['nope'] })).toThrow()
  })

  it('clamps the insertion index', () => {
    const anim = fixture()
    expect(addImageLayer(anim, { assetId: 'image_0', w: 10, h: 10, index: 99 })).toEqual([
      'layers',
      3,
    ])
    expect(addImageLayer(anim, { assetId: 'image_0', w: 10, h: 10, index: -5 })).toEqual([
      'layers',
      0,
    ])
  })
})

/* ------------------------------ Compositions ------------------------------- */

describe('listPrecomps', () => {
  it('reports size from the first instance, layer counts and instances', () => {
    const list = listPrecomps(fixture())
    expect(list.map((p) => [p.asset.id, p.w, p.h, p.layerCount, p.instances.length])).toEqual([
      ['comp_a', 200, 100, 2, 2],
      ['comp_b', 200, 100, 1, 1],
      ['comp_c', null, null, 1, 0],
    ])
    expect(list[0].index).toBe(3)
  })
})

/* ---------------------------------- Fonts ---------------------------------- */

function withFonts(): Animation {
  const anim = createAnimation()
  anim.fonts = {
    list: [
      {
        fName: 'Roboto-Bold',
        fFamily: 'Roboto',
        fStyle: 'Bold',
        fOrigin: 'g',
        fPath: 'https://fonts.googleapis.com/css?family=Roboto',
      },
      { fName: 'Inter-Regular', fFamily: 'Inter', fStyle: 'Regular', fOrigin: 'n' },
      { fName: 'Unused', fFamily: 'Comic', origin: 3, fPath: 'https://x.io/comic.ttf' },
    ],
  }
  anim.assets = [{ id: 'comp_0', layers: [textLayer(1, ['Inter-Regular'])] }]
  anim.layers = [textLayer(1, ['Roboto-Bold', 'Inter-Regular']), textLayer(2, ['Ghost'])]
  return anim
}

describe('fonts', () => {
  it('reports usage across keyframes and compositions', () => {
    const usage = fontUsage(withFonts())
    expect(usage.get('Roboto-Bold')).toEqual([['layers', 0]])
    expect(usage.get('Inter-Regular')).toEqual([
      ['layers', 0],
      ['assets', 0, 'layers', 0],
    ])
    expect(usage.get('Unused')).toEqual([])
    expect(undefinedFonts(withFonts())).toEqual(['Ghost'])
  })

  it('classifies origins', () => {
    const list = withFonts().fonts!.list
    expect(list.map(fontOrigin)).toEqual(['css', 'local', 'file'])
    expect(fontOrigin({ fName: 'a', fFamily: 'a', fOrigin: 't' })).toBe('script')
    expect(fontOrigin({ fName: 'a', fFamily: 'a' })).toBe('local')
  })

  it('derives unique names', () => {
    expect(fontNameFor('Open Sans', 'Semi Bold')).toBe('OpenSans-SemiBold')
    expect(fontNameFor('  ', '')).toBe('Font')
    const anim = withFonts()
    expect(uniqueFontName(anim, 'Inter-Regular')).toBe('Inter-Regular-2')
    expect(uniqueFontName(anim, 'Inter-Bold')).toBe('Inter-Bold')
  })

  it('adds local font entries', () => {
    const anim = createAnimation()
    expect(addFont(anim, { family: ' Open Sans ', style: 'Bold' })).toBe('OpenSans-Bold')
    expect(addFont(anim, { family: 'Open Sans', style: 'Bold' })).toBe('OpenSans-Bold-2')
    expect(addFont(anim, { family: 'Mono' })).toBe('Mono-Regular')
    expect(anim.fonts!.list[0]).toEqual({
      fName: 'OpenSans-Bold',
      fFamily: 'Open Sans',
      fStyle: 'Bold',
      fOrigin: 'n',
      fPath: '',
      ascent: 75,
      fWeight: '700',
    })
  })

  it('maps style names to CSS weights lottie-web would otherwise miss', () => {
    expect(fontWeightFor('SemiBold')).toBe('600')
    expect(fontWeightFor('Semi Bold Italic')).toBe('600')
    expect(fontWeightFor('ExtraBold')).toBe('800')
    expect(fontWeightFor('Ultra-Light')).toBe('200')
    expect(fontWeightFor('Light')).toBe('300')
    expect(fontWeightFor('Bold')).toBe('700')
    expect(fontWeightFor('Black')).toBe('900')
    expect(fontWeightFor('Italic')).toBe('400')
    expect(fontWeightFor('Condensed')).toBeUndefined()
  })

  it('keeps the weight in step with style edits', () => {
    const anim = withFonts()
    expect(updateFont(anim, 'Inter-Regular', { fStyle: 'SemiBold' })).toBe(true)
    expect(anim.fonts!.list[1]).toMatchObject({ fStyle: 'SemiBold', fWeight: '600' })
    expect(updateFont(anim, 'Inter-Regular', { fStyle: 'Condensed' })).toBe(true)
    expect(anim.fonts!.list[1].fWeight).toBeUndefined()
    expect(updateFont(anim, 'Inter-Regular', { fStyle: 'Bold', fWeight: '650' })).toBe(true)
    expect(anim.fonts!.list[1].fWeight).toBe('650')
  })

  it('updates fields and reports whether anything changed', () => {
    const anim = withFonts()
    expect(
      updateFont(anim, 'Inter-Regular', { fFamily: ' Inter Display ', fStyle: 'Regular' }),
    ).toBe(true)
    expect(anim.fonts!.list[1]).toMatchObject({
      fName: 'Inter-Regular',
      fFamily: 'Inter Display',
      fStyle: 'Regular',
    })
    expect(updateFont(anim, 'Inter-Regular', { fFamily: 'Inter Display' })).toBe(false)
    expect(updateFont(anim, 'nope', { fFamily: 'x' })).toBe(false)
  })

  it('renames fonts and the text documents using them', () => {
    const next = produce(freeze(withFonts(), true), (d) => {
      expect(renameFont(d, 'Inter-Regular', 'Inter-Book')).toBe(true)
    })
    expect(next.fonts!.list[1].fName).toBe('Inter-Book')
    expect((next.layers[0] as TextLayer).t.d.k.map((k) => k.s.f)).toEqual([
      'Roboto-Bold',
      'Inter-Book',
    ])
    expect(((next.assets![0] as PrecompAsset).layers[0] as TextLayer).t.d.k[0].s.f).toBe(
      'Inter-Book',
    )
    const anim = withFonts()
    expect(renameFont(anim, 'Inter-Regular', 'Roboto-Bold')).toBe(false)
    expect(renameFont(anim, 'Inter-Regular', ' ')).toBe(false)
    expect(renameFont(anim, 'nope', 'x')).toBe(false)
  })

  it('removes font entries', () => {
    const anim = withFonts()
    expect(removeFont(anim, 'Unused')).toBe(true)
    expect(removeFont(anim, 'Unused')).toBe(false)
    expect(anim.fonts!.list.map((f) => f.fName)).toEqual(['Roboto-Bold', 'Inter-Regular'])
    expect(removeFont(createAnimation(), 'x')).toBe(false)
  })
})
