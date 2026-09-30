// @vitest-environment jsdom
/**
 * DOM tests of the command palette and the History panel (rendered with Testing Library).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { navigate, useRouter } from '@/app/router'
import { registerCommands } from '@/commands/registry'
import { TooltipProvider } from '@/components/ui'
import { isMac } from '@/lib/platform'
import type { Animation } from '@/lottie/types'
import { closeDocument, loadDocument, undo, updateDoc, useDocument } from '@/store/document'
import { usePlayback } from '@/store/playback'
import { setPrefs } from '@/store/prefs'
import { setCommandPaletteOpen, useUi } from '@/store/ui'
import { CommandPalette } from '../CommandPalette'
import { HistoryPanel } from '../HistoryPanel'
import { usePaletteRecent } from '../palette/recent'

function noop(): void {}

beforeAll(() => {
  // jsdom lacks these; cmdk and the virtualized list need them.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= noop
})

const layer = (nm: string) => ({
  nm,
  ty: 4,
  ip: 0,
  op: 60,
  st: 0,
  ks: { o: { a: 0, k: 100 } },
  shapes: [],
})

function sampleDoc(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [layer('Ball'), layer('Shadow')],
  } as unknown as Animation
}

const flushTimers = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300))
  })
}

beforeEach(() => {
  setPrefs({ language: 'en' })
  usePaletteRecent.setState({ ids: [] })
  loadDocument(sampleDoc(), { fileName: 'sample.json' })
})

afterEach(() => {
  cleanup()
  setCommandPaletteOpen(false)
  closeDocument()
  useRouter.setState({ hashRoute: null })
})

/** Waits for the palette to close and run the action, and for page switches (two frames). */
const settle = async () => {
  await flushTimers()
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
}

const mod = isMac ? { metaKey: true } : { ctrlKey: true }

describe('CommandPalette', () => {
  it('runs the chosen command after closing and remembers it', async () => {
    const run = vi.fn()
    const unregister = registerCommands([
      { id: 'test.zoomFit', title: () => 'Zoom to fit', category: 'view', run },
      { id: 'test.other', title: () => 'Other thing', category: 'view', run: noop },
    ])
    render(<CommandPalette />, { wrapper: TooltipProvider })
    act(() => setCommandPaletteOpen(true))
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'zoom fit' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useUi.getState().commandPaletteOpen).toBe(false)
    await flushTimers()
    expect(run).toHaveBeenCalledTimes(1)
    expect(usePaletteRecent.getState().ids[0]).toBe('test.zoomFit')
    unregister()
  })

  it('finds layers and goes to a frame', async () => {
    render(<CommandPalette />, { wrapper: TooltipProvider })
    act(() => setCommandPaletteOpen(true))
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'shadow' } })
    expect(screen.getByText('Layers')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    await flushTimers()
    expect(useDocument.getState().selection.nodes).toEqual([['layers', 1]])

    act(() => setCommandPaletteOpen(true))
    const again = await screen.findByRole('combobox')
    fireEvent.change(again, { target: { value: '12' } })
    expect(screen.getByText('Go to frame 12')).toBeTruthy()
    fireEvent.keyDown(again, { key: 'Enter' })
    await flushTimers()
    expect(usePlayback.getState().frame).toBe(12)
  })

  it('opens the editor for a layer chosen on another page', async () => {
    navigate('customize')
    render(<CommandPalette />, { wrapper: TooltipProvider })
    act(() => setCommandPaletteOpen(true))
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'shadow' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle()
    expect(useRouter.getState().hashRoute).toBe('edit')
    expect(useDocument.getState().selection.nodes).toEqual([['layers', 1]])
  })

  it('runs an editor command chosen on the home page in the editor', async () => {
    const run = vi.fn(() => expect(useRouter.getState().hashRoute).toBe('edit'))
    const unregister = registerCommands([
      { id: 'view.zoomFit', title: () => 'Zoom to fit', category: 'view', run },
    ])
    navigate('home')
    render(<CommandPalette />, { wrapper: TooltipProvider })
    act(() => setCommandPaletteOpen(true))
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'zoom to fit' } })
    expect(screen.getByText('In Editor')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle()
    expect(run).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('lists the other services when browsing on the home page', async () => {
    const unregister = registerCommands([
      { id: 'app.home', title: () => 'Home', category: 'view', run: noop },
      { id: 'app.edit', title: () => 'Editor', category: 'view', run: noop },
    ])
    navigate('home')
    render(<CommandPalette />, { wrapper: TooltipProvider })
    act(() => setCommandPaletteOpen(true))
    await screen.findByRole('combobox')
    expect(screen.getByText('Go to')).toBeTruthy()
    expect(screen.getByText('Editor')).toBeTruthy()
    expect(screen.queryByText('Home')).toBeNull()
    unregister()
  })

  it('returns focus to where it was when it closes', async () => {
    render(
      <>
        <button type="button">Before</button>
        <CommandPalette />
      </>,
      { wrapper: TooltipProvider },
    )
    const before = screen.getByText('Before')
    before.focus()
    act(() => setCommandPaletteOpen(true))
    const input = await screen.findByRole('combobox')
    await flushTimers()
    expect(document.activeElement).toBe(input)
    act(() => setCommandPaletteOpen(false))
    await flushTimers()
    expect(document.activeElement).toBe(before)
  })

  it('shows an empty state when nothing matches', async () => {
    render(<CommandPalette />, { wrapper: TooltipProvider })
    act(() => setCommandPaletteOpen(true))
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'qqqzzz' } })
    expect(screen.getByText('No results for “qqqzzz”')).toBeTruthy()
  })
})

describe('HistoryPanel', () => {
  it('shows the opened state and an empty hint for a fresh document', () => {
    render(<HistoryPanel />, { wrapper: TooltipProvider })
    expect(screen.getByText('Opened sample.json')).toBeTruthy()
    expect(screen.getByText('No changes yet')).toBeTruthy()
  })

  it('lists steps, marks the current one and jumps on click', () => {
    render(<HistoryPanel />, { wrapper: TooltipProvider })
    act(() => {
      updateDoc('Rename layer', (d) => {
        d.layers[0].nm = 'Ball 2'
      })
      updateDoc('Change opacity', (d) => {
        ;(d.layers[1].ks.o as { k: number }).k = 50
      })
    })
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent?.replace(/now$/, ''))).toEqual([
      'Opened sample.json',
      'Rename layer',
      'Change opacity',
    ])
    expect(options[2].getAttribute('aria-selected')).toBe('true')
    fireEvent.click(options[0])
    expect(useDocument.getState().past).toHaveLength(0)
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('2 changes · 2 undone')).toBeTruthy()
  })

  it('keeps global shortcuts working while the list has focus', () => {
    const unregister = registerCommands([
      {
        id: 'edit.undo',
        title: () => 'Undo',
        category: 'edit',
        shortcut: 'mod+z',
        run: () => void undo(),
      },
    ])
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    render(<HistoryPanel />, { wrapper: TooltipProvider })
    act(() => {
      updateDoc('One', (d) => {
        d.layers[0].nm = 'A'
      })
      updateDoc('Two', (d) => {
        d.layers[0].nm = 'B'
      })
    })
    const list = screen.getByRole('listbox')
    act(() => {
      fireEvent.keyDown(list, { key: 'z', code: 'KeyZ', ...mod })
    })
    expect(useDocument.getState().past).toHaveLength(1)
    // Handled once: the event does not also reach the window-level shortcut handler.
    expect(onWindow).not.toHaveBeenCalled()
    // Keys without a shortcut keep their normal path.
    fireEvent.keyDown(list, { key: 'q', code: 'KeyQ' })
    expect(onWindow).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', onWindow)
    unregister()
  })

  it('steps through history with the arrow keys', () => {
    render(<HistoryPanel />, { wrapper: TooltipProvider })
    act(() => {
      updateDoc('One', (d) => {
        d.layers[0].nm = 'A'
      })
      updateDoc('Two', (d) => {
        d.layers[0].nm = 'B'
      })
    })
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(useDocument.getState().past).toHaveLength(1)
    fireEvent.keyDown(list, { key: 'Home' })
    expect(useDocument.getState().past).toHaveLength(0)
    fireEvent.keyDown(list, { key: 'End' })
    expect(useDocument.getState().past).toHaveLength(2)
  })
})
