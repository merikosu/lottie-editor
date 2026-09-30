import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animation } from '@/lottie/types'
import type * as StorageModule from '../storage'
import type { WriteInput } from '../storage'

const writes: WriteInput[] = []
let failWrites: 'quota' | null = null
const clearSession = vi.fn(async () => {})

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof StorageModule>()
  return {
    ...actual,
    writeDocument: vi.fn(async (input: WriteInput) => {
      if (failWrites) throw new actual.StorageError(failWrites, 'full')
      writes.push(input)
      return [input.recent]
    }),
    patchRecent: vi.fn(async () => []),
    clearSession: () => clearSession(),
  }
})
vi.mock('../thumbnail', () => ({ renderThumbnail: async () => null, whenIdle: () => {} }))

const listeners = new Map<string, () => void>()
vi.stubGlobal('document', {
  visibilityState: 'visible',
  addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
  removeEventListener: (type: string) => listeners.delete(type),
})

const { closeDocument, loadDocument, markSaved, redo, undo, updateDoc, useDocument } =
  await import('@/store/document')
const { setPrefs } = await import('@/store/prefs')
const { useIo } = await import('../store')
const { flushAutosave, hasUnsavedWork, installAutosave, isEditedSinceOpen, setDocumentInfo } =
  await import('../autosave')

function anim(nm: string): Animation {
  return { v: '5.7.4', fr: 30, ip: 0, op: 60, w: 100, h: 100, nm, layers: [] }
}

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms)
}

let uninstall: () => void = () => {}

describe('autosave', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    setPrefs({ autosave: true })
    uninstall = installAutosave()
  })
  afterAll(() => {
    uninstall()
    vi.useRealTimers()
  })
  beforeEach(async () => {
    closeDocument()
    await settle(10)
    writes.length = 0
    failWrites = null
    clearSession.mockClear()
    setPrefs({ autosave: true })
  })

  it('saves a newly opened document right away, with its original and as the session', async () => {
    setDocumentInfo('doc-a', { source: 'sample', contentKey: 'sample:a' })
    loadDocument(anim('A'), { id: 'doc-a', fileName: 'a.json' })
    expect(useIo.getState().save.kind).toBe('pending')
    await settle(0)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      session: true,
      recent: { id: 'doc-a', source: 'sample', contentKey: 'sample:a', edited: false },
    })
    expect(writes[0].original).toMatchObject({ stored: false, value: { nm: 'A' } })
    expect(useIo.getState().save.kind).toBe('saved')
  })

  it('debounces edits into one write and marks the entry edited', async () => {
    loadDocument(anim('A'), { id: 'doc-b', fileName: 'b.json' })
    await settle(0)
    writes.length = 0
    updateDoc('Rename', (d) => {
      d.nm = 'B1'
    })
    updateDoc('Rename', (d) => {
      d.nm = 'B2'
    })
    await settle(300)
    expect(writes).toHaveLength(0)
    expect(hasUnsavedWork()).toBe(true)
    await settle(400)
    expect(writes).toHaveLength(1)
    expect(writes[0].doc.doc.nm).toBe('B2')
    expect(writes[0].doc.dirty).toBe(true)
    expect(writes[0].recent.edited).toBe(true)
    // The original is written once only (later writes just make sure it is still there).
    expect(writes[0].original?.stored).toBe(true)
    expect(hasUnsavedWork()).toBe(false)
  })

  it('records the "exported" state after a download', async () => {
    loadDocument(anim('A'), { id: 'doc-c', fileName: 'c.json' })
    updateDoc('Rename', (d) => {
      d.nm = 'C'
    })
    await settle(700)
    writes.length = 0
    markSaved()
    await settle(0)
    expect(writes).toHaveLength(1)
    expect(writes[0].doc.dirty).toBe(false)
  })

  it('flushes pending edits of a replaced document without moving the session', async () => {
    loadDocument(anim('Old'), { id: 'doc-old', fileName: 'old.json' })
    await settle(0)
    updateDoc('Rename', (d) => {
      d.nm = 'Old edited'
    })
    writes.length = 0
    loadDocument(anim('New'), { id: 'doc-new', fileName: 'new.json' })
    await settle(0)
    expect(writes.map((w) => [w.doc.id, w.doc.doc.nm, w.session])).toEqual([
      ['doc-old', 'Old edited', false],
      ['doc-new', 'New', true],
    ])
  })

  it('flushes and forgets the session when the document is closed', async () => {
    loadDocument(anim('D'), { id: 'doc-d', fileName: 'd.json' })
    await settle(0)
    updateDoc('Rename', (d) => {
      d.nm = 'D edited'
    })
    writes.length = 0
    closeDocument()
    await settle(0)
    expect(writes.map((w) => [w.doc.doc.nm, w.session])).toEqual([['D edited', false]])
    expect(clearSession).toHaveBeenCalled()
    expect(useIo.getState().save.kind).toBe('idle')
  })

  it('writes nothing while autosave is off and catches up when it is turned on', async () => {
    setPrefs({ autosave: false })
    loadDocument(anim('E'), { id: 'doc-e', fileName: 'e.json' })
    updateDoc('Rename', (d) => {
      d.nm = 'E edited'
    })
    await settle(1000)
    expect(writes).toHaveLength(0)
    expect(hasUnsavedWork()).toBe(true)
    setPrefs({ autosave: true })
    await settle(0)
    expect(writes.map((w) => w.doc.doc.nm)).toEqual(['E edited'])
    setPrefs({ autosave: false })
    await settle(0)
    expect(clearSession).toHaveBeenCalled()
  })

  it('shows storage failures and retries on the next change', async () => {
    failWrites = 'quota'
    loadDocument(anim('F'), { id: 'doc-f', fileName: 'f.json' })
    await settle(0)
    expect(useIo.getState().save).toEqual({ kind: 'error', reason: 'quota' })
    expect(hasUnsavedWork()).toBe(true)
    failWrites = null
    updateDoc('Rename', (d) => {
      d.nm = 'F edited'
    })
    await settle(700)
    expect(writes.map((w) => w.doc.doc.nm)).toEqual(['F edited'])
    expect(useIo.getState().save.kind).toBe('saved')
  })

  it('writes a dotLottie container once, not with every edit', async () => {
    const container = { kind: 'dotlottie', animations: [] }
    loadDocument(anim('H'), {
      id: 'doc-h',
      fileName: 'h.lottie',
      format: 'lottie',
      dotLottie: container,
    })
    await settle(0)
    updateDoc('Rename', (d) => {
      d.nm = 'H edited'
    })
    await settle(700)
    expect(writes.map((w) => w.container)).toEqual([
      { value: container, changed: true },
      { value: container, changed: false },
    ])
    expect(writes.every((w) => w.doc.meta.dotLottie === undefined)).toBe(true)
  })

  it('writes immediately on demand and when the tab is hidden', async () => {
    loadDocument(anim('G'), { id: 'doc-g', fileName: 'g.json' })
    await settle(0)
    updateDoc('Rename', (d) => {
      d.nm = 'G1'
    })
    writes.length = 0
    await flushAutosave()
    expect(writes.map((w) => w.doc.doc.nm)).toEqual(['G1'])
    updateDoc('Rename', (d) => {
      d.nm = 'G2'
    })
    ;(document as { visibilityState: string }).visibilityState = 'hidden'
    listeners.get('visibilitychange')?.()
    await settle(0)
    expect(writes.map((w) => w.doc.doc.nm)).toEqual(['G1', 'G2'])
    ;(document as { visibilityState: string }).visibilityState = 'visible'
    expect(useDocument.getState().doc?.nm).toBe('G2')
  })

  it('knows whether the document differs from how it was opened', async () => {
    loadDocument(anim('I'), { id: 'doc-i', fileName: 'i.json' })
    expect(isEditedSinceOpen()).toBe(false)
    updateDoc('Rename', (d) => {
      d.nm = 'I edited'
    })
    expect(isEditedSinceOpen()).toBe(true)
    // Undoing everything gives an equal document back: nothing left to revert.
    undo()
    expect(isEditedSinceOpen()).toBe(false)
    redo()
    expect(isEditedSinceOpen()).toBe(true)
    // A document restored with edits from an earlier session starts out edited.
    setDocumentInfo('doc-j', { edited: true })
    loadDocument(anim('J'), { id: 'doc-j', fileName: 'j.json' })
    expect(isEditedSinceOpen()).toBe(true)
    await settle(0)
  })

  it('writes large documents less often', async () => {
    loadDocument(anim('K'), { id: 'doc-k', fileName: 'k.json', sourceSize: 3_000_000 })
    await settle(0)
    writes.length = 0
    updateDoc('Rename', (d) => {
      d.nm = 'K edited'
    })
    await settle(700)
    expect(writes).toHaveLength(0)
    await settle(900)
    expect(writes.map((w) => w.doc.doc.nm)).toEqual(['K edited'])
  })
})
