/**
 * Preview backgrounds of the artboard. They are a viewing aid only (never written to the file).
 */
import { normalizeHex } from '@/lib/color'
import type { CanvasBackground } from '@/store/prefs'

export const BACKGROUNDS: readonly CanvasBackground[] = ['checker', 'dark', 'light', 'custom']

/** Fixed preview colors (independent of the UI theme, so colors are judged consistently). */
export const DARK_BACKGROUND = '#1b1c1f'
export const LIGHT_BACKGROUND = '#ffffff'

/** checker → dark → light → custom → checker (⇧B). */
export function nextBackground(current: CanvasBackground): CanvasBackground {
  const index = BACKGROUNDS.indexOf(current)
  return BACKGROUNDS[(index + 1) % BACKGROUNDS.length]
}

/** Solid color of a background mode, or null for the checkerboard. */
export function backgroundColor(mode: CanvasBackground, custom: string): string | null {
  switch (mode) {
    case 'dark':
      return DARK_BACKGROUND
    case 'light':
      return LIGHT_BACKGROUND
    case 'custom':
      return normalizeHex(custom) ?? LIGHT_BACKGROUND
    default:
      return null
  }
}
