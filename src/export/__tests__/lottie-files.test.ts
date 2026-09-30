import { gunzipSync, strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createDotLottieContainer, readDotLottie, writeDotLottie } from '@/lottie/dotlottie'
import type { Animation, ImageAsset, PrecompAsset, ShapeLayer } from '@/lottie/types'
import {
  TGS_RULES,
  buildDotLottie,
  buildJsonFile,
  buildTgsDocument,
  embeddedImageCount,
  encodeTgs,
  extractImages,
  isFaithful,
  tgsFixesApplied,
  tgsIsFaithful,
  packageInfo,
  resolveDotLottieVersion,
  roundDocument,
  serializeJson,
  stripNames,
  transformDocument,
  type DotLottieOptions,
  type JsonOptions,
  type TgsOptions,
} from '../lottie-files'
import { PNG_DATA_URI, loadBounce, loadOrbit, loadTestJson } from './fixtures'

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const jsonOptions = (patch: Partial<JsonOptions> = {}): JsonOptions => ({
  pretty: false,
  precision: 'keep',
  stripNames: false,
  images: 'embed',
  ...patch,
})

const dotOptions = (patch: Partial<DotLottieOptions> = {}): DotLottieOptions => ({
  version: 'auto',
  extractImages: true,
  includePackage: true,
  loop: true,
  autoplay: true,
  speed: 1,
  bounce: false,
  ...patch,
})

const jsonSize = (d: Animation) => serializeJson(d, false).length

const tgsOptions = (patch: Partial<TgsOptions> = {}): TgsOptions => ({
  fitSize: false,
  fixFps: false,
  duration: 'keep',
  precision: 'keep',
  stripNames: false,
  ...patch,
})

function withImage(doc: Animation): Animation {
  doc.assets = [
    ...(doc.assets ?? []),
    { id: 'image 0', w: 1, h: 1, u: '', p: PNG_DATA_URI, e: 1 } satisfies ImageAsset,
  ]
  return doc
}

describe('document transforms', () => {
  it('returns the same document when nothing changes', () => {
    const doc = loadBounce()
    expect(transformDocument(doc, { precision: 'keep', stripNames: false })).toBe(doc)
  })

  it('never mutates the (frozen) editor document', () => {
    const doc = deepFreeze(loadTestJson())
    expect(() => transformDocument(doc, { precision: '1', stripNames: true })).not.toThrow()
    expect(() =>
      buildTgsDocument(doc, tgsOptions({ fitSize: true, fixFps: true, duration: 'trim' })),
    ).not.toThrow()
  })

  it('rounds numbers but keeps frame rates', () => {
    const doc = loadBounce()
    doc.fr = 29.97
    const layer = doc.layers[0] as ShapeLayer
    layer.ks.p = { a: 0, k: [123.456789, 45.678, 0] }
    const rounded = roundDocument(doc, 1)
    expect(rounded.fr).toBe(29.97)
    expect((rounded.layers[0] as ShapeLayer).ks.p).toMatchObject({ k: [123.5, 45.7, 0] })
    expect(doc.layers[0].ks.p).toMatchObject({ k: [123.456789, 45.678, 0] })
  })

  it('keeps precomp frame rates', () => {
    const doc = loadOrbit()
    const precomp = doc.assets!.find((a): a is PrecompAsset => 'layers' in a)!
    precomp.fr = 23.976
    const rounded = roundDocument(doc, 1)
    expect((rounded.assets!.find((a) => a.id === precomp.id) as PrecompAsset).fr).toBe(23.976)
  })

  it('strips names below the root', () => {
    const doc = loadBounce()
    const out = stripNames(doc)
    expect(out.nm).toBe(doc.nm)
    expect(JSON.stringify(out.layers)).not.toMatch(/"nm"|"mn"/)
    expect(JSON.stringify(doc.layers)).toMatch(/"nm"/)
  })

  it('makes files smaller with lower precision', () => {
    const doc = loadTestJson()
    expect(jsonSize(transformDocument(doc, { precision: '1', stripNames: false }))).toBeLessThan(
      jsonSize(doc),
    )
  })
})

describe('Lottie JSON', () => {
  it('writes minified or pretty JSON that parses back to the document', () => {
    const doc = loadBounce()
    const min = buildJsonFile(doc, jsonOptions(), 'bounce.json')
    expect(min).toMatchObject({ ext: 'json', mime: 'application/json' })
    expect(JSON.parse(strFromU8(min.bytes))).toEqual(doc)
    const pretty = buildJsonFile(doc, jsonOptions({ pretty: true }), 'bounce.json')
    expect(strFromU8(pretty.bytes)).toContain('\n  "')
    expect(pretty.bytes.length).toBeGreaterThan(min.bytes.length)
  })

  it('moves embedded images into a zip next to the JSON', () => {
    const doc = withImage(loadBounce())
    expect(embeddedImageCount(doc)).toBe(1)
    const file = buildJsonFile(doc, jsonOptions({ images: 'files' }), 'bounce.json')
    expect(file.ext).toBe('zip')
    const entries = unzipSync(file.bytes)
    expect(Object.keys(entries).sort()).toEqual(['bounce.json', 'images/image_0.png'])
    const json = JSON.parse(strFromU8(entries['bounce.json'])) as Animation
    const asset = json.assets!.find((a) => a.id === 'image 0') as ImageAsset
    expect(asset).toMatchObject({ u: 'images/', p: 'image_0.png', e: 0 })
    expect(Array.from(entries['images/image_0.png'].subarray(0, 4))).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ])
  })

  it('writes plain JSON when "separate files" has nothing to extract', () => {
    expect(buildJsonFile(loadBounce(), jsonOptions({ images: 'files' }), 'x.json').ext).toBe('json')
  })

  it('gives extracted images unique names', () => {
    const doc = withImage(withImage(loadBounce()))
    doc.assets![1].id = 'image-0'
    const { files } = extractImages(doc)
    expect(Object.keys(files)).toHaveLength(2)
    expect(new Set(Object.keys(files).map((k) => k.toLowerCase())).size).toBe(2)
  })
})

describe('dotLottie', () => {
  it('writes a v1 archive with a manifest and the playback hints', () => {
    const file = buildDotLottie(
      loadBounce(),
      dotOptions({ loop: false, speed: 1.5 }),
      'bounce.json',
      undefined,
    )
    expect(file.ext).toBe('lottie')
    const entries = unzipSync(file.bytes)
    const manifest = JSON.parse(strFromU8(entries['manifest.json']))
    expect(manifest.version).toBe('1')
    expect(manifest.animations[0]).toMatchObject({
      id: 'bounce',
      loop: false,
      autoplay: true,
      speed: 1.5,
      playMode: 'normal',
    })
    expect(entries['animations/bounce.json']).toBeDefined()
  })

  it('writes v2 when asked', () => {
    const entries = unzipSync(
      buildDotLottie(loadBounce(), dotOptions({ version: '2' }), 'bounce.json', undefined).bytes,
    )
    expect(JSON.parse(strFromU8(entries['manifest.json'])).version).toBe('2')
    expect(entries['a/bounce.json']).toBeDefined()
  })

  it('extracts images or keeps them embedded', () => {
    const doc = withImage(loadBounce())
    const files = Object.keys(
      unzipSync(buildDotLottie(doc, dotOptions(), 'x.json', undefined).bytes),
    )
    expect(files.some((f) => f.startsWith('images/'))).toBe(true)
    const inline = Object.keys(
      unzipSync(
        buildDotLottie(doc, dotOptions({ extractImages: false }), 'x.json', undefined).bytes,
      ),
    )
    expect(inline.some((f) => f.startsWith('images/'))).toBe(false)
  })

  it('keeps the rest of the original package, or leaves it out', () => {
    const second = loadOrbit()
    const original = writeDotLottie({
      animations: [
        { id: 'main', data: loadBounce() },
        { id: 'second', data: second },
      ],
    })
    const read = readDotLottie(original)
    const container = createDotLottieContainer(read, 'main')
    expect(packageInfo(container)).toMatchObject({
      otherAnimations: 1,
      themes: 0,
      stateMachines: 0,
      needsV2: false,
    })

    const edited = loadBounce()
    edited.nm = 'Edited'
    const kept = readDotLottie(
      buildDotLottie(edited, dotOptions(), 'whatever.lottie', container).bytes,
    )
    expect(kept.animations.map((a) => a.id)).toEqual(['main', 'second'])
    expect(kept.animations[0].data.nm).toBe('Edited')

    const alone = readDotLottie(
      buildDotLottie(edited, dotOptions({ includePackage: false }), 'edited.lottie', container)
        .bytes,
    )
    expect(alone.animations.map((a) => a.id)).toEqual(['edited'])
  })

  it('never downgrades a package with themes to v1', () => {
    const info = {
      otherAnimations: 0,
      themes: 1,
      stateMachines: 0,
      needsV2: true,
      version: 2 as const,
    }
    expect(resolveDotLottieVersion({ version: '1', includePackage: true }, info)).toBe(2)
    expect(resolveDotLottieVersion({ version: '1', includePackage: false }, info)).toBe(1)
    expect(resolveDotLottieVersion({ version: 'auto', includePackage: true }, info)).toBe(2)
    expect(resolveDotLottieVersion({ version: 'auto', includePackage: true }, null)).toBe(1)
    expect(packageInfo({ kind: 'tgs' })).toBeNull()
  })
})

describe('Telegram stickers', () => {
  it('gzips minified JSON with the tgs marker', () => {
    const doc = loadTestJson()
    const bytes = encodeTgs(doc)
    expect(Array.from(bytes.subarray(0, 2))).toEqual([0x1f, 0x8b])
    const json = JSON.parse(strFromU8(gunzipSync(bytes)))
    expect(json.tgs).toBe(1)
    expect(json.layers).toHaveLength(doc.layers.length)
    expect(bytes.length).toBeLessThan(TGS_RULES.maxBytes)
  })

  it('scales into a 512 × 512 canvas', () => {
    const doc = loadBounce()
    doc.w = 1024
    doc.h = 512
    const out = buildTgsDocument(doc, tgsOptions({ fitSize: true }))
    expect([out.w, out.h]).toEqual([512, 512])
    expect(doc.w).toBe(1024)
  })

  it('converts to 60 fps keeping the duration', () => {
    const out = buildTgsDocument(loadBounce(), tgsOptions({ fixFps: true }))
    expect(out.fr).toBe(60)
    expect((out.op - out.ip) / out.fr).toBeCloseTo(2, 5)
  })

  it('trims or speeds up to 3 seconds', () => {
    const long = loadOrbit() // 6 s at 30 fps
    const trimmed = buildTgsDocument(long, tgsOptions({ duration: 'trim' }))
    expect((trimmed.op - trimmed.ip) / trimmed.fr).toBeCloseTo(3, 5)
    expect(trimmed.layers).toHaveLength(long.layers.length)
    const faster = buildTgsDocument(long, tgsOptions({ duration: 'speed' }))
    expect((faster.op - faster.ip) / faster.fr).toBeCloseTo(3, 5)
    const kept = buildTgsDocument(long, tgsOptions({ duration: 'keep' }))
    expect((kept.op - kept.ip) / kept.fr).toBeCloseTo(6, 5)
  })

  it('leaves short animations alone', () => {
    const doc = loadBounce()
    expect(buildTgsDocument(doc, tgsOptions({ duration: 'trim' })).op).toBe(doc.op)
  })
})

describe('faithful exports', () => {
  it('knows which transforms lose data', () => {
    expect(isFaithful({ precision: 'keep', stripNames: false })).toBe(true)
    expect(isFaithful({ precision: '3', stripNames: false })).toBe(false)
    expect(isFaithful({ precision: 'keep', stripNames: true })).toBe(false)
  })

  it('lists the sticker fixes that change a document', () => {
    const bounce = loadBounce() // 512 × 512, 30 fps, 2 s
    expect(
      tgsFixesApplied(bounce, tgsOptions({ fitSize: true, fixFps: true, duration: 'trim' })),
    ).toEqual({
      size: false,
      fps: true,
      duration: false,
    })
    const orbit = loadOrbit() // 6 s
    expect(tgsFixesApplied(orbit, tgsOptions({ duration: 'speed' })).duration).toBe(true)
    expect(tgsFixesApplied(orbit, tgsOptions({ duration: 'keep' })).duration).toBe(false)
  })

  it('treats a sticker as faithful only without fixes', () => {
    const sticker = loadTestJson() // already 512 × 512, 60 fps, under 3 s
    expect(
      tgsIsFaithful(sticker, tgsOptions({ fitSize: true, fixFps: true, duration: 'trim' })),
    ).toBe(true)
    expect(tgsIsFaithful(sticker, tgsOptions({ precision: '2' }))).toBe(false)
    expect(tgsIsFaithful(loadBounce(), tgsOptions({ fixFps: true }))).toBe(false)
    expect(tgsIsFaithful(loadBounce(), tgsOptions({ fixFps: false }))).toBe(true)
  })

  it('agrees with what the sticker builder does', () => {
    const doc = loadOrbit()
    doc.w = 800
    const opts = tgsOptions({ fitSize: true, fixFps: true, duration: 'trim' })
    const fixes = tgsFixesApplied(doc, opts)
    const out = buildTgsDocument(doc, opts)
    expect(fixes.size).toBe(out.w !== doc.w || out.h !== doc.h)
    expect(fixes.fps).toBe(out.fr !== doc.fr)
    expect(fixes.duration).toBe(
      Math.abs((out.op - out.ip) / out.fr - (doc.op - doc.ip) / doc.fr) > 1e-6,
    )
  })
})
