import { freeze, produce } from 'immer'
import { describe, expect, it } from 'vitest'
import testText from '../../../../docs/test.json?raw'
import { diffText, formatJson, utf8Length } from '../format'

const testDoc = JSON.parse(testText) as unknown

describe('formatJson', () => {
  it('keeps short containers inline and breaks long ones', () => {
    const text = formatJson({
      v: '5.5.2',
      c: { a: 0, k: [1, 0.5, 0.25, 1] },
      empty: [],
      none: {},
      list: [{ t: 0 }, { t: 1 }],
    })
    expect(text.split('\n')).toEqual([
      '{',
      '  "v": "5.5.2",',
      '  "c": {"a": 0, "k": [1, 0.5, 0.25, 1]},',
      '  "empty": [],',
      '  "none": {},',
      '  "list": [{"t": 0}, {"t": 1}]',
      '}',
    ])
    expect(formatJson({ c: { a: 0, k: [1, 0.5, 0.25, 1] } })).toBe(
      '{"c": {"a": 0, "k": [1, 0.5, 0.25, 1]}}',
    )
    const long = formatJson({
      layers: Array.from({ length: 12 }, (_, i) => ({ nm: `Layer number ${i}`, ind: i })),
    })
    expect(long.split('\n')[0]).toBe('{')
    expect(long.split('\n')[1]).toBe('  "layers": [')
    expect(long.split('\n')[2]).toBe('    {"nm": "Layer number 0", "ind": 0},')
    expect(long.endsWith('  ]\n}')).toBe(true)
  })

  it('respects the width including indentation and key', () => {
    const value = { key: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], other: 1 }
    expect(formatJson(value, { width: 200 })).toBe(
      '{"key": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "other": 1}',
    )
    expect(formatJson(value, { width: 45 })).toBe(
      '{\n  "key": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],\n  "other": 1\n}',
    )
    expect(formatJson(value, { width: 20 }).split('\n')).toEqual([
      '{',
      '  "key": [',
      '    1,',
      '    2,',
      '    3,',
      '    4,',
      '    5,',
      '    6,',
      '    7,',
      '    8,',
      '    9,',
      '    10',
      '  ],',
      '  "other": 1',
      '}',
    ])
  })

  it('matches JSON.stringify semantics for primitives and skipped values', () => {
    const value = {
      s: 'quote " and \\ and \n and  ',
      n: -0,
      big: 1e21,
      inf: Infinity,
      nan: Number.NaN,
      t: true,
      f: false,
      z: null,
      u: undefined,
      fn: () => 1,
      arr: [undefined, () => 1, 1],
    }
    expect(JSON.parse(formatJson(value))).toEqual(JSON.parse(JSON.stringify(value)))
    expect(formatJson('plain')).toBe('"plain"')
    expect(formatJson(3.5)).toBe('3.5')
    expect(formatJson(null)).toBe('null')
  })

  it('round-trips a real Lottie file and is idempotent', () => {
    const text = formatJson(testDoc)
    expect(JSON.parse(text)).toEqual(testDoc)
    expect(formatJson(JSON.parse(text))).toBe(text)
    // Much more compact than the standard 2-space layout.
    expect(text.length).toBeLessThan(JSON.stringify(testDoc, null, 2).length / 2)
    // Only lines holding a long string (an expression here) may exceed the width.
    const longString = /"(?:[^"\\]|\\.){80,}"/
    for (const line of text.split('\n')) {
      if (!longString.test(line)) expect(line.length).toBeLessThanOrEqual(100)
    }
  })

  it('keeps unicode keys and non-ASCII strings intact', () => {
    const value = { ключ: 'значение', '"q"': 1, emoji: '😀' }
    expect(JSON.parse(formatJson(value))).toEqual(value)
  })

  it('reuses cached text for unchanged frozen subtrees and stays correct after edits', () => {
    const base = freeze(structuredClone(testDoc), true) as { layers: { nm: string }[] }
    const first = formatJson(base)
    const edited = produce(base, (d) => {
      d.layers[3].nm = 'Renamed layer'
    })
    const second = formatJson(edited)
    expect(second).toBe(formatJson(JSON.parse(JSON.stringify(edited))))
    expect(second).not.toBe(first)
    expect(second.includes('"nm": "Renamed layer"')).toBe(true)
    // Formatting the same object at a different depth must not reuse the cached text.
    const nested = formatJson({ wrapper: { inner: base.layers } })
    expect(JSON.parse(nested)).toEqual({ wrapper: { inner: base.layers } })
    expect(nested).toBe(formatJson(JSON.parse(JSON.stringify({ wrapper: { inner: base.layers } }))))
  })
})

const apply = (a: string, c: ReturnType<typeof diffText>) =>
  c ? a.slice(0, c.from) + c.insert + a.slice(c.to) : a

describe('diffText', () => {
  it('returns null for equal texts', () => {
    expect(diffText('abc', 'abc')).toBeNull()
  })

  it('finds the minimal replacement', () => {
    expect(diffText('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave ',
    })
    expect(diffText('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' })
    expect(diffText('abc', '')).toEqual({ from: 0, to: 3, insert: '' })
    expect(diffText('', 'abc')).toEqual({ from: 0, to: 0, insert: 'abc' })
    expect(diffText('aaaa', 'aa')).toEqual({ from: 2, to: 4, insert: '' })
  })

  it('applies correctly on real edits', () => {
    const a = formatJson(testDoc)
    const doc = structuredClone(testDoc) as { layers: { nm: string }[] }
    doc.layers[10].nm = 'x'
    const b = formatJson(doc)
    const change = diffText(a, b)!
    expect(a.slice(0, change.from) + change.insert + a.slice(change.to)).toBe(b)
    expect(change.insert.length).toBeLessThan(40)
  })

  it('handles long texts with changes anywhere (chunked comparison)', () => {
    const base = 'abcdefghij'.repeat(10_000) // 100k characters, several 16K chunks
    for (const at of [0, 5, 16_383, 16_384, 16_385, 50_000, 99_990, 99_999]) {
      const changed = base.slice(0, at) + 'XYZ' + base.slice(at + 1)
      const c = diffText(base, changed)!
      expect(apply(base, c)).toBe(changed)
      expect(c.insert).toBe('XYZ')
      expect(c.to - c.from).toBe(1)
    }
    expect(apply(base, diffText(base, base + 'tail'))).toBe(base + 'tail')
    expect(apply(base, diffText(base, 'head' + base))).toBe('head' + base)
    expect(apply(base + 'x', diffText(base + 'x', base))).toBe(base)
  })

  it('never splits surrogate pairs', () => {
    const a = 'x😀y'
    const b = 'x😃y'
    const change = diffText(a, b)!
    expect(change).toEqual({ from: 1, to: 3, insert: '😃' })
    const c = diffText('😀a', '😀b')!
    expect(c).toEqual({ from: 2, to: 3, insert: 'b' })
  })
})

describe('utf8Length', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('é')).toBe(2)
    expect(utf8Length('€')).toBe(3)
    expect(utf8Length('😀')).toBe(4)
    expect(utf8Length('привет')).toBe(new TextEncoder().encode('привет').length)
    const mixed = `{"nm": "Слой 😀 €", "x": "${'a'.repeat(1000)}"}`
    expect(utf8Length(mixed)).toBe(new TextEncoder().encode(mixed).length)
    expect(utf8Length('')).toBe(0)
  })
})
