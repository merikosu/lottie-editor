/**
 * Theme preview: the theme selected in the Themes section is shown on the canvas without
 * touching the document. The viewport (owned by another feature) consumes it through these
 * functions — see the integration notes in the feature's `index.ts`.
 */
import { useSyncExternalStore } from 'react'
import { applyTheme, type ThemeRule } from '@/lottie/slots'
import type { Animation } from '@/lottie/types'
import { useDocument } from '@/store/document'
import { activeAnimationId, findTheme, packageOf, resolvePackageImage } from './model'
import { getSelectedThemeId, useThemesUi } from './store'

/**
 * Rules of the theme shown on the canvas, or null for the document's own values. The array keeps
 * its identity while the theme's data does not change.
 */
export function getActiveThemeRules(): ThemeRule[] | null {
  const id = getSelectedThemeId()
  if (!id) return null
  const pkg = packageOf(useDocument.getState().meta?.dotLottie)
  return findTheme(pkg, id)?.rules ?? null
}

/** Name of the theme shown on the canvas (null for Default). */
export function getActiveThemeName(): string | null {
  const id = getSelectedThemeId()
  if (!id) return null
  return findTheme(packageOf(useDocument.getState().meta?.dotLottie), id)?.name ?? null
}

/** Calls `listener` after anything the preview depends on may have changed. */
function subscribeToThemeState(listener: () => void): () => void {
  const offUi = useThemesUi.subscribe(listener)
  const offDoc = useDocument.subscribe((s, prev) => {
    if (s.meta !== prev.meta) listener()
  })
  return () => {
    offUi()
    offDoc()
  }
}

/**
 * Calls `listener` whenever the previewed rules change (another theme, an edited value, undo,
 * another document). Returns the unsubscribe function.
 */
export function subscribeActiveThemeRules(
  listener: (rules: ThemeRule[] | null) => void,
): () => void {
  let last = getActiveThemeRules()
  return subscribeToThemeState(() => {
    const next = getActiveThemeRules()
    if (next === last) return
    last = next
    listener(next)
  })
}

/** React hook: rules of the theme shown on the canvas (null: Default). */
export function useActiveThemeRules(): ThemeRule[] | null {
  return useSyncExternalStore(subscribeToThemeState, getActiveThemeRules, () => null)
}

/** React hook: name of the theme shown on the canvas (null: Default). */
export function useActiveThemeName(): string | null {
  return useSyncExternalStore(subscribeToThemeState, getActiveThemeName, () => null)
}

/**
 * The document as the canvas should show it: `doc` itself, or a themed copy while a theme is
 * previewed. The copy shares every unchanged subtree with `doc` and keeps its identity while
 * neither changes, so passing it to the player on every render causes no reload.
 */
export function previewDocument(doc: Animation): Animation {
  const rules = getActiveThemeRules()
  if (!rules) return doc
  const pkg = packageOf(useDocument.getState().meta?.dotLottie)
  return applyTheme(doc, rules, activeAnimationId(pkg), {
    resolveImage: (src) => resolvePackageImage(pkg, src),
  })
}
