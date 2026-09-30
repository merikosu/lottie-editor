// @vitest-environment jsdom
/**
 * Which page shows a newly opened document, and where images go on pages that do not show the
 * open animation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Animation } from '@/lottie/types'

vi.mock('../thumbnail', () => ({ renderThumbnail: async () => null, whenIdle: () => {} }))
const notifyError = vi.hoisted(() => vi.fn())
vi.mock('../notify', () => ({ notifyError, notifyInfo: vi.fn(), notifyWarning: vi.fn() }))

const { currentRoute, navigate } = await import('@/app/router')
const { closeDocument, loadDocument } = await import('@/store/document')
const { revealDocument } = await import('../reveal')
const { routeImageFiles } = await import('../open')

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
const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' })

beforeEach(() => {
  closeDocument()
  navigate('home', { replace: true })
  notifyError.mockClear()
})

describe('revealDocument', () => {
  it('opens the editor from pages that do not show the document', () => {
    revealDocument()
    expect(currentRoute()).toBe('edit')
    navigate('optimize')
    revealDocument()
    expect(currentRoute()).toBe('edit')
  })

  it('stays on pages that show the document', () => {
    navigate('customize')
    revealDocument()
    expect(currentRoute()).toBe('customize')
    navigate('edit')
    revealDocument()
    expect(currentRoute()).toBe('edit')
  })

  it('goes where the action asked', () => {
    revealDocument('customize')
    expect(currentRoute()).toBe('customize')
    revealDocument('edit')
    expect(currentRoute()).toBe('edit')
    expect(location.hash).toBe('#/edit')
  })
})

describe('routeImageFiles', () => {
  it('ignores anything but images', () => {
    navigate('optimize')
    expect(routeImageFiles([new File(['{}'], 'a.json')])).toBe(false)
    expect(routeImageFiles([png(), new File(['{}'], 'a.json')])).toBe(false)
    expect(routeImageFiles([])).toBe(false)
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('explains images dropped on the optimizer page', () => {
    navigate('optimize')
    expect(routeImageFiles([png()])).toBe(true)
    expect(notifyError).toHaveBeenCalledOnce()
    expect(currentRoute()).toBe('optimize')
  })

  it('shows the editor before images are added to the open animation from home', () => {
    loadDocument(anim(), { fileName: 'a.json' })
    navigate('home')
    // Not consumed: the assets feature adds them, now on screen.
    expect(routeImageFiles([png()])).toBe(false)
    expect(currentRoute()).toBe('edit')
  })

  it('leaves images alone without an open animation (they get explained later)', () => {
    expect(routeImageFiles([png()])).toBe(false)
    expect(currentRoute()).toBe('home')
    navigate('customize')
    loadDocument(anim(), { fileName: 'a.json' })
    expect(routeImageFiles([png()])).toBe(false)
    expect(currentRoute()).toBe('customize')
  })
})
