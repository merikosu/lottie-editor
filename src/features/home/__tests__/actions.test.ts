// @vitest-environment jsdom
/**
 * Where the home page sends files: the editor or Customize through io's openFiles (with the page
 * to show), the optimizer through the file handlers once its page is showing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animation } from '@/lottie/types'

const io = vi.hoisted(() => ({
  openFiles: vi.fn(async (_files: File[], _opts?: { route?: string }) => true),
  explainUnhandledFiles: vi.fn(async () => true),
  buildDownload: vi.fn(() => ({
    blob: new Blob(['{}'], { type: 'application/json' }),
    fileName: 'doc.json',
  })),
  readDocument: vi.fn(async (): Promise<unknown> => null),
  notifyError: vi.fn(),
  describeOpenError: vi.fn(() => ({ title: 'error', lines: [] })),
}))
vi.mock('@/features/io', () => io)

const dispatched: File[][] = []
vi.mock('@/commands/files', () => ({
  dispatchFiles: vi.fn(async (files: File[]) => {
    dispatched.push(files)
    return true
  }),
}))

const { currentRoute, navigate } = await import('@/app/router')
const { registerCommands } = await import('@/commands/registry')
const { closeDocument, loadDocument } = await import('@/store/document')
const actions = await import('../actions')

const anim = (): Animation => ({
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 100,
  h: 100,
  nm: 'A',
  layers: [],
})
const json = (name = 'a.json') => new File(['{}'], name, { type: 'application/json' })
const png = (name = 'logo.png') =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
  dispatched.length = 0
  closeDocument()
  navigate('home', { replace: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openIn', () => {
  it('opens animation files through io with the page to show them on', async () => {
    const files = [json()]
    await actions.openIn('customize', files)
    expect(io.openFiles).toHaveBeenCalledWith(files, { route: 'customize' })
    expect(io.explainUnhandledFiles).not.toHaveBeenCalled()
  })

  it('hands images to the open animation on the chosen page', async () => {
    io.openFiles.mockResolvedValueOnce(false)
    loadDocument(anim(), { fileName: 'a.json' })
    const files = [png()]
    await actions.openIn('edit', files)
    expect(currentRoute()).toBe('edit')
    expect(dispatched).toEqual([files])
  })

  it('explains files nobody can open', async () => {
    io.openFiles.mockResolvedValueOnce(false)
    const files = [png()]
    await actions.openIn('edit', files)
    expect(io.explainUnhandledFiles).toHaveBeenCalledWith(files)
    expect(currentRoute()).toBe('home')
    expect(dispatched).toEqual([])
  })
})

describe('sendToOptimizer', () => {
  it('shows the optimizer first, then dispatches the files to the handlers', async () => {
    const files = [json(), json('b.json')]
    const pending = actions.sendToOptimizer(files)
    // The page switch happens right away; the files follow once the page is up.
    expect(currentRoute()).toBe('optimize')
    expect(dispatched).toEqual([])
    await pending
    expect(dispatched).toEqual([files])
  })

  it('routes service cards by service', async () => {
    await actions.openInService('optimize', [json()])
    expect(currentRoute()).toBe('optimize')
    await actions.openInService('edit', [json()])
    expect(io.openFiles).toHaveBeenLastCalledWith([expect.any(File)], { route: 'edit' })
  })
})

describe('optimizing the open animation', () => {
  it("uses the optimizer's own command when it is registered", async () => {
    loadDocument(anim(), { fileName: 'a.json' })
    const run = vi.fn()
    const unregister = registerCommands([
      { id: 'anim.optimize', title: () => 'Optimize', category: 'animation', run },
    ])
    expect(actions.canOptimizeDocument()).toBe(true)
    await actions.optimizeDocument()
    expect(run).toHaveBeenCalledOnce()
    expect(dispatched).toEqual([])
    unregister()
  })

  it('falls back to handing the document over as a file', async () => {
    loadDocument(anim(), { fileName: 'a.json' })
    expect(actions.canOptimizeDocument()).toBe(false)
    await actions.optimizeDocument()
    expect(currentRoute()).toBe('optimize')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0][0].name).toBe('doc.json')
  })

  it('reports a recent file that is no longer stored', async () => {
    await actions.optimizeRecent({
      id: 'gone',
      fileName: 'gone.json',
      format: 'json',
      width: 1,
      height: 1,
      fps: 30,
      frames: 1,
      openedAt: 0,
      edited: false,
    })
    expect(io.notifyError).toHaveBeenCalled()
    expect(dispatched).toEqual([])
  })
})
