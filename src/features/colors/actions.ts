/**
 * Document edits and UI actions of the colors feature (usable outside React: commands,
 * menus, drag handlers). Every edit is one `updateDoc` step with a translated label.
 */
import { layout } from '@/app/layout'
import { toast } from '@/components/ui'
import { getT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import type { RGBA } from '@/lib/color'
import { emit } from '@/lib/events'
import {
  adjustColors,
  extractColorUsages,
  isUsageModified,
  readUsageColor,
  replaceColor,
  restoreColors,
  revertUsages,
  type ColorAdjustment,
  type ColorGroup,
  type ColorUsage,
} from '@/lottie/colors'
import { pathKey, shapeParentPath, type NodePath } from '@/lottie/path'
import { getDoc, selectNodes, updateDoc, useDocument } from '@/store/document'
import { setPrefs, toggleSection } from '@/store/prefs'
import { setHighlightNodes, useUi } from '@/store/ui'
import { flash, useColorsUi } from './store'

/** Id of the Adjust section (its collapsed state lives in the app preferences). */
export const ADJUST_SECTION_ID = 'colors.adjust'

/** Switches the right sidebar to the Colors tab (expanding the sidebar if needed). */
export function showColorsPanel(): void {
  setPrefs({ rightTab: 'colors' })
  if (layout().isRightCollapsed()) layout().toggleRight()
}

/** Opens the Colors tab with the Adjust section expanded and focused. */
export function focusAdjustSection(): void {
  toggleSection(ADJUST_SECTION_ID, false)
  useColorsUi.setState({ focusAdjust: true })
  showColorsPanel()
}

/** Every color usage of the current document. */
export function documentUsages(): ColorUsage[] {
  const doc = getDoc()
  return doc ? extractColorUsages(doc) : []
}

export interface EditOptions {
  label: string
  /** Gesture key: every update with the same key becomes one undo step. */
  coalesceKey?: string
  /**
   * Gesture state: false while a drag is in progress (its updates stay one undo step however
   * long the pauses), true for its last update. Omitted: updates merge within a short window.
   */
  final?: boolean
  /** Also write the alpha (gradient stops). */
  alpha?: boolean
}

/** Replaces the color of `usages`. Returns false when nothing changed. */
export function replaceUsages(
  usages: readonly ColorUsage[],
  color: RGBA,
  opts: EditOptions,
): boolean {
  if (usages.length === 0) return false
  return updateDoc(
    opts.label,
    (d) => {
      replaceColor(d, usages, color, { alpha: opts.alpha })
    },
    { coalesceKey: opts.coalesceKey, final: opts.final },
  )
}

/** Merges one color into another (drag and drop). */
export function mergeUsages(from: readonly ColorUsage[], into: RGBA): boolean {
  return replaceUsages(from, into, { label: getT().colors.history.merge })
}

/** Exchanges two colors (Alt + drag and drop): one undo step. */
export function swapUsages(
  a: readonly ColorUsage[],
  colorA: RGBA,
  b: readonly ColorUsage[],
  colorB: RGBA,
): boolean {
  if (a.length === 0 || b.length === 0) return false
  return updateDoc(getT().colors.history.swap, (d) => {
    // Both writes use the usages read before the edit, so the order does not matter.
    replaceColor(d, a, colorB)
    replaceColor(d, b, colorA)
  })
}

/**
 * Replaces every similar color of merged groups with the group's color (one undo step), e.g. to
 * clean up the near-duplicates that After Effects exports.
 */
export function unifyGroups(
  groups: readonly Pick<ColorGroup, 'usages' | 'sample' | 'color'>[],
): boolean {
  const doc = getDoc()
  if (!doc || groups.length === 0) return false
  return updateDoc(getT().colors.history.unify, (d) => {
    for (const g of groups) replaceColor(d, g.usages, readUsageColor(doc, g.sample) ?? g.color)
  })
}

/** Gives the usages back the exact values they had when they were read (cancels an edit). */
export function revertEdit(
  usages: readonly ColorUsage[],
  label: string,
  coalesceKey?: string,
): boolean {
  if (usages.length === 0) return false
  return updateDoc(
    label,
    (d) => {
      revertUsages(d, usages)
    },
    { coalesceKey },
  )
}

/** Adjusts `usages` from the colors they had when they were read (one undo step per gesture). */
export function adjustUsages(
  usages: readonly ColorUsage[],
  adjustment: ColorAdjustment,
  label: string,
  gesture?: { key: string; final: boolean },
): boolean {
  if (usages.length === 0) return false
  return updateDoc(
    label,
    (d) => {
      adjustColors(d, usages, adjustment)
    },
    gesture ? { coalesceKey: gesture.key, final: gesture.final } : undefined,
  )
}

export function invertUsages(usages: readonly ColorUsage[]): boolean {
  return adjustUsages(usages, { invert: true }, getT().colors.history.invert)
}

export function grayscaleUsages(usages: readonly ColorUsage[]): boolean {
  return adjustUsages(usages, { grayscale: true }, getT().colors.history.grayscale)
}

/** Writes back the colors the usages had when the document was opened. */
export function resetUsages(usages: readonly ColorUsage[]): boolean {
  const { original } = useDocument.getState()
  if (!original || usages.length === 0) return false
  return updateDoc(getT().colors.history.reset, (d) => {
    restoreColors(d, usages, original)
  })
}

/** True if any of the usages differs from the document as it was opened. */
export function hasModifiedUsages(usages: readonly ColorUsage[]): boolean {
  const { doc, original } = useDocument.getState()
  if (!doc || !original || doc === original) return false
  return usages.some((u) => isUsageModified(doc, u, original))
}

function uniquePaths(paths: NodePath[]): NodePath[] {
  const seen = new Set<string>()
  return paths.filter((p) => {
    const key = pathKey(p)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Selects the layers that contain the usages. */
export function selectLayersOf(usages: readonly { layerPath: NodePath }[]): void {
  selectNodes(uniquePaths(usages.map((u) => u.layerPath)))
}

/** Selects the node that holds a usage (shape item or layer) and reveals it in the tree. */
export function selectUsageNode(usage: { nodePath: NodePath }): void {
  selectNodes([usage.nodePath])
  emit('reveal-node', { path: usage.nodePath })
}

export function revealInJson(path: NodePath): void {
  emit('reveal-code', { path })
}

/**
 * What a color paints, for highlighting on the canvas: the group (or layer) that contains the
 * fill/stroke item, or the layer for text, solid, effect and style colors.
 */
export function paintedNodes(
  usages: readonly { nodePath: NodePath; layerPath: NodePath }[],
): NodePath[] {
  return uniquePaths(
    usages.map((u) =>
      u.nodePath.length > u.layerPath.length ? shapeParentPath(u.nodePath) : u.layerPath,
    ),
  )
}

export function highlightUsages(
  usages: readonly { nodePath: NodePath; layerPath: NodePath }[],
): void {
  setHighlightNodes(paintedNodes(usages))
}

export function clearHighlight(): void {
  if (useUi.getState().highlightNodes.length > 0) setHighlightNodes([])
}

/** Copies text and confirms it quietly in the colors UI (errors get a toast). */
export async function copyWithFlash(text: string, confirmation: string): Promise<void> {
  const ok = await copyText(text)
  if (ok) flash(confirmation)
  else toast.error(getT().colors.flash.copyFailed)
}
