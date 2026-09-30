import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  doc,
  fill,
  group,
  kf,
  layer,
  p,
  rect,
  transform,
  type J,
} from '@/lottie/__tests__/insights.fixtures'
import type { Animation } from '@/lottie/types'
import { validate } from '@/lottie/validate'
import { getDoc, loadDocument, undo, updateDoc, useDocument } from '@/store/document'
import { fixableCount, fixAllSafe, fixIssue, safeFixes, showPlaces } from '../actions'
import { acquireAnalysis, debounceFor, retryAnalysis } from '../engine'
import { setTarget, useAnalysis, useIssuesUi } from '../store'
import { targetView } from '../view'

/** A document with a few safely fixable problems and one unsafe one (an expression). */
function broken(): Animation {
  const single: J = { a: 1, k: [{ t: 0, s: [50] }] }
  return doc([
    layer(1, { nm: 'Single', ks: transform({ o: single }) }),
    layer(2, { nm: 'Orphan', parent: 42 }),
    layer(3, {
      nm: 'Expr',
      ks: transform({ r: { ...p(0), x: 'time * 90' } }),
      shapes: [group([rect(), fill({ c: kf([0, [1, 0, 0, 1]], [10, [0, 0, 1, 1]]) })])],
    }),
  ])
}

function clean(): Animation {
  return doc([layer(1)], { fr: 60, op: 120 })
}

let release: (() => void) | null = null

async function settle(ms = 2000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  setTarget('all')
  loadDocument(broken(), { fileName: 'broken.json' })
  release = acquireAnalysis()
})

afterEach(() => {
  release?.()
  release = null
  vi.useRealTimers()
})

describe('analysis engine', () => {
  it('analyzes the open document off the edit path', async () => {
    expect(useAnalysis.getState().pending).toBe(true)
    await settle()
    const state = useAnalysis.getState()
    expect(state.pending).toBe(false)
    expect(state.doc).toBe(getDoc())
    expect(state.result?.size?.raw).toBe(JSON.stringify(getDoc()).length)
    expect(state.result?.size?.gzip).toBeGreaterThan(0)
    expect(state.result?.stats?.layers).toBe(3)
    expect(state.result?.issues?.some((i) => i.code === 'prop.singleKeyframe')).toBe(true)
  })

  it('waits for edits to settle', async () => {
    await settle()
    updateDoc('Rename', (d) => {
      d.nm = 'Edited'
    })
    expect(useAnalysis.getState().pending).toBe(true)
    await vi.advanceTimersByTimeAsync(250)
    // A burst of edits keeps pushing the analysis back.
    updateDoc('Rename', (d) => {
      d.nm = 'Edited again'
    })
    await vi.advanceTimersByTimeAsync(250)
    expect(useAnalysis.getState().doc).not.toBe(getDoc())
    await settle()
    expect(useAnalysis.getState().doc).toBe(getDoc())
    expect(useAnalysis.getState().pending).toBe(false)
  })

  it('never shows the previous file’s results for another file', async () => {
    await settle()
    expect(useAnalysis.getState().result).not.toBeNull()
    useIssuesUi.setState({ expanded: { x: true } })
    loadDocument(clean(), { fileName: 'clean.json' })
    expect(useAnalysis.getState().result).toBeNull()
    expect(useIssuesUi.getState().expanded).toEqual({})
    await settle()
    const issues = useAnalysis.getState().result?.issues ?? []
    expect(targetView(issues, 'all', new Set()).issues).toEqual([])
  })

  it('stops when the last consumer leaves', async () => {
    await settle()
    release?.()
    release = null
    const before = useAnalysis.getState().doc
    updateDoc('Rename', (d) => {
      d.nm = 'Unwatched'
    })
    await settle()
    expect(useAnalysis.getState().doc).toBe(before)
    // Coming back picks the change up.
    release = acquireAnalysis()
    await settle()
    expect(useAnalysis.getState().doc).toBe(getDoc())
  })

  it('can be asked to check again', async () => {
    await settle()
    retryAnalysis()
    expect(useAnalysis.getState().pending).toBe(true)
    await settle()
    expect(useAnalysis.getState().doc).toBe(getDoc())
  })

  it('waits longer on big files', () => {
    expect(debounceFor(undefined)).toBe(300)
    expect(debounceFor(200_000)).toBe(300)
    expect(debounceFor(2 * 1024 * 1024)).toBeGreaterThan(300)
    expect(debounceFor(8 * 1024 * 1024)).toBeGreaterThan(debounceFor(2 * 1024 * 1024))
  })
})

describe('fixes', () => {
  it('fixes one issue as one undo step with a readable label', async () => {
    await settle()
    const issue = validate(getDoc()!).find((i) => i.code === 'prop.singleKeyframe')!
    const pastBefore = useDocument.getState().past.length
    expect(fixIssue(issue)).toBe(true)
    const s = useDocument.getState()
    expect(s.past.length).toBe(pastBefore + 1)
    expect(s.past[s.past.length - 1].label).toBe('Fix: Animated property with one keyframe')
    expect((getDoc()!.layers[0] as unknown as { ks: { o: J } }).ks.o).toEqual({ a: 0, k: 50 })
    // Hidden at once, confirmed by the next analysis.
    expect(useIssuesUi.getState().fixed.has(issue.id)).toBe(true)
    await settle()
    expect(useAnalysis.getState().result?.issues?.some((i) => i.id === issue.id)).toBe(false)
    expect(useIssuesUi.getState().fixed.size).toBe(0)
    undo()
    expect((getDoc()!.layers[0] as unknown as { ks: { o: J } }).ks.o.a).toBe(1)
  })

  it('re-validates instead of trusting stale paths', async () => {
    await settle()
    const issue = validate(getDoc()!).find((i) => i.code === 'layer.parentMissing')!
    // The orphan moves to the top before the fix runs: the old path points at another layer.
    updateDoc('Reorder', (d) => {
      d.layers.unshift(d.layers.splice(1, 1)[0])
    })
    expect(fixIssue(issue)).toBe(true)
    const layers = getDoc()!.layers as unknown as J[]
    expect(layers[0].nm).toBe('Orphan')
    expect(layers[0].parent).toBeUndefined()
    expect(layers[1].nm).toBe('Single')
  })

  it('reports nothing to do when the problem is already gone', async () => {
    await settle()
    const issue = validate(getDoc()!).find((i) => i.code === 'layer.parentMissing')!
    updateDoc('Unparent', (d) => {
      delete (d.layers[1] as unknown as J).parent
    })
    const pastBefore = useDocument.getState().past.length
    expect(fixIssue(issue)).toBe(false)
    expect(useDocument.getState().past.length).toBe(pastBefore)
  })

  it('applies every safe fix in one step and leaves unsafe ones', async () => {
    await settle()
    expect(fixableCount()).toBe(safeFixes(getDoc()!).length)
    expect(fixableCount()).toBeGreaterThan(1)
    const pastBefore = useDocument.getState().past.length
    const fixed = fixAllSafe()
    expect(fixed).toBeGreaterThan(1)
    expect(useDocument.getState().past.length).toBe(pastBefore + 1)
    const after = validate(getDoc()!)
    expect(after.some((i) => i.safe && i.fix)).toBe(false)
    // The expression stays: removing it changes what lottie-web draws.
    expect(after.some((i) => i.code === 'compat' && i.params.feature === 'expressions')).toBe(true)
    await settle()
    expect(fixableCount()).toBe(0)
  })
})

describe('show', () => {
  it('selects the node, focuses the property and its keyframe', () => {
    showPlaces([['layers', 2, 'shapes', 0, 'it', 1, 'c', 'k', 1, 's']])
    const sel = useDocument.getState().selection
    expect(sel.nodes).toEqual([['layers', 2, 'shapes', 0, 'it', 1]])
    expect(sel.property).toEqual(['layers', 2, 'shapes', 0, 'it', 1, 'c'])
    expect(sel.keyframes).toEqual([{ path: ['layers', 2, 'shapes', 0, 'it', 1, 'c'], index: 1 }])
  })

  it('selects every layer of a multi-place issue once', () => {
    showPlaces([
      ['layers', 0, 'ks', 'o'],
      ['layers', 0, 'ks', 'r'],
      ['layers', 1],
    ])
    const sel = useDocument.getState().selection
    expect(sel.nodes).toEqual([
      ['layers', 0],
      ['layers', 1],
    ])
    expect(sel.property).toBeNull()
  })

  it('ignores places that no longer exist', () => {
    const before = useDocument.getState().selection
    showPlaces([['layers', 9]])
    expect(useDocument.getState().selection).toBe(before)
  })
})
