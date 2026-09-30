import { jsonLanguage } from '@codemirror/lang-json'
import { describe, expect, it } from 'vitest'
import testText from '../../../../docs/test.json?raw'
import { formatJson } from '../format'
import { findPathRange } from '../json-scan'
import { pathAtPosition, pathRangeInTree } from '../json-tree'

const testDoc = JSON.parse(testText) as {
  layers: unknown[]
}

function parse(text: string) {
  const tree = jsonLanguage.parser.parse(text)
  const read = (from: number, to: number) => text.slice(from, to)
  return { tree, read }
}

describe('pathRangeInTree', () => {
  const text = formatJson(testDoc)
  const { tree, read } = parse(text)

  it('agrees with the text scanner on a real document', () => {
    const paths: (string | number)[][] = [
      [],
      ['v'],
      ['layers', 0],
      ['layers', 7, 'ks'],
      ['layers', 20, 'shapes', 0],
      ['assets', 0, 'layers', 0, 'shapes'],
      ['layers', 99],
      ['nope'],
    ]
    for (const path of paths) {
      expect(pathRangeInTree(tree, text.length, read, path), path.join('/')).toEqual(
        findPathRange(text, path),
      )
    }
  })

  it('keeps working after a syntax error earlier in the text', () => {
    const broken = '{"a": [1, 2 3], "b": {"c": [10, 20]}}'
    const { tree: t2, read: r2 } = parse(broken)
    const r = pathRangeInTree(t2, broken.length, r2, ['b', 'c', 1])!
    expect(broken.slice(r.from, r.to)).toBe('20')
    expect(broken.slice(r.keyFrom ?? r.from, r.from)).toBe('')
    const member = pathRangeInTree(t2, broken.length, r2, ['b'])!
    expect(broken.slice(member.keyFrom!, member.from)).toBe('"b": ')
  })

  it('reports undefined when a partial tree does not reach the target', () => {
    const big = formatJson(testDoc)
    const cut = Math.floor(big.length / 3)
    const partial = jsonLanguage.parser.parse(big.slice(0, cut))
    const readBig = (from: number, to: number) => big.slice(from, to)
    expect(pathRangeInTree(partial, big.length, readBig, ['layers', 20])).toBeUndefined()
    expect(pathRangeInTree(partial, big.length, readBig, ['v'])).toEqual(findPathRange(big, ['v']))
  })
})

describe('pathAtPosition', () => {
  const text = '{\n  "a": [1, {"b": null, "c": "x"}],\n  "d": {"e": 5}\n}'
  const { tree, read } = parse(text)
  const at = (needle: string, offset = 0) =>
    pathAtPosition(tree, read, text.indexOf(needle) + offset)

  it('maps positions inside values, keys and punctuation', () => {
    expect(at('null')).toEqual(['a', 1, 'b'])
    expect(at('null', 2)).toEqual(['a', 1, 'b'])
    expect(at('"b"')).toEqual(['a', 1, 'b'])
    expect(at('"x"', 1)).toEqual(['a', 1, 'c'])
    expect(at('1,', 0)).toEqual(['a', 0])
    expect(at('1,', 1)).toEqual(['a', 0])
    expect(at('5')).toEqual(['d', 'e'])
    expect(at('"d"', 2)).toEqual(['d'])
    // On the opening brace of an array item: that item.
    expect(at('{"b"')).toEqual(['a', 1])
    expect(at('{"e"')).toEqual(['d'])
    expect(at('[1')).toEqual(['a'])
    expect(pathAtPosition(tree, read, 0)).toEqual([])
    expect(pathAtPosition(tree, read, text.length)).toEqual([])
  })

  it('round-trips with pathRangeInTree on a real document', () => {
    const big = formatJson(testDoc)
    const parsed = parse(big)
    for (const path of [
      ['layers', 4, 'ks', 'o'],
      ['assets', 0, 'id'],
      ['layers', 12, 'nm'],
    ]) {
      const r = pathRangeInTree(parsed.tree, big.length, parsed.read, path)!
      expect(pathAtPosition(parsed.tree, parsed.read, r.from + 1)).toEqual(path)
    }
  })
})
