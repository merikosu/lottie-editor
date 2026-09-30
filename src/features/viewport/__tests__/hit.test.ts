import { describe, expect, it } from 'vitest'
import type { NodePath } from '@/lottie/path'
import { drillDown, hitStack, isRootLayerPath, pickFromStack } from '../lib/hit'

const lockedRoot = (p: NodePath) => p.length === 2 && p[1] === 6

// Tagged paths as nodePathsFromElement returns them: innermost first.
const innermost: NodePath[] = [
  ['assets', 0, 'layers', 2, 'shapes', 1, 'it', 0],
  ['assets', 0, 'layers', 2, 'shapes', 1],
  ['assets', 0, 'layers', 2],
  ['layers', 6],
]

describe('hitStack', () => {
  it('orders outermost first', () => {
    expect(hitStack(innermost)).toEqual([...innermost].reverse())
  })

  it('removes duplicates (a node tagged on several nested elements)', () => {
    expect(
      hitStack([
        ['layers', 1],
        ['layers', 1],
        ['layers', 0],
      ]),
    ).toEqual([
      ['layers', 0],
      ['layers', 1],
    ])
  })

  it('handles empty hits', () => {
    expect(hitStack([])).toEqual([])
  })
})

describe('pickFromStack', () => {
  const stack = hitStack(innermost)

  it('click selects the root-composition layer', () => {
    expect(pickFromStack(stack, 'root')).toEqual(['layers', 6])
  })

  it('⌘-click selects the deepest node', () => {
    expect(pickFromStack(stack, 'deep')).toEqual(['assets', 0, 'layers', 2, 'shapes', 1, 'it', 0])
  })

  it('falls back to the outermost node when no root layer is tagged', () => {
    expect(pickFromStack([['assets', 0, 'layers', 1]], 'root')).toEqual(['assets', 0, 'layers', 1])
  })

  it('blocked (locked) nodes make the whole hit unselectable', () => {
    expect(pickFromStack(stack, 'root', lockedRoot)).toBeNull()
    expect(pickFromStack(stack, 'deep', lockedRoot)).toBeNull()
  })

  it('returns null for empty stacks', () => {
    expect(pickFromStack([], 'root')).toBeNull()
  })

  it('recognizes root layer paths', () => {
    expect(isRootLayerPath(['layers', 0])).toBe(true)
    expect(isRootLayerPath(['layers', 'x'])).toBe(false)
    expect(isRootLayerPath(['assets', 0, 'layers', 0])).toBe(false)
  })
})

describe('drillDown', () => {
  const stack = hitStack(innermost)

  it('goes one level deeper than the selected node', () => {
    expect(drillDown(stack, [['layers', 6]])).toEqual(['assets', 0, 'layers', 2])
    expect(drillDown(stack, [['assets', 0, 'layers', 2]])).toEqual([
      'assets',
      0,
      'layers',
      2,
      'shapes',
      1,
    ])
  })

  it('uses the deepest selected node of the stack', () => {
    expect(
      drillDown(stack, [
        ['layers', 6],
        ['assets', 0, 'layers', 2, 'shapes', 1],
      ]),
    ).toEqual(['assets', 0, 'layers', 2, 'shapes', 1, 'it', 0])
  })

  it('selects the root node when nothing in the stack is selected', () => {
    expect(drillDown(stack, [['layers', 0]])).toEqual(['layers', 6])
    expect(drillDown(stack, [])).toEqual(['layers', 6])
  })

  it('returns null at the innermost level or for empty stacks', () => {
    expect(drillDown(stack, [stack[stack.length - 1]])).toBeNull()
    expect(drillDown([], [])).toBeNull()
  })
})
