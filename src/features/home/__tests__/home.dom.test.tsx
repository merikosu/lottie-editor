// @vitest-environment jsdom
/**
 * The home page in the DOM: service cards turn into drop zones while animation files are dragged
 * (the one under the pointer, else the editor, is the target) and a drop on a card opens the files
 * in that service; the open animation offers to continue editing.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animation } from '@/lottie/types'

const openInService = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../actions', () => ({
  openInService,
  optimizeDocument: vi.fn(async () => {}),
  optimizeRecent: vi.fn(async () => {}),
  optimizeSample: vi.fn(async () => {}),
}))

vi.mock('@/features/io', async () => {
  const store = await import('@/features/io/store')
  const format = await import('@/features/io/format')
  const { TruncatedText } = await import('@/features/io/TruncatedText')
  const { StartPage } = await import('@/features/io/StartPage')
  return {
    ...store,
    ...format,
    TruncatedText,
    StartPage,
    refreshOpenThumbnail: () => {},
    IO_DIALOG: { newDocument: 'new-document' },
    collectFiles: (dt: { files: File[] }) => Promise.resolve(Array.from(dt.files)),
    pickFiles: vi.fn(),
    showOpenUrl: vi.fn(),
    openRecent: vi.fn(),
    openSample: vi.fn(),
    RecentSection: () => null,
    SamplesSection: () => null,
    useFreshRecents: () => {},
    useStartupSettled: () => true,
  }
})

const { TooltipProvider } = await import('@/components/ui')
const { currentRoute, navigate } = await import('@/app/router')
const { useIo } = await import('@/features/io/store')
const { closeDocument, loadDocument } = await import('@/store/document')
const { setPrefs } = await import('@/store/prefs')
const { HomePage } = await import('../HomePage')

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})

const anim = (): Animation => ({
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 512,
  h: 256,
  nm: 'A',
  layers: [],
})

function files(...names: string[]) {
  const list = names.map((n) => new File(['{}'], n, { type: 'application/json' }))
  return { types: ['Files'], files: list, items: list.map((f) => ({ kind: 'file', type: f.type })) }
}

const card = (route: string) => screen.getByTestId(`service-${route}`)
const stateOf = (route: string) => card(route).getAttribute('data-state')

function renderHome() {
  return render(
    <TooltipProvider>
      <HomePage />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  setPrefs({ language: 'en' })
  closeDocument()
  navigate('home', { replace: true })
  useIo.setState({ drag: null, startup: 'done', recents: [] })
  openInService.mockClear()
})

afterEach(cleanup)

describe('service cards', () => {
  it('shows the three services with their main actions', () => {
    renderHome()
    for (const route of ['edit', 'customize', 'optimize']) expect(stateOf(route)).toBe('idle')
    expect(screen.getByTestId('home-open-edit').textContent).toContain('Open file')
    expect(screen.getByTestId('home-open-customize').textContent).toContain('Choose a Lottie')
    expect(screen.getByTestId('home-open-optimize').textContent).toContain('Optimize files')
  })

  it('turns into drop zones while animation files are dragged, the editor by default', () => {
    renderHome()
    act(() => useIo.setState({ drag: 'open' }))
    expect(stateOf('edit')).toBe('target')
    expect(stateOf('customize')).toBe('zone')
    expect(stateOf('optimize')).toBe('zone')
    expect(screen.getByTestId('service-customize-drop').textContent).toContain('Drop to customize')
  })

  it('follows the pointer, including back out of the cards', () => {
    renderHome()
    act(() => useIo.setState({ drag: 'open' }))
    fireEvent.dragOver(card('optimize'), { dataTransfer: files('a.json') })
    expect(stateOf('optimize')).toBe('target')
    expect(stateOf('edit')).toBe('zone')
    fireEvent.dragOver(screen.getByTestId('home'), { dataTransfer: files('a.json') })
    expect(stateOf('edit')).toBe('target')
  })

  it('opens files dropped on a card in that service', async () => {
    renderHome()
    act(() => useIo.setState({ drag: 'open' }))
    const dt = files('a.json', 'b.json')
    fireEvent.dragOver(card('customize'), { dataTransfer: dt })
    const dropped = fireEvent.drop(card('customize'), { dataTransfer: dt })
    // Handled: the window-wide drop handler leaves it alone.
    expect(dropped).toBe(false)
    await act(async () => {})
    expect(openInService).toHaveBeenCalledWith('customize', dt.files)
  })

  it('leaves image drags and drops outside the cards to the window-wide handler', async () => {
    renderHome()
    act(() => useIo.setState({ drag: 'images' }))
    expect(stateOf('edit')).toBe('idle')
    expect(fireEvent.drop(card('edit'), { dataTransfer: files('a.png') })).toBe(true)
    act(() => useIo.setState({ drag: 'open' }))
    expect(fireEvent.drop(screen.getByTestId('home'), { dataTransfer: files('a.json') })).toBe(true)
    await act(async () => {})
    expect(openInService).not.toHaveBeenCalled()
  })

  it('says which document a drop replaces', () => {
    loadDocument(anim(), { fileName: 'hero.json' })
    renderHome()
    act(() => useIo.setState({ drag: 'open' }))
    expect(screen.getByTestId('service-edit-drop').textContent).toContain('Replaces “hero.json”')
    expect(screen.getByTestId('service-optimize-drop').textContent).not.toContain('hero.json')
  })
})

describe('open animation', () => {
  it('is only shown while an animation is open', () => {
    renderHome()
    expect(screen.queryByTestId('home-current')).toBeNull()
  })

  it('shows the animation and continues editing it', () => {
    loadDocument(anim(), { fileName: 'hero.json' })
    renderHome()
    const bar = screen.getByTestId('home-current')
    expect(bar.textContent).toContain('hero.json')
    expect(bar.textContent).toContain('512 × 256')
    fireEvent.click(screen.getByTestId('home-continue'))
    expect(currentRoute()).toBe('edit')
  })
})
