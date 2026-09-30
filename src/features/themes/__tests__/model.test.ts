import { describe, expect, it } from 'vitest'
import { base64ToBytes, createDotLottieContainer, readDotLottie } from '@/lottie/dotlottie'
import type { DotLottieContainer } from '@/lottie/dotlottie'
import { MULTI_ANIM_THEME, MULTI_THEMES } from '@/lottie/__tests__/fixtures/themes/fixtures'
import { colorRule, readThemeRules } from '@/lottie/slots'
import {
  activeAnimationId,
  addTheme,
  clearRule,
  createPackage,
  deleteTheme,
  dropSlotRules,
  findTheme,
  initialThemeId,
  isThemeNameTaken,
  listThemes,
  moveTheme,
  packageOf,
  renameSlotRules,
  renameTheme,
  resolvePackageImage,
  rulesOf,
  setInitialTheme,
  setRule,
  slotUsedElsewhere,
  themeIdFor,
} from '../model'

const rgba = (r: number, g: number, b: number) => ({ r, g, b, a: 1 })

function multiThemes(): DotLottieContainer {
  return createDotLottieContainer(readDotLottie(base64ToBytes(MULTI_THEMES)))
}

/** Package with two animations that both bind slot `color` (the edited one is `circle`). */
function multiAnim(): DotLottieContainer {
  return createDotLottieContainer(readDotLottie(base64ToBytes(MULTI_ANIM_THEME)), 'circle')
}

describe('packages', () => {
  it('creates a minimal package for JSON documents', () => {
    const pkg = createPackage('Hero banner.json')
    expect(pkg).toEqual({
      kind: 'dotlottie',
      version: 1,
      manifest: null,
      activeId: 'Hero banner',
      animations: [{ id: 'Hero banner', meta: {} }],
      themes: [],
      stateMachines: [],
      extraFiles: {},
    })
    expect(packageOf(pkg)).toBe(pkg)
    expect(packageOf({ kind: 'tgs' })).toBeNull()
    expect(activeAnimationId(pkg)).toBe('Hero banner')
    expect(activeAnimationId(null)).toBeNull()
  })

  it('lists the themes of a real package, cached by identity', () => {
    const pkg = multiThemes()
    const themes = listThemes(pkg)
    expect(themes.map((t) => [t.id, t.name, t.rules.length])).toEqual([
      ['dark', 'dark', 2],
      ['sky', 'sky', 2],
      ['light', 'light', 2],
      ['animated_light', 'animated_light', 2],
      ['animated_dark', 'animated_dark', 2],
      ['animated_sky', 'animated_sky', 2],
    ])
    expect(listThemes(pkg)).toBe(themes)
    expect(rulesOf(pkg.themes[0].data)).toBe(themes[0].rules)
    expect(findTheme(pkg, 'sky')?.id).toBe('sky')
    expect(findTheme(pkg, 'nope')).toBeNull()
    expect(findTheme(pkg, null)).toBeNull()
  })
})

describe('themes', () => {
  it('derives code-friendly, unique ids from names', () => {
    const pkg = multiThemes()
    expect(themeIdFor(pkg, 'Brand colors')).toBe('brand_colors')
    expect(themeIdFor(pkg, 'Dark')).toBe('dark_2')
    expect(themeIdFor(pkg, 'Тёмная')).toBe('temnaya')
    expect(themeIdFor(pkg, '***')).toBe('theme')
  })

  it('adds, renames, moves and deletes themes without changing the input', () => {
    const pkg = createPackage('a.json')
    const { pkg: one, id } = addTheme(pkg, '  Dark  ')
    expect(id).toBe('dark')
    expect(one.themes).toEqual([{ id: 'dark', name: 'Dark', data: { rules: [] } }])
    expect(pkg.themes).toEqual([])
    const withRule = setRule(one, 'dark', colorRule('bg', rgba(0, 0, 0)))
    const { pkg: two, id: copy } = addTheme(withRule, 'Dark copy', 'dark')
    expect(copy).toBe('dark_copy')
    expect(readThemeRules(two.themes[1].data)).toEqual([
      { id: 'bg', type: 'Color', value: [0, 0, 0] },
    ])
    // The copy owns its data.
    expect(two.themes[1].data).not.toBe(two.themes[0].data)
    expect(isThemeNameTaken(two, 'dark')).toBe(true)
    expect(isThemeNameTaken(two, 'DARK', 'dark')).toBe(false)

    const renamed = renameTheme(two, 'dark', 'Night')
    expect(listThemes(renamed).map((t) => [t.id, t.name])).toEqual([
      ['dark', 'Night'],
      ['dark_copy', 'Dark copy'],
    ])
    expect(renameTheme(renamed, 'dark', 'Night')).toBe(renamed)
    expect(renameTheme(renamed, 'dark', '   ')).toBe(renamed)
    expect(moveTheme(renamed, 'dark', 1).themes.map((t) => t.id)).toEqual(['dark_copy', 'dark'])
    expect(moveTheme(renamed, 'nope', 0)).toBe(renamed)
    expect(deleteTheme(renamed, 'dark').themes.map((t) => t.id)).toEqual(['dark_copy'])
    expect(deleteTheme(renamed, 'nope')).toBe(renamed)
  })

  it('keeps per-animation theme lists and the starting theme consistent', () => {
    const pkg = createPackage('a.json')
    pkg.animations[0].meta = { themes: [] }
    const { pkg: withDark } = addTheme(pkg, 'Dark')
    expect(withDark.animations[0].meta.themes).toEqual(['dark'])
    const started = setInitialTheme(withDark, 'dark')
    expect(initialThemeId(started)).toBe('dark')
    expect(started.animations[0].meta.initialTheme).toBe('dark')
    expect(setInitialTheme(started, 'dark')).toBe(started)
    expect(setInitialTheme(started, 'missing')).toBe(started)
    const deleted = deleteTheme(started, 'dark')
    expect(deleted.animations[0].meta).toEqual({ themes: [] })
    expect(initialThemeId(deleted)).toBeNull()
    expect(setInitialTheme(started, null).animations[0].meta).toEqual({ themes: ['dark'] })
  })
})

describe('rules', () => {
  it('sets and clears the value of a slot in one theme', () => {
    const pkg = multiThemes()
    const next = setRule(pkg, 'dark', colorRule('bg_color', rgba(1, 0, 0)))
    expect(readThemeRules(next.themes[0].data)[0]).toEqual({
      id: 'bg_color',
      type: 'Color',
      value: [1, 0, 0],
    })
    // Other themes are the same objects.
    expect(next.themes[1]).toBe(pkg.themes[1])
    const cleared = clearRule(next, 'dark', 'bg_color')
    expect(readThemeRules(cleared.themes[0].data).map((r) => r.id)).toEqual(['check_color'])
    expect(clearRule(cleared, 'dark', 'bg_color')).toBe(cleared)
  })

  it('renames and drops slot rules in every theme', () => {
    const pkg = multiThemes()
    const renamed = renameSlotRules(pkg, 'bg_color', 'background')
    for (const theme of listThemes(renamed))
      expect(theme.rules.map((r) => r.id)).toEqual(['background', 'check_color'])
    const dropped = dropSlotRules(renamed, 'background')
    for (const theme of listThemes(dropped))
      expect(theme.rules.map((r) => r.id)).toEqual(['check_color'])
  })

  it('keeps rules other animations of the package still use', () => {
    const pkg = multiAnim()
    expect(slotUsedElsewhere(pkg, 'color')).toBe(true)
    expect(slotUsedElsewhere(pkg, 'nothing')).toBe(false)
    expect(slotUsedElsewhere(null, 'color')).toBe(false)
    expect(dropSlotRules(pkg, 'color')).toBe(pkg)
    const renamed = renameSlotRules(pkg, 'color', 'fill')
    for (const theme of listThemes(renamed))
      expect(theme.rules.map((r) => r.id)).toEqual(['color', 'fill'])
  })

  it('resolves package images named by Image rules', () => {
    const pkg = createPackage('a.json')
    const png = base64ToBytes(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    )
    pkg.extraFiles = { 'i/logo_dark.png': png }
    expect(resolvePackageImage(pkg, 'logo_dark.png')).toMatch(/^data:image\/png;base64,/)
    expect(resolvePackageImage(pkg, 'missing.png')).toBeUndefined()
    expect(resolvePackageImage(null, 'logo_dark.png')).toBeUndefined()
  })
})
