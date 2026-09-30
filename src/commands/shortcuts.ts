/**
 * Keyboard shortcut parsing, matching and display.
 *
 * Shortcuts are written like "mod+shift+z", "space", "shift+left", "?".
 * - `mod` is ⌘ on macOS and Ctrl elsewhere.
 * - Keys are matched by physical key (KeyboardEvent.code), so shortcuts work with any
 *   keyboard layout (e.g. Russian): "mod+z" is the key labelled Z on a US keyboard.
 */
import { getT } from '@/i18n'
import { isMac } from '@/lib/platform'

export interface ParsedShortcut {
  mod: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
  /** KeyboardEvent.code values that trigger this shortcut. */
  codes: string[]
  /** Display name of the key (English; see `keyLabel` for the one to show). */
  key: string
  /** Name of a named key ("space", "escape", …), whose label may be translated. */
  named?: string
}

const NAMED: Record<string, { codes: string[]; label: string; macLabel?: string }> = {
  space: { codes: ['Space'], label: 'Space' },
  enter: { codes: ['Enter', 'NumpadEnter'], label: 'Enter', macLabel: '↩' },
  escape: { codes: ['Escape'], label: 'Esc' },
  esc: { codes: ['Escape'], label: 'Esc' },
  tab: { codes: ['Tab'], label: 'Tab', macLabel: '⇥' },
  backspace: { codes: ['Backspace'], label: 'Backspace', macLabel: '⌫' },
  delete: { codes: ['Delete'], label: 'Delete', macLabel: '⌦' },
  up: { codes: ['ArrowUp'], label: '↑' },
  down: { codes: ['ArrowDown'], label: '↓' },
  left: { codes: ['ArrowLeft'], label: '←' },
  right: { codes: ['ArrowRight'], label: '→' },
  home: { codes: ['Home'], label: 'Home', macLabel: '↖' },
  end: { codes: ['End'], label: 'End', macLabel: '↘' },
  pageup: { codes: ['PageUp'], label: 'PgUp' },
  pagedown: { codes: ['PageDown'], label: 'PgDn' },
  ',': { codes: ['Comma'], label: ',' },
  '.': { codes: ['Period'], label: '.' },
  '/': { codes: ['Slash'], label: '/' },
  '\\': { codes: ['Backslash'], label: '\\' },
  '[': { codes: ['BracketLeft'], label: '[' },
  ']': { codes: ['BracketRight'], label: ']' },
  '-': { codes: ['Minus', 'NumpadSubtract'], label: '−' },
  '=': { codes: ['Equal', 'NumpadAdd'], label: '+' },
  '`': { codes: ['Backquote'], label: '`' },
  ';': { codes: ['Semicolon'], label: ';' },
  "'": { codes: ['Quote'], label: "'" },
}

const cache = new Map<string, ParsedShortcut | null>()

export function parseShortcut(input: string): ParsedShortcut | null {
  const cached = cache.get(input)
  if (cached !== undefined) return cached
  const parts = input
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
  // "mod+=" or "shift+=" style: an empty last part means the key was "+"
  let keyPart = parts.pop() ?? ''
  if (keyPart === '' && input.endsWith('+')) keyPart = '='
  const result: ParsedShortcut = {
    mod: false,
    shift: false,
    alt: false,
    ctrl: false,
    codes: [],
    key: '',
  }
  for (const p of parts) {
    if (p === 'mod') result.mod = true
    else if (p === 'shift') result.shift = true
    else if (p === 'alt' || p === 'option') result.alt = true
    else if (p === 'ctrl') result.ctrl = true
  }
  if (keyPart === '?') {
    result.shift = true
    keyPart = '/'
    result.codes = ['Slash']
    result.key = '?'
  } else if (/^[a-z]$/.test(keyPart)) {
    result.codes = [`Key${keyPart.toUpperCase()}`]
    result.key = keyPart.toUpperCase()
  } else if (/^[0-9]$/.test(keyPart)) {
    result.codes = [`Digit${keyPart}`, `Numpad${keyPart}`]
    result.key = keyPart
  } else if (/^f([1-9]|1[0-2])$/.test(keyPart)) {
    result.codes = [keyPart.toUpperCase()]
    result.key = keyPart.toUpperCase()
  } else if (NAMED[keyPart]) {
    const named = NAMED[keyPart]
    result.codes = named.codes
    result.key = isMac && named.macLabel ? named.macLabel : named.label
    result.named = keyPart
  } else {
    cache.set(input, null)
    return null
  }
  cache.set(input, result)
  return result
}

/** True if the keyboard event matches the shortcut exactly (no extra modifiers). */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const s = parseShortcut(shortcut)
  if (!s || !s.codes.includes(e.code)) return false
  const modPressed = isMac ? e.metaKey : e.ctrlKey
  const ctrlPressed = isMac ? e.ctrlKey : false
  if (modPressed !== s.mod) return false
  if (isMac && ctrlPressed !== s.ctrl) return false
  if (!isMac && s.ctrl && !e.ctrlKey) return false
  if (e.altKey !== s.alt) return false
  if (e.shiftKey !== s.shift) return false
  return true
}

/**
 * The key's label in the UI language: key names that are words in some languages (Space →
 * "Пробел") are translated; symbols and the names printed on keycaps (Esc, Enter) are not.
 */
export function keyLabel(s: ParsedShortcut): string {
  if (!s.named) return s.key
  const labels: Record<string, string | undefined> = getT().common.keys
  return labels[s.named] ?? s.key
}

/** Human-readable shortcut: "⇧⌘Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
export function formatShortcut(shortcut: string): string {
  const s = parseShortcut(shortcut)
  if (!s) return shortcut
  const key = keyLabel(s)
  if (isMac) {
    return `${s.ctrl ? '⌃' : ''}${s.alt ? '⌥' : ''}${s.shift && s.key !== '?' ? '⇧' : ''}${s.mod ? '⌘' : ''}${key}`
  }
  const parts: string[] = []
  if (s.mod || s.ctrl) parts.push('Ctrl')
  if (s.alt) parts.push('Alt')
  if (s.shift && s.key !== '?') parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** Splits a formatted shortcut into keycaps for <Kbd> rendering. */
export function shortcutKeys(shortcut: string): string[] {
  const s = parseShortcut(shortcut)
  if (!s) return [shortcut]
  const keys: string[] = []
  if (isMac) {
    if (s.ctrl) keys.push('⌃')
    if (s.alt) keys.push('⌥')
    if (s.shift && s.key !== '?') keys.push('⇧')
    if (s.mod) keys.push('⌘')
  } else {
    if (s.mod || s.ctrl) keys.push('Ctrl')
    if (s.alt) keys.push('Alt')
    if (s.shift && s.key !== '?') keys.push('Shift')
  }
  // Built from the parts: splitting the formatted text would break the "+" key itself.
  keys.push(keyLabel(s))
  return keys
}
