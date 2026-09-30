import { describe, expect, it } from 'vitest'
import { fold, foldChar, fuzzyMatchToken, queryTokens, wordStarts } from '../fuzzy'
import { switchLayout } from '../keyboard-layout'

const score = (token: string, text: string) => fuzzyMatchToken(fold(token), text)?.score ?? null
const positions = (token: string, text: string) =>
  fuzzyMatchToken(fold(token), text)?.positions ?? null

describe('fold', () => {
  it('lower-cases and keeps the length', () => {
    expect(fold('Zoom To Fit')).toBe('zoom to fit')
    expect(fold('ЁЛКА')).toBe('елка')
    expect(fold('İ').length).toBe(1)
  })

  it('treats ё as е', () => {
    expect(foldChar('ё')).toBe('е')
    expect(foldChar('Ё')).toBe('е')
  })
})

describe('wordStarts', () => {
  it('marks the first character, separators, camelCase and digit boundaries', () => {
    const text = 'Zoom to-fit camelCase mp4'
    const starts = wordStarts(text)
    const at = (s: string, from = 0) => text.indexOf(s, from)
    expect(starts[0]).toBe(true)
    expect(starts[at('to')]).toBe(true)
    expect(starts[at('fit')]).toBe(true)
    expect(starts[at('Case')]).toBe(true)
    expect(starts[at('4')]).toBe(true)
    expect(starts[at('oom')]).toBe(false)
    expect(starts[at('-')]).toBe(false)
  })
})

describe('fuzzyMatchToken', () => {
  it('matches case-insensitively and returns positions in the original text', () => {
    expect(positions('zoom', 'Zoom to fit')).toEqual([0, 1, 2, 3])
    expect(positions('fit', 'Zoom to fit')).toEqual([8, 9, 10])
  })

  it('returns an empty match for an empty token and null when absent', () => {
    expect(fuzzyMatchToken('', 'anything')).toEqual({ score: 0, positions: [] })
    expect(score('xyz', 'Zoom to fit')).toBeNull()
    expect(score('toolong', 'tool')).toBeNull()
  })

  it('prefers word-start acronyms over scattered letters', () => {
    expect(positions('tt', 'Toggle timeline')).toEqual([0, 7])
    expect(positions('zf', 'Zoom to fit')).toEqual([0, 8])
  })

  it('ranks exact > prefix > word start > inside a word', () => {
    const exact = score('undo', 'Undo')!
    const prefix = score('undo', 'Undo history')!
    const word = score('undo', 'Nothing to undo')!
    const inside = score('ndo', 'Undo')!
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(inside)
  })

  it('prefers consecutive characters', () => {
    expect(score('time', 'Timeline')!).toBeGreaterThan(score('time', 'Toggle image mode')!)
  })

  it('only lets a single character match a word start', () => {
    expect(positions('a', 'Add marker')).toEqual([0])
    expect(positions('m', 'Add marker')).toEqual([4])
    expect(score('d', 'Add marker')).toBeNull()
    expect(positions('2', 'Speed 2×')).toEqual([6])
  })

  it('rejects letters scattered through the middle of words', () => {
    expect(score('oaie', 'Solo animation')).toBeNull()
    expect(score('dlkfs', 'Delete keyframes')).toBeNull()
  })

  it('keeps contiguous matches inside a word', () => {
    expect(positions('frame', 'Keyframes')).toEqual([3, 4, 5, 6, 7])
  })

  it('matches Russian text and ё/е interchangeably', () => {
    expect(positions('слой', 'Новый слой')).toEqual([6, 7, 8, 9])
    expect(score('темная', 'Тёмная тема')).not.toBeNull()
    expect(score('тёмная', 'Темная тема')).not.toBeNull()
  })

  it('handles punctuation typed by the user', () => {
    expect(positions('ping-pong', 'Ping-pong loop')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(score('0.5', 'Speed 0.5×')).not.toBeNull()
  })

  it('does not blow up on long texts', () => {
    const long = 'a'.repeat(5000) + 'target'
    expect(score('target', long)).toBeNull()
    expect(score('aaa', long)).not.toBeNull()
  })
})

describe('queryTokens', () => {
  it('splits on whitespace and folds', () => {
    expect(queryTokens('  Zoom   TO fit ')).toEqual(['zoom', 'to', 'fit'])
    expect(queryTokens('   ')).toEqual([])
  })
})

describe('switchLayout', () => {
  it('converts QWERTY-typed Russian words', () => {
    expect(switchLayout('pfuheprf')).toBe('загрузка')
    expect(switchLayout('ckjq')).toBe('слой')
  })

  it('converts ЙЦУКЕН-typed English words', () => {
    expect(switchLayout('ызуув')).toBe('speed')
    expect(switchLayout('Шьфпу')).toBe('image')
  })

  it('maps punctuation keys', () => {
    expect(switchLayout('ghbdtn,')).toBe('приветб')
    expect(switchLayout('.')).toBeNull()
  })

  it('returns null for text without letters', () => {
    expect(switchLayout('42')).toBeNull()
    expect(switchLayout('')).toBeNull()
  })
})
