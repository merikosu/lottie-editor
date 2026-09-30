/**
 * Persisted user preferences (localStorage). Anything that should survive a reload and
 * is not part of the document goes here.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { detectLanguage, type Language } from '@/i18n/detect'

export type ThemePref = 'dark' | 'light' | 'system'
export type RendererType = 'svg' | 'canvas'
export type CanvasBackground = 'checker' | 'dark' | 'light' | 'custom'
export type LeftTab = 'layers' | 'assets' | 'history'
export type RightTab = 'properties' | 'colors' | 'issues'
export type CenterView = 'canvas' | 'code' | 'split'

export interface Prefs {
  theme: ThemePref
  language: Language
  renderer: RendererType
  canvasBackground: CanvasBackground
  /** Custom canvas background color (hex). */
  canvasColor: string
  /** Show the artboard outline in the viewport. */
  showBounds: boolean
  /** Autosave the current document to the browser (IndexedDB). */
  autosave: boolean
  /**
   * Run After Effects expressions in the preview. Expressions are arbitrary JavaScript
   * (lottie-web uses eval), so this is opt-in.
   */
  runExpressions: boolean
  leftTab: LeftTab
  rightTab: RightTab
  centerView: CenterView
  /** Collapsed state of inspector sections by id. */
  collapsedSections: Record<string, boolean>
  /** Most recently used colors (hex), newest first. */
  recentColors: string[]
}

const defaults: Prefs = {
  theme: 'dark',
  language: detectLanguage(),
  renderer: 'svg',
  canvasBackground: 'checker',
  canvasColor: '#ffffff',
  showBounds: true,
  autosave: true,
  runExpressions: false,
  leftTab: 'layers',
  rightTab: 'properties',
  centerView: 'canvas',
  collapsedSections: {},
  recentColors: [],
}

export const usePrefs = create<Prefs>()(
  persist(() => defaults, {
    name: 'lottie-editor:prefs',
    version: 1,
    merge: (persisted, current) => ({ ...current, ...(persisted as Partial<Prefs>) }),
  }),
)

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)): void {
  usePrefs.setState((s) => (typeof patch === 'function' ? patch(s) : patch))
}

export function toggleSection(id: string, collapsed?: boolean): void {
  usePrefs.setState((s) => ({
    collapsedSections: { ...s.collapsedSections, [id]: collapsed ?? !s.collapsedSections[id] },
  }))
}

export function pushRecentColor(hex: string): void {
  const color = hex.toLowerCase()
  usePrefs.setState((s) => ({
    recentColors: [color, ...s.recentColors.filter((c) => c !== color)].slice(0, 16),
  }))
}
