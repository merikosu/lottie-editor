import { describe, expect, it } from 'vitest'
import type { Route } from '@/app/router'
import { GROUP_ORDER, groupOf } from '../../groups'
import {
  ANYWHERE,
  IN_EDITOR,
  ON_DOCUMENT_PAGES,
  browseOrder,
  commandPlacement,
  destinationFor,
  isOffered,
  listedWhenBrowsing,
} from '../placement'

const place = (id: string, category: Parameters<typeof groupOf>[0]['category']) =>
  commandPlacement(id, groupOf({ id, category }))

const ROUTES: Route[] = ['home', 'edit', 'customize', 'optimize']

/** A disabled command (with the reason it is disabled, when known). */
const off = (id: string, reason?: string) => ({ id, enabled: false, reason })

describe('commandPlacement', () => {
  it('runs navigation, opening files, preferences and help anywhere', () => {
    expect(place('app.optimize', 'view')).toEqual(ANYWHERE)
    expect(place('file.open', 'file')).toEqual(ANYWHERE)
    expect(place('file.new', 'file')).toEqual(ANYWHERE)
    expect(place('file.close', 'file')).toEqual(ANYWHERE)
    expect(place('file.clearRecents', 'file')).toEqual(ANYWHERE)
    expect(place('view.theme.toggle', 'view')).toEqual(ANYWHERE)
    expect(place('view.language.ru', 'view')).toEqual(ANYWHERE)
    expect(place('edit.paste', 'edit')).toEqual(ANYWHERE)
    expect(place('help.settings', 'help')).toEqual(ANYWHERE)
  })

  it('lets commands that switch pages themselves run from anywhere', () => {
    expect(place('anim.optimize', 'animation')).toEqual(ANYWHERE)
  })

  it('saves and exports the animation where it is on screen', () => {
    for (const id of ['file.download', 'file.export', 'file.revert', 'file.importAsLayer']) {
      expect(place(id, 'file')).toEqual(ON_DOCUMENT_PAGES)
    }
    expect(place('export.gif', 'file')).toEqual(ON_DOCUMENT_PAGES)
    expect(place('assets.embedMissing', 'file')).toEqual(ON_DOCUMENT_PAGES)
    expect(place('file.downloadAll', 'file')).toEqual(ANYWHERE)
  })

  it('runs document edits and playback where the animation is on screen', () => {
    for (const id of ['edit.undo', 'edit.redo'])
      expect(place(id, 'edit')).toEqual(ON_DOCUMENT_PAGES)
    expect(place('playback.toggle', 'playback')).toEqual(ON_DOCUMENT_PAGES)
    expect(place('anim.speedUp', 'animation')).toEqual(ON_DOCUMENT_PAGES)
    expect(place('colors.invert', 'animation')).toEqual(ON_DOCUMENT_PAGES)
  })

  it('keeps editor panels, canvas, layers, keyframes and JSON in the editor', () => {
    expect(place('anim.colors', 'animation')).toEqual(IN_EDITOR)
    expect(place('anim.addMarker', 'animation')).toEqual(IN_EDITOR)
    expect(place('assets.show', 'view')).toEqual(IN_EDITOR)
    expect(place('assets.removeUnused', 'animation')).toEqual(ON_DOCUMENT_PAGES)
    expect(place('view.zoomFit', 'view')).toEqual(IN_EDITOR)
    expect(place('view.theme.dark.extra', 'view')).toEqual(ANYWHERE)
    expect(place('view.themes', 'view')).toEqual(IN_EDITOR)
    expect(place('layer.rename', 'layer')).toEqual(IN_EDITOR)
    expect(place('keyframes.easyEase', 'edit')).toEqual(IN_EDITOR)
    expect(place('code.format', 'edit')).toEqual(IN_EDITOR)
    expect(place('edit.history', 'edit')).toEqual(IN_EDITOR)
    expect(place('edit.delete', 'edit')).toEqual(IN_EDITOR)
    expect(place('edit.pasteSpecial', 'edit')).toEqual(IN_EDITOR)
  })

  it("runs a service page's own commands on that page", () => {
    expect(place('optimizer.downloadAll', 'file')).toEqual({
      routes: ['optimize'],
      document: false,
    })
    expect(place('customize.replaceLogo', 'layer')).toEqual({
      routes: ['customize'],
      document: false,
    })
  })
})

describe('destinationFor', () => {
  it('runs in place where allowed, otherwise opens the first allowed page', () => {
    for (const route of ROUTES) expect(destinationFor(ANYWHERE, route)).toBeNull()
    expect(destinationFor(IN_EDITOR, 'edit')).toBeNull()
    expect(destinationFor(IN_EDITOR, 'customize')).toBe('edit')
    expect(destinationFor(ON_DOCUMENT_PAGES, 'customize')).toBeNull()
    expect(destinationFor(ON_DOCUMENT_PAGES, 'home')).toBe('edit')
    expect(destinationFor({ routes: ['optimize'], document: false }, 'edit')).toBe('optimize')
  })
})

describe('isOffered', () => {
  it('offers enabled commands', () => {
    expect(isOffered({ id: 'x.y', enabled: true }, null)).toBe(true)
    expect(isOffered({ id: 'x.y', enabled: true }, 'edit')).toBe(true)
  })

  it('offers canvas and timeline zoom from other pages only', () => {
    expect(isOffered(off('view.zoomFit'), 'edit')).toBe(true)
    expect(isOffered(off('timeline.zoomIn'), 'edit')).toBe(true)
    expect(isOffered(off('view.zoomFit'), null)).toBe(false)
    expect(isOffered(off('view.zoomSelection', 'Select a layer first'), 'edit')).toBe(false)
    expect(isOffered(off('code.apply'), 'edit')).toBe(false)
    expect(isOffered(off('view.zoo'), 'edit')).toBe(false)
  })
})

describe('listedWhenBrowsing', () => {
  it('lists only what runs on the page', () => {
    expect(listedWhenBrowsing(IN_EDITOR, 'edit', true)).toBe(true)
    expect(listedWhenBrowsing(IN_EDITOR, 'home', true)).toBe(false)
    expect(listedWhenBrowsing(ON_DOCUMENT_PAGES, 'customize', true)).toBe(true)
    expect(listedWhenBrowsing(ANYWHERE, 'optimize', false)).toBe(true)
  })

  it('leaves out document commands while no animation is open', () => {
    expect(listedWhenBrowsing(IN_EDITOR, 'edit', false)).toBe(false)
    expect(listedWhenBrowsing(ON_DOCUMENT_PAGES, 'customize', false)).toBe(false)
    // A service page's own commands decide for themselves (enabled()).
    expect(listedWhenBrowsing({ routes: ['optimize'], document: false }, 'optimize', false)).toBe(
      true,
    )
  })
})

describe('browseOrder', () => {
  it('lists every section in the editor, the page itself first elsewhere', () => {
    expect(browseOrder('edit', true)).toEqual(GROUP_ORDER)
    expect(browseOrder('customize', true)[0]).toBe('customize')
    expect(browseOrder('optimize', false)[0]).toBe('optimizer')
    expect(browseOrder('home', false)[0]).toBe('services')
  })

  it('keeps help last and never lists editor-only sections outside the editor', () => {
    for (const route of ROUTES) {
      for (const hasDocument of [true, false]) {
        const order = browseOrder(route, hasDocument)
        expect(order.at(-1)).toBe('help')
        expect(new Set(order).size).toBe(order.length)
        if (route !== 'edit' || !hasDocument) {
          for (const g of ['layer', 'keyframes', 'code'] as const) expect(order).not.toContain(g)
        }
      }
    }
  })
})
