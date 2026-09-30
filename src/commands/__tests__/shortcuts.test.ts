/**
 * Shortcut display: platform notation, keycaps and translated key names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Fresh copies of the shortcut module (and the UI language) for one platform. */
async function load(mac: boolean, language: 'en' | 'ru' = 'en') {
  vi.resetModules()
  vi.doMock('@/lib/platform', () => ({
    isMac: mac,
    hasModKey: () => false,
    isEditableTarget: () => false,
  }))
  const i18n = await import('@/i18n')
  const { usePrefs } = await import('@/store/prefs')
  await i18n.ensureLanguage(language)
  usePrefs.setState({ language })
  return import('../shortcuts')
}

afterEach(() => {
  vi.doUnmock('@/lib/platform')
})

describe('formatShortcut', () => {
  it('uses symbols on macOS', async () => {
    const { formatShortcut } = await load(true)
    expect(formatShortcut('mod+shift+z')).toBe('⇧⌘Z')
    expect(formatShortcut('alt+1')).toBe('⌥1')
    expect(formatShortcut('?')).toBe('?')
  })

  it('uses words elsewhere', async () => {
    const { formatShortcut } = await load(false)
    expect(formatShortcut('mod+shift+z')).toBe('Ctrl+Shift+Z')
    expect(formatShortcut('mod+=')).toBe('Ctrl++')
    expect(formatShortcut('space')).toBe('Space')
  })

  it('translates key names that are words', async () => {
    const { formatShortcut } = await load(false, 'ru')
    expect(formatShortcut('space')).toBe('Пробел')
    expect(formatShortcut('shift+space')).toBe('Shift+Пробел')
    // Keycap labels stay as printed on the keys.
    expect(formatShortcut('escape')).toBe('Esc')
    expect(formatShortcut('mod+z')).toBe('Ctrl+Z')
  })
})

describe('shortcutKeys', () => {
  it('splits into keycaps on macOS', async () => {
    const { shortcutKeys } = await load(true)
    expect(shortcutKeys('mod+alt+n')).toEqual(['⌥', '⌘', 'N'])
    expect(shortcutKeys('shift+?')).toEqual(['?'])
  })

  it('keeps the plus key whole elsewhere', async () => {
    const { shortcutKeys } = await load(false)
    // "Ctrl++" must not become ["Ctrl", "", ""].
    expect(shortcutKeys('mod+=')).toEqual(['Ctrl', '+'])
    expect(shortcutKeys('mod+shift+z')).toEqual(['Ctrl', 'Shift', 'Z'])
    expect(shortcutKeys('ctrl+alt+x')).toEqual(['Ctrl', 'Alt', 'X'])
  })

  it('shows translated key names on keycaps', async () => {
    const { shortcutKeys } = await load(true, 'ru')
    expect(shortcutKeys('space')).toEqual(['Пробел'])
    expect(shortcutKeys('mod+z')).toEqual(['⌘', 'Z'])
  })
})

describe('parseShortcut', () => {
  it('matches physical keys and rejects unknown ones', async () => {
    const { parseShortcut } = await load(false)
    expect(parseShortcut('mod+z')?.codes).toEqual(['KeyZ'])
    expect(parseShortcut('?')).toMatchObject({ shift: true, codes: ['Slash'] })
    expect(parseShortcut('space')).toMatchObject({ codes: ['Space'], named: 'space' })
    expect(parseShortcut('mod+nope')).toBeNull()
  })
})
