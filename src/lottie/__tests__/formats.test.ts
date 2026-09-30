import { gzipSync, strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, writeDotLottie } from '../dotlottie'
import {
  LottieFileError,
  animationName,
  externalImageRefs,
  fileExtension,
  fileStem,
  findLotties,
  isImageFileName,
  isLottieFileName,
  locateJsonError,
  notLottieHint,
  parseJsonText,
  readLottieBytes,
  readLottieFile,
  resolveExternalImages,
  sniffFormat,
  writeTgs,
} from '../formats'
import type { Animation, ImageAsset } from '../types'

const PNG = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
)

function anim(nm = 'test', extra: Partial<Animation> = {}): Animation {
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

const text = (v: unknown) => strToU8(JSON.stringify(v))

function withExternalImage(u = 'images/', p = 'img_0.png'): Animation {
  return anim('ext', { assets: [{ id: 'image_0', w: 1, h: 1, u, p, e: 0 }] })
}

function expectError(fn: () => unknown, code: string): LottieFileError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(LottieFileError)
    expect((e as LottieFileError).code).toBe(code)
    return e as LottieFileError
  }
  throw new Error(`expected a LottieFileError "${code}"`)
}

/* -------------------------------------------------------------------------- */

describe('file names', () => {
  it('extracts extensions and stems', () => {
    expect(fileExtension('a/b/Loader.JSON')).toBe('json')
    expect(fileExtension('.hidden')).toBe('')
    expect(fileExtension('noext')).toBe('')
    expect(fileStem('C:\\files\\loader.min.json')).toBe('loader.min')
    expect(fileStem('.json')).toBe('.json')
    expect(fileStem('')).toBe('animation')
  })

  it('classifies files', () => {
    expect(isLottieFileName('a.lottie')).toBe(true)
    expect(isLottieFileName('sticker.tgs')).toBe(true)
    expect(isLottieFileName('blob', 'application/json')).toBe(true)
    expect(isLottieFileName('photo.png')).toBe(false)
    expect(isImageFileName('photo.PNG')).toBe(true)
    expect(isImageFileName('x', 'image/webp')).toBe(true)
    expect(isImageFileName('a.json')).toBe(false)
  })
})

describe('sniffFormat', () => {
  it('detects formats by content', () => {
    const zip = zipSync({ 'data.json': text(anim()) })
    expect(sniffFormat(zip, 'export.zip')).toBe('zip')
    expect(sniffFormat(zip, 'x.lottie')).toBe('dotlottie')
    expect(sniffFormat(zip, 'download')).toBe('zip')
    expect(
      sniffFormat(zipSync({ 'manifest.json': text({}), 'a/x.json': text(anim()) }), 'download'),
    ).toBe('dotlottie')
    expect(sniffFormat(gzipSync(text(anim())), 'sticker.tgs')).toBe('tgs')
    expect(sniffFormat(strToU8('\uFEFF \n {"v":"5"}'), 'x')).toBe('json')
    expect(sniffFormat(strToU8('[{}]'), 'x')).toBe('json')
    expect(sniffFormat(strToU8('export default {"a":1}'), 'x.js')).toBe('json')
    expect(sniffFormat(strToU8('<!doctype html><html>'), 'x.json')).toBe('unknown')
    expect(sniffFormat(PNG, 'x.png')).toBe('unknown')
  })

  it('lets a broken .json file reach the JSON parser', () => {
    expect(sniffFormat(strToU8('garbage'), 'x.json')).toBe('json')
    expect(sniffFormat(strToU8('garbage'), 'x.txt')).toBe('unknown')
  })

  it('decodes UTF-16 text with a BOM', () => {
    const body = JSON.stringify(anim('utf16'))
    const bytes = new Uint8Array(2 + body.length * 2)
    bytes[0] = 0xff
    bytes[1] = 0xfe
    for (let i = 0; i < body.length; i++) bytes[2 + i * 2] = body.charCodeAt(i)
    expect(sniffFormat(bytes, 'x.json')).toBe('json')
    expect(readLottieBytes(bytes, 'x.json').animations[0].data.nm).toBe('utf16')
  })
})

describe('locateJsonError', () => {
  it('returns null for valid JSON', () => {
    expect(locateJsonError('{"a":[1,-2.5e3,true,false,null,"x\\u00e9\\n"]}')).toBeNull()
    expect(locateJsonError('  []  ')).toBeNull()
  })

  it('locates syntax errors by line and column', () => {
    expect(locateJsonError('{\n  "a": 1,\n  "b": 2,\n}')).toEqual({
      offset: 22,
      line: 4,
      column: 1,
      found: '}',
    })
    expect(locateJsonError('{"a" 1}')).toMatchObject({ line: 1, column: 6, found: '1' })
    expect(locateJsonError('[1 2]')).toMatchObject({ column: 4, found: '2' })
    expect(locateJsonError('[01]')).toMatchObject({ column: 3, found: '1' })
    expect(locateJsonError('{"a":tru}')).toMatchObject({ column: 9, found: '}' })
    expect(locateJsonError('{"a":"x\\q"}')).toMatchObject({ column: 9, found: 'q' })
    expect(locateJsonError('{} x')).toMatchObject({ column: 4, found: 'x' })
    expect(locateJsonError("{'a':1}")).toMatchObject({ column: 2, found: "'" })
  })

  it('reports an unexpected end of input', () => {
    expect(locateJsonError('{"a": [1, 2')).toMatchObject({ line: 1, column: 12, found: null })
    expect(locateJsonError('{"a": "unterminated')).toMatchObject({ found: null })
    expect(locateJsonError('')).toMatchObject({ found: null })
  })

  it('rejects raw control characters inside strings', () => {
    expect(locateJsonError('{"a":"x\ny"}')).toMatchObject({ line: 1, column: 8, found: '\n' })
  })
})

describe('parseJsonText', () => {
  it('reports empty text and syntax errors', () => {
    expectError(() => parseJsonText('  \n '), 'empty')
    const err = expectError(() => parseJsonText('{\n"layers": [,]\n}'), 'invalid-json')
    expect([err.line, err.column, err.found]).toEqual([2, 12, ','])
  })

  it('accepts JavaScript snippets around the JSON', () => {
    const warnings: { code: string }[] = []
    expect(parseJsonText('export default {"a": 1};\n', warnings as never)).toEqual({ a: 1 })
    expect(parseJsonText('const animationData = {"a": 2}', warnings as never)).toEqual({ a: 2 })
    expect(parseJsonText('module.exports = [1]', warnings as never)).toEqual([1])
    expect(warnings.map((w) => w.code)).toEqual(['js-snippet', 'js-snippet', 'js-snippet'])
    expectError(() => parseJsonText('const x = {a: 1}'), 'invalid-json')
  })
})

describe('findLotties and hints', () => {
  it('unwraps API wrappers, nested objects and JSON strings', () => {
    const a = anim('wrapped')
    expect(findLotties(a)[0].path).toEqual([])
    expect(findLotties({ animationData: a })[0].path).toEqual(['animationData'])
    expect(findLotties({ meta: { x: 1 }, result: { data: { lottie: a } } })[0].path).toEqual([
      'result',
      'data',
      'lottie',
    ])
    const stringified = findLotties({ data: JSON.stringify(a) })
    expect(stringified[0].path).toEqual(['data'])
    expect(stringified[0].value.nm).toBe('wrapped')
    expect(findLotties({ nothing: { here: [1, 2, 3] } })).toEqual([])
  })

  it('finds every animation of a list', () => {
    const found = findLotties([anim('a'), { not: 'lottie' }, anim('b')])
    expect(found.map((f) => [f.value.nm, f.path])).toEqual([
      ['a', ['0']],
      ['b', ['2']],
    ])
  })

  it('explains common non-Lottie JSON', () => {
    expect(notLottieHint({ version: '2', animations: [{ id: 'x' }] })).toBe('dotlottie-manifest')
    expect(notLottieHint({ rules: [] })).toBe('theme')
    expect(notLottieHint({ initial: 'a', states: [] })).toBe('state-machine')
    expect(notLottieHint({ ty: 4, ks: {}, shapes: [] })).toBe('partial')
    expect(notLottieHint({ name: 'package' })).toBeUndefined()
    expect(notLottieHint([1])).toBeUndefined()
  })
})

/* -------------------------------------------------------------------------- */

describe('readLottieBytes', () => {
  it('opens plain Lottie JSON', () => {
    const r = readLottieBytes(text(anim('Loader')), 'loader.json')
    expect(r.kind).toBe('json')
    expect(r.size).toBeGreaterThan(0)
    expect(r.animations).toHaveLength(1)
    expect(r.animations[0]).toMatchObject({ id: 'loader', name: 'Loader', repairs: [] })
    expect(r.activeId).toBe('loader')
    expect(r.warnings).toEqual([])
  })

  it('reports repairs made while loading', () => {
    const broken = { layers: [], w: 200, h: 200, fr: 0, ip: 0, op: 0 }
    const r = readLottieBytes(text(broken), 'broken.json')
    expect(r.animations[0].repairs.length).toBe(2)
    expect(r.animations[0].data.fr).toBe(30)
  })

  it('unwraps wrappers and warns once', () => {
    const r = readLottieBytes(text({ status: 'ok', animationData: anim('api') }), 'response.json')
    expect(r.animations[0].data.nm).toBe('api')
    expect(r.warnings).toEqual([{ code: 'unwrapped', subject: 'animationData' }])
  })

  it('offers every animation of a JSON list', () => {
    const r = readLottieBytes(text([anim('a'), anim('b')]), 'pack.json')
    expect(r.animations.map((a) => [a.id, a.name])).toEqual([
      ['pack-1', 'a'],
      ['pack-2', 'b'],
    ])
  })

  it('opens Telegram stickers', () => {
    const sticker = { ...anim('sticker', { fr: 60, op: 180, w: 512, h: 512 }), tgs: 1 }
    const r = readLottieBytes(writeTgs(sticker), 'sticker.tgs')
    expect(r.kind).toBe('tgs')
    expect(r.animations[0].data).toMatchObject({ nm: 'sticker', fr: 60, tgs: 1 })
    expectError(
      () => readLottieBytes(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]), 'bad.tgs'),
      'corrupt-gzip',
    )
  })

  it('opens ZIP exports and embeds their images', () => {
    const zip = zipSync({ 'data.json': text(withExternalImage()), 'images/img_0.png': PNG })
    const r = readLottieBytes(zip, 'export.zip')
    expect(r.kind).toBe('zip')
    expect(r.dotLottie).toBeUndefined()
    expect(r.warnings).toEqual([])
    const asset = r.animations[0].data.assets?.[0] as ImageAsset | undefined
    expect(asset?.p.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('opens dotLottie files with every animation', () => {
    const bytes = writeDotLottie({
      animations: [
        { id: 'first', data: anim('First') },
        { id: 'second', data: anim('Second') },
      ],
      activeId: 'second',
    })
    const r = readLottieBytes(bytes, 'bundle.lottie')
    expect(r.kind).toBe('dotlottie')
    expect(r.activeId).toBe('second')
    expect(r.animations.map((a) => [a.id, a.name])).toEqual([
      ['second', 'Second'],
      ['first', 'First'],
    ])
    expect(r.dotLottie?.animations).toHaveLength(2)
  })

  it('treats a manifest-less .lottie as dotLottie with a warning', () => {
    const r = readLottieBytes(zipSync({ 'a/x.json': text(anim('x')) }), 'odd.lottie')
    expect(r.kind).toBe('dotlottie')
    expect(r.warnings.map((w) => w.code)).toEqual(['no-manifest'])
  })

  it('keeps animations it cannot open in the dotLottie container', () => {
    const bytes = zipSync({
      'manifest.json': text({ version: '1', animations: [{ id: 'good' }, { id: 'odd' }] }),
      'animations/good.json': text(anim('good')),
      // Lottie-looking but without numeric settings: not openable, still preserved.
      'animations/odd.json': text({ layers: [], w: 'wide' }),
    })
    const r = readLottieBytes(bytes, 'mixed.lottie')
    expect(r.animations.map((a) => a.id)).toEqual(['good'])
    expect(r.warnings.map((w) => [w.code, w.subject])).toEqual([['invalid-animation', 'odd']])
    expect(r.dotLottie?.animations.map((a) => a.id)).toEqual(['good', 'odd'])
  })

  it('warns about external images and resolves them from companion files', () => {
    const external = readLottieBytes(text(withExternalImage()), 'data.json')
    expect(external.warnings).toEqual([
      { code: 'external-images', count: 1, subject: 'images/img_0.png' },
    ])
    const resolved = readLottieBytes(text(withExternalImage()), 'data.json', {
      images: [{ name: 'img_0.png', path: 'export/images/img_0.png', bytes: PNG }],
    })
    expect(resolved.warnings).toEqual([])
    expect(resolved.animations[0].data.assets?.[0]).toMatchObject({ e: 1, u: '' })
  })

  it('throws coded errors for everything it cannot open', () => {
    expectError(() => readLottieBytes(new Uint8Array(), 'x.json'), 'empty')
    expectError(() => readLottieBytes(strToU8('   '), 'x.json'), 'empty')
    const syntax = expectError(
      () => readLottieBytes(strToU8('{"layers": [}'), 'x.json'),
      'invalid-json',
    )
    expect([syntax.line, syntax.column, syntax.found]).toEqual([1, 13, '}'])
    expect(
      expectError(() => readLottieBytes(text({ rules: [] }), 'theme.json'), 'not-lottie').hint,
    ).toBe('theme')
    expectError(() => readLottieBytes(text({ hello: 1 }), 'x.json'), 'not-lottie')
    expectError(() => readLottieBytes(PNG, 'photo.png'), 'image')
    expectError(() => readLottieBytes(strToU8('<!DOCTYPE html><html><body>'), 'page'), 'html')
    expectError(() => readLottieBytes(strToU8('PDF-1.7 binary'), 'doc.pdf'), 'unsupported')
    expectError(() => readLottieBytes(strToU8('not a zip at all'), 'x.lottie'), 'corrupt-zip')
    expectError(
      () => readLottieBytes(zipSync({ 'readme.txt': strToU8('hi') }), 'x.zip'),
      'no-animation',
    )
  })

  it('reads File objects', async () => {
    const file = new File([JSON.stringify(anim('from file'))], 'drop.json', {
      type: 'application/json',
    })
    const r = await readLottieFile(file)
    expect(r.fileName).toBe('drop.json')
    expect(r.animations[0].name).toBe('from file')
  })
})

describe('animation names', () => {
  it('reads names that are not strings instead of rejecting the file', () => {
    const numeric = { ...anim(), nm: 123 } as unknown as Animation
    const result = readLottieBytes(strToU8(JSON.stringify(numeric)), 'numbered.json')
    expect(result.animations).toHaveLength(1)
    expect(result.animations[0].name).toBe('123')
    const nameless = { ...anim(), nm: { junk: true } } as unknown as Animation
    expect(readLottieBytes(strToU8(JSON.stringify(nameless)), 'x.json').animations).toHaveLength(1)
  })

  it('reads numeric names inside a list of animations', () => {
    const list = [anim('first'), { ...anim(), nm: 7 }]
    const result = readLottieBytes(strToU8(JSON.stringify(list)), 'list.json')
    expect(result.animations.map((a) => a.name)).toEqual(['first', '7'])
  })

  it('animationName tolerates junk', () => {
    expect(animationName('  Intro ')).toBe('Intro')
    expect(animationName(42)).toBe('42')
    expect(animationName(Number.NaN)).toBe('')
    expect(animationName(null)).toBe('')
    expect(animationName(undefined)).toBe('')
    expect(animationName(['x'])).toBe('')
  })
})

describe('external images', () => {
  it('lists unresolved references', () => {
    const doc = anim('x', {
      assets: [
        { id: 'a', w: 1, h: 1, u: 'images/', p: 'a.png', e: 0 },
        { id: 'b', w: 1, h: 1, u: '', p: `data:image/png;base64,${bytesToBase64(PNG)}`, e: 1 },
        { id: 'c', w: 1, h: 1, u: '', p: 'https://cdn.example.com/c.png', e: 0 },
        { id: 'comp', layers: [] },
      ],
    })
    expect(externalImageRefs(doc)).toEqual(['images/a.png'])
  })

  it('matches by path first and never guesses between same-named files', () => {
    const doc = anim('x', {
      assets: [
        { id: 'a', w: 1, h: 1, u: 'images/', p: 'img.png', e: 0 },
        { id: 'b', w: 1, h: 1, u: 'other/', p: 'img.png', e: 0 },
        { id: 'c', w: 1, h: 1, u: '', p: 'Unique%20Name.PNG', e: 0 },
      ],
    })
    const count = resolveExternalImages(doc, [
      { name: 'img.png', path: 'images/img.png', bytes: PNG },
      { name: 'img.png', path: 'backup/img.png', bytes: PNG },
      { name: 'unique name.png', bytes: PNG },
    ])
    expect(count).toBe(2)
    expect((doc.assets as ImageAsset[]).map((a) => a.e)).toEqual([1, 0, 1])
  })
})
