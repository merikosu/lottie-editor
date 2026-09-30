/**
 * "Edited since the last export" follows the content: undoing back to the last clean state, or
 * reverting to the original of a file never exported, makes the document clean again.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Animation } from '@/lottie/types'
import {
  closeDocument,
  isDirty,
  jumpToHistory,
  loadDocument,
  markSaved,
  redo,
  replaceDoc,
  undo,
  updateDoc,
  useDocument,
} from '@/store/document'
import { installCleanTracking, markCleanIfOriginal } from '../clean'

const doc = (nm: string): Animation =>
  ({ v: '5.7.0', fr: 30, ip: 0, op: 30, w: 100, h: 100, nm, layers: [] }) as unknown as Animation

const rename = (nm: string) => updateDoc('Rename', (d) => void (d.nm = nm))
const dirty = () => isDirty(useDocument.getState())

let uninstall: () => void

beforeEach(() => {
  uninstall = installCleanTracking()
  loadDocument(doc('a'), { fileName: 'a.json' })
})

afterEach(() => {
  uninstall()
  closeDocument()
})

describe('clean tracking', () => {
  it('undoing every change of an opened file makes it clean again', () => {
    rename('b')
    rename('c')
    expect(dirty()).toBe(true)
    undo()
    expect(dirty()).toBe(true)
    undo()
    expect(dirty()).toBe(false)
    redo()
    expect(dirty()).toBe(true)
  })

  it('returns to the last export, not to the opened file', () => {
    rename('b')
    markSaved()
    rename('c')
    expect(dirty()).toBe(true)
    undo()
    expect(dirty()).toBe(false)
    undo()
    // The opened state differs from what was exported.
    expect(dirty()).toBe(true)
    jumpToHistory(2)
    expect(dirty()).toBe(true)
    // Straight back to the exported step.
    jumpToHistory(1)
    expect(dirty()).toBe(false)
  })

  it('a gesture that continues a saved step keeps the document edited', () => {
    updateDoc('Nudge', (d) => void (d.w = 101), { coalesceKey: 'nudge' })
    markSaved()
    // The next nudge (same key, right away) merges into the saved step.
    updateDoc('Nudge', (d) => void (d.w = 102), { coalesceKey: 'nudge' })
    expect(useDocument.getState().past).toHaveLength(1)
    expect(dirty()).toBe(true)
    undo()
    expect(useDocument.getState().doc?.w).toBe(100)
    expect(dirty()).toBe(true)
  })

  it('reverting a file that was never exported makes it clean', () => {
    rename('b')
    replaceDoc('Revert', useDocument.getState().original!)
    markCleanIfOriginal()
    expect(dirty()).toBe(false)
    // A later revert after more edits is clean too.
    rename('c')
    replaceDoc('Revert', useDocument.getState().original!)
    markCleanIfOriginal()
    expect(dirty()).toBe(false)
  })

  it('reverting after an export stays edited (the export differs from the original)', () => {
    rename('b')
    markSaved()
    replaceDoc('Revert', useDocument.getState().original!)
    markCleanIfOriginal()
    expect(dirty()).toBe(true)
  })

  it('a restored session with unexported changes is not clean until exported', () => {
    loadDocument(doc('x'), { fileName: 'x.json', original: doc('orig'), dirty: true })
    rename('y')
    undo()
    expect(dirty()).toBe(true)
    replaceDoc('Revert', useDocument.getState().original!)
    markCleanIfOriginal()
    expect(dirty()).toBe(true)
  })

  it('a restored session saved earlier: back to its state is clean, its original is not', () => {
    loadDocument(doc('x'), { fileName: 'x.json', original: doc('orig') })
    rename('y')
    undo()
    expect(dirty()).toBe(false)
    replaceDoc('Revert', useDocument.getState().original!)
    markCleanIfOriginal()
    expect(dirty()).toBe(true)
  })
})
