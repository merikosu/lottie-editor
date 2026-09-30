// @vitest-environment jsdom
/**
 * The page-wide drop overlay: shown while files are dragged over the window, out of the way
 * while a drop target of the page itself (one that keeps its dragover events) is under the
 * pointer, and back when the pointer leaves that target.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRouter } from '@/app/router'
import { FileDropOverlay } from '../FileDropOverlay'

// Reading dropped files pulls in the open pipeline (and lottie-web, which needs a canvas).
vi.mock('../dropFiles', () => ({ collectFiles: async () => [] }))

/** A file drag event (jsdom has no DataTransfer). */
function dragEvent(type: string): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'dataTransfer', {
    value: {
      types: ['Files'],
      items: [{ kind: 'file', type: 'application/json' }],
      files: [],
      dropEffect: 'none',
    },
  })
  return e
}

let target: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  // The editor (on the home page the service cards take animation drops instead).
  useRouter.setState({ hashRoute: 'edit' })
  target = document.createElement('div')
  // Like an image asset row: it takes the drop itself and keeps its dragovers.
  target.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  document.body.appendChild(target)
})

afterEach(() => {
  cleanup()
  target.remove()
  vi.useRealTimers()
})

const overlay = () => screen.queryByTestId('drop-overlay')

describe('FileDropOverlay', () => {
  it('steps aside while a drop target of the page is under the pointer', () => {
    render(<FileDropOverlay />)
    act(() => {
      document.body.dispatchEvent(dragEvent('dragenter'))
      document.body.dispatchEvent(dragEvent('dragover'))
      vi.advanceTimersByTime(1)
    })
    expect(overlay()).not.toBeNull()

    act(() => {
      target.dispatchEvent(dragEvent('dragenter'))
      target.dispatchEvent(dragEvent('dragover'))
      vi.advanceTimersByTime(1)
    })
    expect(overlay()).toBeNull()

    // Held over the target longer than the stale timeout: the drag is still alive.
    act(() => {
      for (let i = 0; i < 30; i++) {
        target.dispatchEvent(dragEvent('dragover'))
        vi.advanceTimersByTime(100)
      }
    })
    act(() => {
      document.body.dispatchEvent(dragEvent('dragover'))
      vi.advanceTimersByTime(1)
    })
    expect(overlay()).not.toBeNull()
  })

  it('hides when the drag leaves the window', () => {
    render(<FileDropOverlay />)
    act(() => {
      document.body.dispatchEvent(dragEvent('dragenter'))
      document.body.dispatchEvent(dragEvent('dragover'))
      vi.advanceTimersByTime(1)
    })
    expect(overlay()).not.toBeNull()
    act(() => {
      document.body.dispatchEvent(dragEvent('dragleave'))
    })
    expect(overlay()).toBeNull()
  })
})
