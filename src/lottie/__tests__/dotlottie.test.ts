import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  DotLottieError,
  base64ToBytes,
  bytesToBase64,
  createDotLottieContainer,
  hashBytes,
  isDotLottieContainer,
  needsDotLottieV2,
  parseDataUri,
  readDotLottie,
  sanitizeDotLottieId,
  sniffMime,
  switchContainerAnimation,
  toDataUri,
  writeDotLottie,
  type DotLottieContainer,
} from '../dotlottie'
import type { Animation, ImageAsset } from '../types'

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

// 1×1 PNGs with different pixels (only the signature matters for sniffing).
const PNG_A = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
)
const PNG_B = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
)
const pngUri = (b: Uint8Array) => `data:image/png;base64,${bytesToBase64(b)}`
const MTIME = new Date(2026, 0, 1)

function anim(nm: string, extra: Partial<Animation> = {}): Animation {
  return {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    nm,
    ddd: 0,
    assets: [],
    layers: [],
    ...extra,
  }
}

function withImages(nm: string, images: [string, Uint8Array][]): Animation {
  return anim(nm, {
    assets: images.map(([id, bytes]) => ({
      id,
      w: 1,
      h: 1,
      u: '',
      p: pngUri(bytes),
      e: 1 as const,
    })),
  })
}

const json = (v: unknown) => strToU8(JSON.stringify(v))

/** Entry names in archive order (fflate keeps insertion order). */
function entryNames(zip: Uint8Array): string[] {
  return Object.keys(unzipSync(zip))
}

function readJson(zip: Uint8Array, path: string): Record<string, unknown> {
  const entry = unzipSync(zip)[path]
  if (!entry) throw new Error(`missing ${path}`)
  return JSON.parse(strFromU8(entry)) as Record<string, unknown>
}

/** Compression method of each entry, from the central directory. */
function compressionMethods(zip: Uint8Array): Record<string, number> {
  const out: Record<string, number> = {}
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  for (let i = 0; i < zip.length - 46; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue
    const method = view.getUint16(i + 10, true)
    const nameLen = view.getUint16(i + 28, true)
    out[strFromU8(zip.subarray(i + 46, i + 46 + nameLen))] = method
  }
  return out
}

/** Clears the UTF-8 flag (bit 11) in every header, as old zip tools do. */
function stripUtf8Flag(zip: Uint8Array): Uint8Array {
  const out = zip.slice()
  const view = new DataView(out.buffer)
  for (let i = 0; i < out.length - 8; i++) {
    const sig = view.getUint32(i, true)
    if (sig === 0x04034b50) view.setUint16(i + 6, view.getUint16(i + 6, true) & ~0x800, true)
    if (sig === 0x02014b50) view.setUint16(i + 8, view.getUint16(i + 8, true) & ~0x800, true)
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                  Utilities                                 */
/* -------------------------------------------------------------------------- */

describe('media helpers', () => {
  it('sniffs common media types', () => {
    expect(sniffMime(PNG_A)).toBe('image/png')
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffMime(strToU8('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffMime(strToU8('GIF89a...'))).toBe('image/gif')
    expect(sniffMime(strToU8('﻿  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
    expect(sniffMime(strToU8('<?xml version="1.0"?><svg/>'))).toBe('image/svg+xml')
    expect(sniffMime(strToU8('wOF2abcd'))).toBe('font/woff2')
    expect(sniffMime(strToU8('hello'))).toBeUndefined()
  })

  it('round-trips base64 and data URIs', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    const uri = toDataUri(PNG_A, 'x.bin')
    expect(uri.startsWith('data:image/png;base64,')).toBe(true)
    expect(parseDataUri(uri)).toEqual({ mime: 'image/png', bytes: PNG_A })
    expect(toDataUri(strToU8('abc'), 'font.ttf').startsWith('data:font/ttf;base64,')).toBe(true)
  })

  it('parses percent-encoded and rejects broken data URIs', () => {
    const svg = parseDataUri('data:image/svg+xml;utf8,%3Csvg%2F%3E')
    expect(svg?.mime).toBe('image/svg+xml')
    expect(strFromU8(svg!.bytes)).toBe('<svg/>')
    expect(parseDataUri('images/a.png')).toBeNull()
    expect(parseDataUri('data:image/png;base64')).toBeNull()
    expect(parseDataUri('data:image/png;base64,@@@')).toBeNull()
  })

  it('hashes content deterministically', () => {
    expect(hashBytes(PNG_A)).toBe(hashBytes(PNG_A.slice()))
    expect(hashBytes(PNG_A)).not.toBe(hashBytes(PNG_B))
  })
})

describe('sanitizeDotLottieId', () => {
  it('keeps legal ids, including spaces and dots', () => {
    expect(sanitizeDotLottieId('Main Scene', new Set())).toBe('Main Scene')
    expect(sanitizeDotLottieId('KSu28rojJy.lottie', new Set())).toBe('KSu28rojJy.lottie')
  })

  it('transliterates and cleans illegal ids', () => {
    expect(sanitizeDotLottieId('Загрузка', new Set())).toBe('Zagruzka')
    expect(sanitizeDotLottieId('café/übung!', new Set())).toBe('cafe_ubung')
    expect(sanitizeDotLottieId('.hidden', new Set())).toBe('hidden')
    expect(sanitizeDotLottieId('✨✨', new Set())).toBe('animation')
  })

  it('makes ids unique case-insensitively', () => {
    const used = new Set<string>()
    expect(sanitizeDotLottieId('Anim', used)).toBe('Anim')
    expect(sanitizeDotLottieId('anim', used)).toBe('anim_2')
    expect(sanitizeDotLottieId('ANIM', used)).toBe('ANIM_3')
  })
})

/* -------------------------------------------------------------------------- */
/*                                    Write                                   */
/* -------------------------------------------------------------------------- */

describe('writeDotLottie', () => {
  it('writes a v1 archive every player reads', () => {
    const zip = writeDotLottie({
      animations: [{ id: 'loader', data: withImages('Loader', [['image_0', PNG_A]]) }],
      options: { mtime: MTIME, playback: { loop: true, autoplay: true } },
    })
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
    expect(entryNames(zip)).toEqual([
      'manifest.json',
      'images/image_0.png',
      'animations/loader.json',
    ])
    expect(readJson(zip, 'manifest.json')).toEqual({
      version: '1',
      generator: 'Lottie Editor',
      animations: [{ id: 'loader', autoplay: true, loop: true }],
    })
    const data = readJson(zip, 'animations/loader.json') as unknown as Animation
    expect(data.assets?.[0]).toMatchObject({ id: 'image_0', u: '/images/', p: 'image_0.png', e: 0 })
    // Media is stored, JSON is deflated.
    expect(compressionMethods(zip)).toMatchObject({
      'images/image_0.png': 0,
      'animations/loader.json': 8,
    })
  })

  it('writes damaged documents whose assets are not a list', () => {
    for (const assets of [{}, 7, 'x', null]) {
      const data = { ...withImages('Odd', []), assets } as unknown as Animation
      const zip = writeDotLottie({ animations: [{ id: 'odd', data }], options: { mtime: MTIME } })
      // Kept as it was: fixing the document is not the writer's job.
      expect(readJson(zip, 'animations/odd.json')).toMatchObject({ assets })
    }
  })

  it('writes v2 layout on request', () => {
    const zip = writeDotLottie({
      animations: [{ id: 'a', data: withImages('A', [['img', PNG_A]]) }],
      version: 2,
      options: { mtime: MTIME },
    })
    expect(entryNames(zip)).toEqual(['manifest.json', 'i/img.png', 'a/a.json'])
    expect(readJson(zip, 'manifest.json')).toEqual({
      version: '2',
      generator: 'Lottie Editor',
      animations: [{ id: 'a' }],
    })
    expect((readJson(zip, 'a/a.json') as unknown as Animation).assets?.[0]).toMatchObject({
      u: '/i/',
      p: 'img.png',
      e: 0,
    })
  })

  it('puts the active animation first in the manifest and last in the archive', () => {
    const zip = writeDotLottie({
      animations: [
        { id: 'first', data: anim('1') },
        { id: 'second', data: anim('2') },
        { id: 'third', data: anim('3') },
      ],
      activeId: 'second',
      version: 2,
      options: { mtime: MTIME },
    })
    const manifest = readJson(zip, 'manifest.json')
    expect((manifest.animations as { id: string }[]).map((a) => a.id)).toEqual([
      'second',
      'first',
      'third',
    ])
    expect(manifest.initial).toEqual({ animation: 'second' })
    expect(entryNames(zip)).toEqual([
      'manifest.json',
      'a/first.json',
      'a/third.json',
      'a/second.json',
    ])
    const v1 = writeDotLottie({
      animations: [
        { id: 'x', data: anim('x') },
        { id: 'y', data: anim('y') },
      ],
      activeId: 'y',
    })
    expect(readJson(v1, 'manifest.json').activeAnimationId).toBe('y')
  })

  it('de-duplicates identical images and renames colliding ones', () => {
    const zip = writeDotLottie({
      animations: [
        {
          id: 'one',
          data: withImages('1', [
            ['image_0', PNG_A],
            ['image_1', PNG_B],
          ]),
        },
        // Same id as one's image_0 but different bytes; image_1 is identical to one's image_1.
        {
          id: 'two',
          data: withImages('2', [
            ['image_0', PNG_B],
            ['image_1', PNG_B],
          ]),
        },
      ],
      options: { mtime: MTIME },
    })
    const images = entryNames(zip).filter((n) => n.startsWith('images/'))
    expect(images).toEqual(['images/image_0.png', 'images/image_1.png'])
    const two = readJson(zip, 'animations/two.json') as unknown as Animation
    expect((two.assets as ImageAsset[]).map((a) => a.p)).toEqual(['image_1.png', 'image_1.png'])
  })

  it('keeps images inline when asked', () => {
    const zip = writeDotLottie({
      animations: [{ id: 'a', data: withImages('A', [['img', PNG_A]]) }],
      options: { extractImages: false },
    })
    expect(entryNames(zip)).toEqual(['manifest.json', 'animations/a.json'])
    expect((readJson(zip, 'animations/a.json') as unknown as Animation).assets?.[0]).toMatchObject({
      e: 1,
    })
  })

  it('extracts fonts in v2 only', () => {
    const font = strToU8('wOFFfontdata')
    const data = anim('T', {
      fonts: {
        list: [
          {
            fName: 'Inter-Bold',
            fFamily: 'Inter',
            fPath: `data:font/woff;base64,${bytesToBase64(font)}`,
          },
        ],
      },
    })
    const v2 = writeDotLottie({ animations: [{ id: 't', data }], version: 2 })
    expect(entryNames(v2)).toContain('f/Inter-Bold.woff')
    expect((readJson(v2, 'a/t.json') as unknown as Animation).fonts?.list[0]).toMatchObject({
      fPath: '/f/Inter-Bold.woff',
      origin: 3,
    })
    const v1 = writeDotLottie({ animations: [{ id: 't', data }], version: 1 })
    expect(entryNames(v1)).toEqual(['manifest.json', 'animations/t.json'])
  })

  it('never writes numeric loop counts or unknown play modes in v1', () => {
    const file = readDotLottie(
      zipSync({
        'manifest.json': json({
          version: '1',
          animations: [{ id: 'a', loop: 3, mode: 'bounce', speed: -1, themeColor: 'red' }],
        }),
        'animations/a.json': json(anim('a')),
      }),
    )
    const zip = writeDotLottie({
      animations: [{ id: 'a', data: anim('a') }],
      container: createDotLottieContainer(file),
    })
    expect((readJson(zip, 'manifest.json').animations as unknown[])[0]).toEqual({
      id: 'a',
      loop: true,
      playMode: 'bounce',
    })
  })

  it('throws without animations', () => {
    expect(() => writeDotLottie({ animations: [] })).toThrow(DotLottieError)
  })
})

/* -------------------------------------------------------------------------- */
/*                                    Read                                    */
/* -------------------------------------------------------------------------- */

describe('readDotLottie', () => {
  it('reads what it writes (v1 and v2) with images inlined again', () => {
    for (const version of [1, 2] as const) {
      const data = withImages('A', [['image_0', PNG_A]])
      const zip = writeDotLottie({ animations: [{ id: 'a', data }], version })
      const file = readDotLottie(zip)
      expect(file.version).toBe(version)
      expect(file.warnings).toEqual([])
      expect(file.animations).toHaveLength(1)
      expect(file.animations[0].data.assets?.[0]).toMatchObject({
        id: 'image_0',
        p: pngUri(PNG_A),
        u: '',
        e: 1,
      })
      expect(file.extraFiles).toEqual({})
    }
  })

  it('honours the active animation of v1 and v2 manifests', () => {
    const v1 = readDotLottie(
      zipSync({
        'manifest.json': json({
          version: '1',
          activeAnimationId: 'b',
          animations: [{ id: 'a' }, { id: 'b' }],
        }),
        'animations/a.json': json(anim('a')),
        'animations/b.json': json(anim('b')),
      }),
    )
    expect(v1.activeId).toBe('b')
    const v2 = readDotLottie(
      zipSync({
        'manifest.json': json({
          version: '2',
          animations: [{ id: 'a' }, { id: 'b' }],
          initial: { animation: 'b' },
        }),
        'a/a.json': json(anim('a')),
        'a/b.json': json(anim('b')),
      }),
    )
    expect(v2.version).toBe(2)
    expect(v2.activeId).toBe('b')
    expect(v2.animations.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('reads themes, state machines and keeps unknown files', () => {
    const file = readDotLottie(
      zipSync({
        'manifest.json': json({
          version: '2',
          animations: [{ id: 'main', initialTheme: 'dark', themes: ['dark'] }],
          themes: [{ id: 'dark', name: 'Dark' }],
          stateMachines: [{ id: 'sm' }],
        }),
        't/dark.json': json({ rules: [{ id: 'bg', type: 'Color', value: [0, 0, 0] }] }),
        's/sm.json': json({
          initial: 'idle',
          states: [{ name: 'idle', type: 'PlaybackState', animation: 'main' }],
        }),
        'i/logo_dark.png': PNG_A,
        'a/main.json': json(anim('main')),
      }),
    )
    expect(file.themes).toEqual([
      {
        id: 'dark',
        name: 'Dark',
        data: { rules: [{ id: 'bg', type: 'Color', value: [0, 0, 0] }] },
      },
    ])
    expect(file.stateMachines[0].id).toBe('sm')
    expect(Object.keys(file.extraFiles)).toEqual(['i/logo_dark.png'])
    expect(file.animations[0].meta).toMatchObject({ initialTheme: 'dark', themes: ['dark'] })
  })

  it('reads legacy dotlottie-js layouts (themes/, states/, .lot)', () => {
    const file = readDotLottie(
      zipSync({
        'manifest.json': json({
          version: '1.0',
          animations: [{ id: 'x' }],
          themes: [{ id: 'old' }],
          states: ['fsm'],
        }),
        'themes/old.lss': json({ rules: [] }),
        'states/fsm.json': json({ states: [] }),
        'animations/x.lot': json(anim('x')),
      }),
    )
    expect(file.version).toBe(1)
    expect(file.animations[0].id).toBe('x')
    expect(file.themes.map((t) => t.id)).toEqual(['old'])
    expect(file.stateMachines.map((s) => s.id)).toEqual(['fsm'])
  })

  it('strips a wrapping folder and macOS junk', () => {
    const file = readDotLottie(
      zipSync({
        'MyAnim/manifest.json': json({ version: '1', animations: [{ id: 'x' }] }),
        'MyAnim/animations/x.json': json({
          ...anim('x'),
          assets: [{ id: 'i', w: 1, h: 1, u: 'images/', p: 'img_0.png', e: 0 }],
        }),
        'MyAnim/images/img_0.png': PNG_A,
        '__MACOSX/MyAnim/._x.json': strToU8('junk'),
      }),
    )
    expect(file.animations[0].data.assets?.[0]).toMatchObject({ p: pngUri(PNG_A), e: 1 })
    expect(file.warnings.map((w) => w.code)).toEqual(['nested-folder'])
    expect(file.warnings[0].subject).toBe('MyAnim')
    expect(file.extraFiles).toEqual({})
  })

  it('opens plain ZIP exports without a manifest', () => {
    const file = readDotLottie(
      zipSync({
        'data.json': json({
          ...anim('export'),
          assets: [{ id: 'image_0', w: 1, h: 1, u: 'images/', p: 'img_0.png', e: 0 }],
        }),
        'images/img_0.png': PNG_A,
      }),
    )
    expect(file.manifest).toBeNull()
    expect(file.animations[0].id).toBe('data')
    expect(file.animations[0].data.assets?.[0]).toMatchObject({ p: pngUri(PNG_A), e: 1, u: '' })
    expect(file.warnings.map((w) => w.code)).toEqual(['no-manifest'])
  })

  it('resolves flat and spec-example image references', () => {
    const flat = readDotLottie(
      zipSync({
        'anim.json': json({
          ...anim('a'),
          assets: [{ id: 'x', w: 1, h: 1, u: '', p: 'IMG_0.PNG', e: 0 }],
        }),
        'img_0.png': PNG_A,
      }),
    )
    expect(flat.animations[0].data.assets?.[0]).toMatchObject({ e: 1 })
    const specExample = readDotLottie(
      zipSync({
        'manifest.json': json({ version: '1', animations: [{ id: 'a' }] }),
        'animations/a.json': json({
          ...anim('a'),
          assets: [{ id: 'x', w: 1, h: 1, u: '', p: 'images/x.png', e: 0 }],
        }),
        'images/x.png': PNG_B,
      }),
    )
    expect(specExample.animations[0].data.assets?.[0]).toMatchObject({ p: pngUri(PNG_B), e: 1 })
  })

  it('tolerates a broken manifest and unlisted animations', () => {
    const broken = readDotLottie(
      zipSync({ 'manifest.json': strToU8('{oops'), 'a/foo.json': json(anim('foo')) }),
    )
    expect(broken.manifest).toBeNull()
    expect(broken.version).toBe(2)
    expect(broken.animations[0].id).toBe('foo')
    expect(broken.warnings[0].code).toBe('invalid-manifest')

    const mismatch = readDotLottie(
      zipSync({
        'manifest.json': json({ version: '2', animations: [{ id: 'missing' }] }),
        'a/real.json': json(anim('r')),
      }),
    )
    expect(mismatch.animations.map((a) => a.id)).toEqual(['real'])
    expect(mismatch.warnings.map((w) => w.code)).toEqual([
      'missing-animation',
      'unlisted-animation',
    ])
  })

  it('handles a BOM and skips invalid animation JSON', () => {
    const file = readDotLottie(
      zipSync({
        'manifest.json': strToU8(
          '﻿{"version":"2","animations":[{"id":"ok"},{"id":"bad"},{"id":"notlottie"}]}',
        ),
        'a/ok.json': strToU8(`﻿${JSON.stringify(anim('ok'))}`),
        'a/bad.json': strToU8('{"layers": ['),
        'a/notlottie.json': json({ hello: 'world' }),
      }),
    )
    expect(file.animations.map((a) => a.id)).toEqual(['ok'])
    expect(file.warnings.map((w) => [w.code, w.subject])).toEqual([
      ['invalid-animation', 'a/bad.json'],
      ['invalid-animation', 'a/notlottie.json'],
    ])
    // Broken animations are not carried over as extra files.
    expect(file.extraFiles).toEqual({})
  })

  it('warns about missing and external assets but keeps the references', () => {
    const file = readDotLottie(
      zipSync({
        'manifest.json': json({ version: '1', animations: [{ id: 'a' }] }),
        'animations/a.json': json({
          ...anim('a'),
          assets: [
            { id: 'gone', w: 1, h: 1, u: '/images/', p: 'gone.png', e: 0 },
            { id: 'web', w: 1, h: 1, u: '', p: 'https://example.com/x.png', e: 0 },
            { id: 'comp', layers: [] },
          ],
        }),
      }),
    )
    expect(file.warnings.map((w) => [w.code, w.subject])).toEqual([
      ['missing-asset', 'gone'],
      ['external-asset', 'web'],
    ])
    expect(file.animations[0].data.assets?.[0]).toMatchObject({ p: 'gone.png', e: 0 })
  })

  it('recovers UTF-8 names stored without the UTF-8 flag', () => {
    const zip = stripUtf8Flag(
      zipSync({
        'manifest.json': json({ version: '1', animations: [{ id: 'загрузка' }] }),
        'animations/загрузка.json': json(anim('ru')),
      }),
    )
    const file = readDotLottie(zip)
    expect(file.animations.map((a) => a.id)).toEqual(['загрузка'])
  })

  it('salvages entries when the central directory is damaged', () => {
    const zip = writeDotLottie({
      animations: [{ id: 'a', data: withImages('A', [['img', PNG_A]]) }],
    })
    // Cut off the central directory (and the end record).
    const cd = zip.findIndex(
      (_, i) =>
        zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02,
    )
    const file = readDotLottie(zip.subarray(0, cd))
    expect(file.warnings[0].code).toBe('salvaged')
    expect(file.animations[0].data.assets?.[0]).toMatchObject({ p: pngUri(PNG_A), e: 1 })
  })

  it('skips entries with unsupported compression', () => {
    const zip = zipSync({
      'manifest.json': json({ version: '1', animations: [{ id: 'a' }] }),
      'animations/a.json': json(anim('a')),
      'x.bin': strToU8('x'),
    })
    // Patch the method of x.bin (local and central headers) to LZMA (14).
    const view = new DataView(zip.buffer)
    for (let i = 0; i < zip.length - 4; i++) {
      const sig = view.getUint32(i, true)
      const nameAt = sig === 0x04034b50 ? i + 30 : sig === 0x02014b50 ? i + 46 : -1
      if (nameAt < 0 || strFromU8(zip.subarray(nameAt, nameAt + 5)) !== 'x.bin') continue
      view.setUint16(i + (sig === 0x04034b50 ? 8 : 10), 14, true)
    }
    const file = readDotLottie(zip)
    expect(file.animations).toHaveLength(1)
    expect(file.warnings.map((w) => [w.code, w.subject])).toEqual([['skipped-entry', 'x.bin']])
  })

  it('rejects non-ZIP data and archives without animations', () => {
    expect(() => readDotLottie(json(anim('x')))).toThrow(
      expect.objectContaining({ code: 'not-zip' }),
    )
    expect(() => readDotLottie(zipSync({ 'readme.txt': strToU8('hi') }))).toThrow(
      expect.objectContaining({ code: 'no-animation' }),
    )
  })
})

/* -------------------------------------------------------------------------- */
/*                               Round trips                                  */
/* -------------------------------------------------------------------------- */

function themedArchive(): Uint8Array {
  return zipSync({
    'manifest.json': json({
      version: '2',
      generator: 'dotlottie-js',
      animations: [
        { id: 'Main Scene', initialTheme: 'dark', background: '#000000' },
        { id: 'second' },
      ],
      themes: [{ id: 'dark', name: 'Dark' }],
      stateMachines: [{ id: 'flow' }],
      initial: { animation: 'Main Scene', stateMachine: 'flow' },
    }),
    't/dark.json': json({ rules: [{ id: 'bg', type: 'Color', value: [0, 0, 0] }] }),
    's/flow.json': json({
      initial: 'a',
      states: [{ name: 'a', type: 'PlaybackState', animation: 'Main Scene' }],
    }),
    'i/theme_logo.png': PNG_B,
    'a/second.json': json(withImages('second', [['image_0', PNG_A]])),
    'a/Main Scene.json': json(anim('main')),
  })
}

describe('containers and round trips', () => {
  it('builds a container without the edited animation data', () => {
    const file = readDotLottie(themedArchive())
    const container = createDotLottieContainer(file, 'Main Scene')
    expect(isDotLottieContainer(container)).toBe(true)
    expect(container.activeId).toBe('Main Scene')
    expect(container.animations.map((a) => [a.id, a.data !== undefined])).toEqual([
      ['Main Scene', false],
      ['second', true],
    ])
    expect(needsDotLottieV2(container)).toBe(true)
    expect(isDotLottieContainer({ kind: 'tgs' })).toBe(false)
    expect(needsDotLottieV2(undefined)).toBe(false)
  })

  it('saves the edited animation and preserves everything else', () => {
    const file = readDotLottie(themedArchive())
    const container = createDotLottieContainer(file)
    const edited = anim('edited', { op: 120 })
    // The export feature may pass any id for the edited document: it replaces the active one.
    const zip = writeDotLottie({ animations: [{ id: 'whatever', data: edited }], container })
    const manifest = readJson(zip, 'manifest.json')
    expect(manifest).toEqual({
      version: '2',
      generator: 'Lottie Editor',
      animations: [
        { id: 'Main Scene', initialTheme: 'dark', background: '#000000' },
        { id: 'second' },
      ],
      themes: [{ id: 'dark', name: 'Dark' }],
      stateMachines: [{ id: 'flow' }],
      initial: { animation: 'Main Scene', stateMachine: 'flow' },
    })
    expect(entryNames(zip)).toEqual([
      'manifest.json',
      't/dark.json',
      's/flow.json',
      'i/image_0.png',
      'i/theme_logo.png',
      'a/second.json',
      'a/Main Scene.json',
    ])
    expect(readJson(zip, 'a/Main Scene.json')).toMatchObject({ nm: 'edited', op: 120 })
    const again = readDotLottie(zip)
    expect(again.animations.map((a) => a.id)).toEqual(['Main Scene', 'second'])
    expect(again.stateMachines[0].data).toEqual(file.stateMachines[0].data)
    expect(again.extraFiles).toEqual({ 'i/theme_logo.png': PNG_B })
  })

  it('refuses to drop themes when v1 is forced', () => {
    const container = createDotLottieContainer(readDotLottie(themedArchive()))
    expect(() =>
      writeDotLottie({ animations: [{ id: 'x', data: anim('x') }], container, version: 1 }),
    ).toThrow(expect.objectContaining({ code: 'v2-required' }))
  })

  it('remaps carried-over files when the layout changes', () => {
    const file = readDotLottie(
      zipSync({
        'manifest.json': json({ version: '1', animations: [{ id: 'a' }] }),
        'images/unused.png': PNG_A,
        'animations/a.json': json(anim('a')),
      }),
    )
    const container = createDotLottieContainer(file)
    const zip = writeDotLottie({
      animations: [{ id: 'a', data: anim('a') }],
      container,
      version: 2,
    })
    expect(entryNames(zip)).toEqual(['manifest.json', 'i/unused.png', 'a/a.json'])
  })

  it('keeps state machine references valid when an id must change', () => {
    const file = readDotLottie(
      zipSync({
        'manifest.json': json({
          version: '2',
          animations: [{ id: 'bad/id' }],
          stateMachines: [{ id: 'sm' }],
        }),
        's/sm.json': json({ initial: 's', states: [{ name: 's', animation: 'bad/id' }] }),
        'a/bad/id.json': json(anim('x')),
      }),
    )
    expect(file.animations[0].id).toBe('bad/id')
    const zip = writeDotLottie({
      animations: [{ id: 'bad/id', data: anim('x') }],
      container: createDotLottieContainer(file),
    })
    expect(entryNames(zip)).toContain('a/bad_id.json')
    expect(readJson(zip, 's/sm.json')).toEqual({
      initial: 's',
      states: [{ name: 's', animation: 'bad_id' }],
    })
  })

  it('re-exports byte-identically with a fixed timestamp', () => {
    const first = writeDotLottie({
      animations: [
        { id: 'one', data: withImages('1', [['image_0', PNG_A]]) },
        { id: 'two', data: withImages('2', [['image_0', PNG_B]]) },
      ],
      activeId: 'two',
      version: 2,
      options: { mtime: MTIME },
    })
    const file = readDotLottie(first)
    const container = createDotLottieContainer(file)
    const active = file.animations.find((a) => a.id === file.activeId)!
    const second = writeDotLottie({
      animations: [{ id: active.id, data: active.data }],
      container,
      options: { mtime: MTIME },
    })
    expect(second).toEqual(first)
  })

  it('switches the edited animation of a container', () => {
    const file = readDotLottie(themedArchive())
    const container: DotLottieContainer = createDotLottieContainer(file, 'Main Scene')
    const current = anim('edited main')
    const next = switchContainerAnimation(container, current, 'second')
    expect(next?.data.nm).toBe('second')
    expect(next?.container.activeId).toBe('second')
    expect(next?.container.animations.find((a) => a.id === 'Main Scene')?.data).toBe(current)
    expect(next?.container.animations.find((a) => a.id === 'second')?.data).toBeUndefined()
    expect(switchContainerAnimation(container, current, 'Main Scene')).toBeNull()
    expect(switchContainerAnimation(container, current, 'nope')).toBeNull()
  })

  it('writes several new animations without a container', () => {
    const zip = writeDotLottie({
      animations: [
        { id: 'Мой файл', data: anim('a') },
        { id: 'мой ФАЙЛ', data: anim('b') },
      ],
    })
    expect(entryNames(zip)).toEqual([
      'manifest.json',
      'animations/moy_FAYL_2.json',
      'animations/Moy_fayl.json',
    ])
    expect(readJson(zip, 'manifest.json').activeAnimationId).toBe('Moy_fayl')
  })
})
