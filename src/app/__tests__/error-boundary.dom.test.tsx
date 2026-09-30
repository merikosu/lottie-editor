// @vitest-environment jsdom
/**
 * A crashed panel shows its fallback, and renders again by itself on the next document or
 * selection change (or with "Try again").
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animation } from '@/lottie/types'
import { closeDocument, loadDocument, selectNodes, useDocument } from '@/store/document'
import { isChunkLoadError } from '../chunk-error'
import { ErrorBoundary } from '../ErrorBoundary'

const doc: Animation = {
  v: '5.7.0',
  fr: 30,
  ip: 0,
  op: 30,
  w: 100,
  h: 100,
  layers: [],
} as unknown as Animation

/** Throws while the first layer is selected (like a panel failing on one particular node). */
function Panel() {
  const selected = useDocument((s) => s.selection.nodes.length > 0)
  if (selected) throw new Error('cannot render this node')
  return <div>panel ok</div>
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  loadDocument(doc, { fileName: 'a.json' })
})

afterEach(() => {
  cleanup()
  closeDocument()
})

/** A lazily loaded part of the app whose file is gone. */
function Missing(): never {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/Workspace-x.js')
}

const e = (message: string, name = 'TypeError') => Object.assign(new Error(message), { name })

describe('ErrorBoundary', () => {
  it('shows the fallback, then recovers on the next selection change', () => {
    render(
      <ErrorBoundary name="test">
        <Panel />
      </ErrorBoundary>,
    )
    expect(screen.getByText('panel ok')).toBeTruthy()
    act(() => selectNodes([['layers', 0]]))
    expect(screen.queryByText('panel ok')).toBeNull()
    expect(screen.getByText('Try again')).toBeTruthy()
    act(() => selectNodes([]))
    expect(screen.getByText('panel ok')).toBeTruthy()
  })

  it('recovers with "Try again" once the cause is gone', () => {
    let broken = true
    function Flaky() {
      if (broken) throw new Error('not yet')
      return <div>flaky ok</div>
    }
    render(
      <ErrorBoundary name="test" compact>
        <Flaky />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Try again')).toBeTruthy()
    broken = false
    act(() => fireEvent.click(screen.getByText('Try again')))
    expect(screen.getByText('flaky ok')).toBeTruthy()
  })

  it('offers a reload when a part of the app could not be loaded', () => {
    render(
      <ErrorBoundary name="test">
        <Missing />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Reload')).toBeTruthy()
    expect(screen.queryByText('Try again')).toBeNull()
  })
})

describe('isChunkLoadError', () => {
  it('recognizes failed module loads in every browser', () => {
    expect(isChunkLoadError(e('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(
      true,
    )
    expect(isChunkLoadError(e('error loading dynamically imported module: https://x/a.js'))).toBe(
      true,
    )
    expect(isChunkLoadError(e('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(e('Unable to preload CSS for /assets/a.css', 'Error'))).toBe(true)
    expect(isChunkLoadError(e('boom', 'ChunkLoadError'))).toBe(true)
    expect(isChunkLoadError(e("Cannot read properties of undefined (reading 'x')"))).toBe(false)
  })
})
