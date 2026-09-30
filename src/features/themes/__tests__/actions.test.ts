import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { extractColorUsages } from '@/lottie/colors'
import { base64ToBytes, createDotLottieContainer, readDotLottie } from '@/lottie/dotlottie'
import { MULTI_THEMES } from '@/lottie/__tests__/fixtures/themes/fixtures'
import { findSlot, readThemeRules } from '@/lottie/slots'
import type { Animation } from '@/lottie/types'
import { loadDocument, redo, undo, useDocument } from '@/store/document'
import {
  createTheme,
  duplicateTheme,
  makeThemeColor,
  removeTheme,
  removeThemeColor,
  renameThemeColor,
  renameThemeTo,
  resetThemeValue,
  selectTheme,
  setDefaultColor,
  setStartingTheme,
  setThemeColor,
} from '../actions'
import { installPackageHistory, resetPackageHistory } from '../history'
import { initialThemeId, listThemes, packageOf } from '../model'
import { getActiveThemeRules, previewDocument } from '../preview'
import { getSelectedThemeId, useThemesUi } from '../store'

const uninstall = installPackageHistory()
afterAll(uninstall)
const settle = () => Promise.resolve()
const rgba = (r: number, g: number, b: number) => ({ r, g, b, a: 1 })

const doc = () => useDocument.getState().doc!
const pkg = () => packageOf(useDocument.getState().meta?.dotLottie)
const labels = () => useDocument.getState().past.map((e) => e.label)

function fillLayer(nm: string, color: number[]): Record<string, unknown> {
  return {
    ty: 4,
    nm,
    ind: 1,
    ip: 0,
    op: 60,
    st: 0,
    ks: { o: { a: 0, k: 100 }, p: { a: 0, k: [50, 50] } },
    shapes: [
      { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] }, r: { a: 0, k: 0 } },
      { ty: 'fl', c: { a: 0, k: color }, o: { a: 0, k: 100 } },
    ],
  }
}

function sample(): Animation {
  return {
    v: '5.12.2',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    nm: 'Sample',
    layers: [
      fillLayer('A', [1, 0, 0, 1]),
      fillLayer('B', [1, 0, 0, 1]),
      fillLayer('C', [0, 0, 1, 1]),
    ],
  } as unknown as Animation
}

beforeEach(() => {
  resetPackageHistory()
  useThemesUi.setState({ docId: null, themeId: null, renamingSlot: null, renamingTheme: null })
  loadDocument(sample(), { fileName: 'sample.json' })
})

const red = () => extractColorUsages(doc()).filter((u) => u.hex === '#ff0000')

describe('theme colors', () => {
  it('makes a theme color (one step) and asks for its name', () => {
    expect(makeThemeColor(red(), false)).toBe('color_1')
    expect(labels()).toEqual(['Make theme color'])
    expect(findSlot(doc(), 'color_1')?.refs).toHaveLength(2)
    expect(useThemesUi.getState().renamingSlot).toBe('color_1')
    expect(makeThemeColor([], false)).toBeNull()
  })

  it('renames a theme color together with its rules in every theme', async () => {
    makeThemeColor(red(), false)
    const dark = createTheme('Dark')!
    setThemeColor(dark, 'color_1', rgba(0, 0, 0))
    renameThemeColor('color_1', 'brand')
    expect(findSlot(doc(), 'brand')).toBeDefined()
    expect(listThemes(pkg())[0].rules.map((r) => r.id)).toEqual(['brand'])
    expect(labels().at(-1)).toBe('Rename theme color')
    undo()
    await settle()
    expect(findSlot(doc(), 'color_1')).toBeDefined()
    expect(listThemes(pkg())[0].rules.map((r) => r.id)).toEqual(['color_1'])
  })

  it('removes a theme color: colors stay, rules go (one step)', async () => {
    makeThemeColor(red(), false)
    const dark = createTheme('Dark')!
    setThemeColor(dark, 'color_1', rgba(0, 0, 0))
    removeThemeColor('color_1')
    expect(findSlot(doc(), 'color_1')).toBeUndefined()
    expect(doc().slots).toBeUndefined()
    expect(extractColorUsages(doc()).filter((u) => u.hex === '#ff0000')).toHaveLength(2)
    expect(listThemes(pkg())[0].rules).toEqual([])
    undo()
    await settle()
    expect(findSlot(doc(), 'color_1')).toBeDefined()
    expect(listThemes(pkg())[0].rules).toHaveLength(1)
  })

  it('edits the default value in the document', () => {
    makeThemeColor(red(), false)
    setDefaultColor('color_1', rgba(0, 1, 0), { key: 'drag', final: false })
    setDefaultColor('color_1', rgba(0, 0.5, 0), { key: 'drag', final: true })
    expect(labels()).toEqual(['Make theme color', 'Change theme color'])
    expect(extractColorUsages(doc()).filter((u) => u.hex === '#008000')).toHaveLength(2)
  })
})

describe('themes', () => {
  it('creates a package for a JSON document with the first theme', async () => {
    makeThemeColor(red(), false)
    expect(pkg()).toBeNull()
    const id = createTheme('Dark')
    expect(id).toBe('dark')
    expect(pkg()?.activeId).toBe('sample')
    expect(getSelectedThemeId()).toBe('dark')
    undo()
    await settle()
    expect(pkg()).toBeNull()
    redo()
    await settle()
    expect(listThemes(pkg()).map((t) => t.id)).toEqual(['dark'])
  })

  it('sets, resets and previews theme values', () => {
    makeThemeColor(red(), false)
    const dark = createTheme('Dark')!
    setThemeColor(dark, 'color_1', rgba(0, 0, 1), { key: 'pick', final: false })
    setThemeColor(dark, 'color_1', rgba(0, 0, 0.5), { key: 'pick', final: true })
    expect(labels()).toEqual(['Make theme color', 'New theme', 'Change theme value'])
    const rules = getActiveThemeRules()
    expect(rules).toEqual([{ id: 'color_1', type: 'Color', value: [0, 0, 0.502] }])
    // The canvas shows the themed copy; the document keeps its colors.
    const shown = previewDocument(doc())
    expect(shown).not.toBe(doc())
    expect(shown.slots?.color_1.p).toEqual({ a: 0, k: [0, 0, 0.502] })
    expect(previewDocument(doc())).toBe(shown)
    selectTheme(null)
    expect(previewDocument(doc())).toBe(doc())
    // Reset writes the default value: the theme stays complete.
    resetThemeValue(dark, 'color_1')
    expect(listThemes(pkg())[0].rules).toEqual([{ id: 'color_1', type: 'Color', value: [1, 0, 0] }])
  })

  it('keeps themes complete: new themes copy Default, new colors join every theme', async () => {
    makeThemeColor(red(), false)
    const dark = createTheme('Dark')!
    expect(listThemes(pkg())[0].rules).toEqual([{ id: 'color_1', type: 'Color', value: [1, 0, 0] }])
    setThemeColor(dark, 'color_1', rgba(0, 0, 0))
    const blue = extractColorUsages(doc()).filter((u) => u.hex === '#0000ff')
    expect(makeThemeColor(blue, false)).toBe('color_2')
    expect(listThemes(pkg())[0].rules).toEqual([
      { id: 'color_1', type: 'Color', value: [0, 0, 0] },
      { id: 'color_2', type: 'Color', value: [0, 0, 1] },
    ])
    // Binding and filling the themes is one step.
    expect(labels().at(-1)).toBe('Make theme color')
    undo()
    await settle()
    expect(findSlot(doc(), 'color_2')).toBeUndefined()
    expect(listThemes(pkg())[0].rules.map((r) => r.id)).toEqual(['color_1'])
  })

  it('renames, duplicates, starts with and deletes themes', async () => {
    makeThemeColor(red(), false)
    const dark = createTheme('Dark')!
    setThemeColor(dark, 'color_1', rgba(0, 0, 0))
    renameThemeTo(dark, 'Night')
    const copy = duplicateTheme(dark)!
    expect(listThemes(pkg()).map((t) => [t.id, t.name])).toEqual([
      ['dark', 'Night'],
      ['night_copy', 'Night copy'],
    ])
    expect(readThemeRules(pkg()!.themes[1].data)).toHaveLength(1)
    expect(getSelectedThemeId()).toBe(copy)
    setStartingTheme(dark)
    expect(initialThemeId(pkg())).toBe('dark')
    removeTheme(dark)
    expect(initialThemeId(pkg())).toBeNull()
    expect(listThemes(pkg()).map((t) => t.id)).toEqual(['night_copy'])
    undo()
    await settle()
    expect(initialThemeId(pkg())).toBe('dark')
  })

  it('edits the themes of a real .lottie package', () => {
    const file = readDotLottie(base64ToBytes(MULTI_THEMES))
    loadDocument(file.animations[0].data, {
      fileName: 'multi_themes.lottie',
      format: 'lottie',
      dotLottie: createDotLottieContainer(file),
    })
    selectTheme('dark')
    expect(getActiveThemeRules()?.map((r) => r.id)).toEqual(['bg_color', 'check_color'])
    setThemeColor('dark', 'bg_color', rgba(1, 1, 0))
    expect(listThemes(pkg())[0].rules[0]).toEqual({
      id: 'bg_color',
      type: 'Color',
      value: [1, 1, 0],
    })
    // The other five themes are untouched objects.
    const before = createDotLottieContainer(file).themes
    expect(
      pkg()!
        .themes.slice(1)
        .map((t) => t.data),
    ).toEqual(before.slice(1).map((t) => t.data))
  })
})
