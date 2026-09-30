import { describe, expect, it } from 'vitest'
import testText from '../../../../docs/test.json?raw'
import { formatJson } from '../format'
import { findJsonError, findPathRange, pathToAccessor } from '../json-scan'

const testDoc = JSON.parse(testText) as {
  layers: { nm: string; ks: unknown }[]
  assets: { id: string }[]
}

function slice(text: string, path: (string | number)[]): string | null {
  const r = findPathRange(text, path)
  return r ? text.slice(r.from, r.to) : null
}

describe('findJsonError', () => {
  it('accepts valid JSON', () => {
    for (const text of [
      '{}',
      '[]',
      ' 0 ',
      '"x"',
      'true',
      'null',
      '{"a": [1, -2.5e+3, {"b": "\\u00e9\\n"}]}',
      testText,
    ]) {
      expect(findJsonError(text)).toBeNull()
    }
  })

  it('agrees with JSON.parse on a corpus of broken inputs', () => {
    const broken = [
      '',
      '   ',
      '{',
      '{"a": 1',
      '{"a": 1,}',
      '[1, 2,]',
      '{a: 1}',
      "{'a': 1}",
      '{"a" 1}',
      '{"a": 1 "b": 2}',
      '[1 2]',
      '{"a": }',
      '"abc',
      '"a\\x"',
      '"\\u12G4"',
      '"tab\there"',
      '01',
      '1.',
      '.5',
      '+1',
      '-',
      '1e',
      'tru',
      'True',
      'undefined',
      'NaN',
      '{} {}',
      '{"a": 1} // note',
      '/* c */ {}',
      '[1, 2]]',
      '{"a": 1}}',
      '{"a":\n"line\nbreak"}',
    ]
    for (const text of broken) {
      expect(() => JSON.parse(text), text).toThrow()
      expect(findJsonError(text), text).not.toBeNull()
    }
  })

  it('reports precise codes and positions', () => {
    expect(findJsonError('')).toMatchObject({ code: 'empty', pos: 0 })
    expect(findJsonError('{"a": 1')).toMatchObject({ code: 'unexpected-end', pos: 7 })
    expect(findJsonError('{"a": 1,}')).toMatchObject({ code: 'trailing-comma', pos: 7 })
    expect(findJsonError('[1, 2, ]')).toMatchObject({ code: 'trailing-comma', pos: 5 })
    expect(findJsonError('{a: 1}')).toMatchObject({ code: 'expected-property', pos: 1, found: 'a' })
    expect(findJsonError("{'a': 1}")).toMatchObject({ code: 'expected-property', pos: 1 })
    expect(findJsonError('{"a" 1}')).toMatchObject({ code: 'expected-colon', pos: 5 })
    expect(findJsonError('{"a": 1 "b": 2}')).toMatchObject({
      code: 'expected-comma-object',
      pos: 8,
      found: '"',
    })
    expect(findJsonError('[1 2]')).toMatchObject({ code: 'expected-comma-array', pos: 3 })
    // Missing comma at the end of a line: reported right after the value, as a point.
    expect(findJsonError('{\n  "a": 60\n  "b": 0\n}')).toMatchObject({
      code: 'expected-comma-object',
      pos: 11,
      end: 11,
      found: '"',
    })
    expect(findJsonError('[\n  1\n  2\n]')).toMatchObject({
      code: 'expected-comma-array',
      pos: 5,
      end: 5,
    })
    expect(findJsonError('{"a": }')).toMatchObject({ code: 'unexpected-token', pos: 6, found: '}' })
    expect(findJsonError('"abc')).toMatchObject({ code: 'unterminated-string', pos: 0 })
    expect(findJsonError('{"a": "x\n"}')).toMatchObject({ code: 'unterminated-string', pos: 6 })
    expect(findJsonError('"a\\x"')).toMatchObject({ code: 'bad-escape', pos: 2, found: '\\x' })
    expect(findJsonError('"\\u12G4"')).toMatchObject({ code: 'bad-escape', pos: 1 })
    expect(findJsonError('"a\tb"')).toMatchObject({ code: 'control-character', pos: 2 })
    expect(findJsonError('[01]')).toMatchObject({ code: 'bad-number', pos: 1, found: '01' })
    expect(findJsonError('[1.]')).toMatchObject({ code: 'bad-number', pos: 1, found: '1.' })
    expect(findJsonError('[.5]')).toMatchObject({ code: 'bad-number', pos: 1, found: '.5' })
    expect(findJsonError('{"a": tru}')).toMatchObject({ code: 'bad-literal', pos: 6, found: 'tru' })
    expect(findJsonError('[undefined]')).toMatchObject({ code: 'bad-literal', found: 'undefined' })
    expect(findJsonError('{} x')).toMatchObject({ code: 'trailing-content', pos: 3 })
    expect(findJsonError('{"a": 1} // c')).toMatchObject({ code: 'comment', pos: 9 })
  })

  it('handles long strings quickly and exactly', () => {
    const big = `{"p": "data:image/png;base64,${'A'.repeat(2_000_000)}"}`
    const start = performance.now()
    expect(findJsonError(big)).toBeNull()
    expect(performance.now() - start).toBeLessThan(500)
    expect(findJsonError(`{"p": "${'a'.repeat(1000)}\\q"}`)).toMatchObject({
      code: 'bad-escape',
      pos: 1007,
    })
  })

  it('finds errors in a large formatted document', () => {
    const text = formatJson(testDoc)
    const at = text.indexOf('"nm"', 5000)
    const broken = text.slice(0, at) + text.slice(at + 1)
    const err = findJsonError(broken)
    expect(err).not.toBeNull()
    expect(err!.pos).toBeGreaterThanOrEqual(at - 1)
  })
})

describe('findPathRange', () => {
  const text = formatJson(testDoc)

  it('locates keys, array items and nested values', () => {
    expect(slice(text, [])).toBe(text)
    expect(slice(text, ['v'])).toBe('"5.5.2"')
    expect(slice(text, ['fr'])).toBe('60')
    expect(JSON.parse(slice(text, ['layers', 3])!)).toEqual(testDoc.layers[3])
    expect(JSON.parse(slice(text, ['layers', 20, 'ks'])!)).toEqual(testDoc.layers[20].ks)
    expect(JSON.parse(slice(text, ['assets', 0, 'id'])!)).toBe('comp_0')
    expect(slice(text, ['layers', 0, 'nm'])).toBe('"Stick TOP"')
  })

  it('returns the key position for members', () => {
    const r = findPathRange(text, ['layers', 2, 'nm'])!
    expect(text.slice(r.keyFrom!, r.from)).toBe('"nm": ')
    expect(findPathRange(text, ['layers', 2])!.keyFrom).toBeUndefined()
  })

  it('returns null for missing paths', () => {
    expect(findPathRange(text, ['nope'])).toBeNull()
    expect(findPathRange(text, ['layers', 999])).toBeNull()
    expect(findPathRange(text, ['layers', -1])).toBeNull()
    expect(findPathRange(text, ['v', 'x'])).toBeNull()
    expect(findPathRange(text, ['layers', 'x'])).toBeNull()
    expect(findPathRange('[]', [0])).toBeNull()
    expect(findPathRange('', [])).toBeNull()
  })

  it('works on minified text and with tricky strings', () => {
    const minified = JSON.stringify({ a: 'x"}]', 'b\\"': [1, { c: '\\' }], d: [[], {}, 'e'] })
    expect(slice(minified, ['a'])).toBe('"x\\"}]"')
    expect(slice(minified, ['b\\"', 1, 'c'])).toBe('"\\\\"')
    expect(slice(minified, ['d', 2])).toBe('"e"')
    expect(slice(testText, ['layers', 5, 'nm'])).toBe(JSON.stringify(testDoc.layers[5].nm))
  })
})

describe('pathToAccessor', () => {
  it('formats JavaScript-style accessors', () => {
    expect(pathToAccessor(['layers', 3, 'ks', 'p'])).toBe('layers[3].ks.p')
    expect(pathToAccessor(['assets', 0, 'weird key', 2])).toBe('assets[0]["weird key"][2]')
    expect(pathToAccessor([])).toBe('')
    expect(pathToAccessor([1, 'a'])).toBe('[1].a')
  })
})
