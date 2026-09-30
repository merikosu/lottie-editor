// @vitest-environment jsdom
/**
 * Composition-time hooks of the inspector with big selections: every node of a composition
 * shares one time mapping object, so selectors stay stable (no update loop) for hundreds of nodes.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { closeDocument, loadDocument } from '@/store/document'
import { useCompTimes } from '../hooks'
import type { CompTime } from '../model/time'

const layer = (i: number) => ({
  ty: 4,
  ind: i + 1,
  nm: `L${i}`,
  ip: 0,
  op: 60,
  st: 0,
  ks: {},
  shapes: [],
})

function doc(count: number): Animation {
  const inner = { ty: 4, ind: 1, nm: 'Inner', ip: 0, op: 60, st: 0, ks: {}, shapes: [] }
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    assets: [{ id: 'comp', layers: [inner] }],
    layers: [
      ...Array.from({ length: count }, (_, i) => layer(i)),
      { ty: 0, ind: count + 1, refId: 'comp', ip: 0, op: 60, st: 10, w: 100, h: 100, ks: {} },
    ],
  } as unknown as Animation
}

afterEach(() => {
  cleanup()
  closeDocument()
})

describe('useCompTimes', () => {
  it('handles hundreds of selected nodes with shared, stable mappings', () => {
    const count = 600
    loadDocument(doc(count), { fileName: 'big.json' })
    const paths: NodePath[] = [
      ...Array.from({ length: count }, (_, i) => ['layers', i]),
      ['assets', 0, 'layers', 0],
    ]
    const seen: CompTime[][] = []
    function Probe() {
      seen.push(useCompTimes(paths))
      return null
    }
    const { rerender } = render(<Probe />)
    rerender(<Probe />)
    const last = seen[seen.length - 1]
    expect(last).toHaveLength(count + 1)
    // Root layers share one mapping; the precomp child maps through its instance (st 10).
    expect(new Set(last.slice(0, count)).size).toBe(1)
    expect(last[count].assetIndex).toBe(0)
    expect(last[count].frame).toBe(-10)
    // Re-rendering returns the very same objects.
    expect(seen[seen.length - 2].every((t, i) => t === last[i])).toBe(true)
  })
})
