/**
 * React access to the document's colors: the shared scan, the colors in the panel's scope and
 * their palette groups. Everything is derived from the document identity, so edits elsewhere
 * only rescan the layers they touched (see `scanColors`).
 */
import { useDeferredValue, useMemo } from 'react'
import {
  groupColors,
  groupGradients,
  isInScope,
  isScanCached,
  scanColors,
  selectionScope,
  type ColorGroup,
  type ColorScan,
  type ColorUsage,
  type GradientGroup,
  type GradientUsage,
} from '@/lottie/colors'
import { useDocument } from '@/store/document'
import { useColorsPrefs, type ColorScope } from './store'

const EMPTY_SCAN: ColorScan = { colors: [], gradients: [] }

/**
 * Every color and gradient of the current document. Updates are derived from a deferred copy
 * (see below); the first render scans synchronously so the colors never flash in empty.
 */
export function useColorScan(): ColorScan {
  const doc = useDeferredValue(useDocument((s) => s.doc))
  return doc ? scanColors(doc) : EMPTY_SCAN
}

export interface ScopedColors {
  /** Effective scope ("selection" only while something is selected). */
  scope: ColorScope
  hasSelection: boolean
  colors: ColorUsage[]
  gradients: GradientUsage[]
  /** The document has changed and the lists are being recomputed in the background. */
  pending: boolean
}

/**
 * Colors and gradients in the panel's scope. Derived from a deferred copy of the document so
 * that scanning a huge file never blocks input: React computes it in an interruptible
 * background render and keeps showing the previous lists meanwhile.
 */
export function useScopedColors(): ScopedColors {
  const latest = useDocument((s) => s.doc)
  // A scan that is already cached (the document was shown before) renders at once; only a
  // first scan starts in the background.
  const doc = useDeferredValue(latest, latest && isScanCached(latest) ? latest : null)
  const nodes = useDocument((s) => s.selection.nodes)
  const requested = useColorsPrefs((s) => s.scope)
  const hasSelection = nodes.length > 0
  const scope: ColorScope = requested === 'selection' && hasSelection ? 'selection' : 'document'
  const pending = doc !== latest
  const scoped = useMemo(() => {
    const scan = doc ? scanColors(doc) : EMPTY_SCAN
    if (scope === 'document' || !doc) return { colors: scan.colors, gradients: scan.gradients }
    const prefixes = selectionScope(doc, nodes)
    return {
      colors: scan.colors.filter((u) => isInScope(u.path, prefixes)),
      gradients: scan.gradients.filter((g) => isInScope(g.path, prefixes)),
    }
  }, [doc, nodes, scope])
  return { scope, hasSelection, pending, ...scoped }
}

/**
 * The same usages (by id) in the current document. Lists may be a render behind the store
 * (deferred rendering, frozen rows); edits must start from the latest values.
 */
export function latestUsages(usages: readonly ColorUsage[]): ColorUsage[] {
  const doc = useDocument.getState().doc
  if (!doc || usages.length === 0) return []
  const current = scanColors(doc).colors
  const byId = new Map(current.map((u) => [u.id, u]))
  const out: ColorUsage[] = []
  for (const u of usages) {
    const found = byId.get(u.id)
    if (found) out.push(found)
  }
  return out
}

/**
 * Usages in scope right now, read from the stores (for event handlers that must not rely on
 * a render that may be one edit behind).
 */
export function scopedUsagesNow(scope: ColorScope): ColorUsage[] {
  const { doc, selection } = useDocument.getState()
  if (!doc) return []
  const colors = scanColors(doc).colors
  if (scope === 'document' || selection.nodes.length === 0) return colors
  const prefixes = selectionScope(doc, selection.nodes)
  return colors.filter((u) => isInScope(u.path, prefixes))
}

export interface PaletteGroups {
  colorGroups: ColorGroup[]
  gradientGroups: GradientGroup[]
}

/** Palette groups of the given usages with the panel's sort and "merge similar" settings. */
export function usePaletteGroups(colors: ColorUsage[], gradients: GradientUsage[]): PaletteGroups {
  const sortBy = useColorsPrefs((s) => s.sortBy)
  const merge = useColorsPrefs((s) => s.mergeSimilar)
  const tolerance = useColorsPrefs((s) => s.tolerance)
  const colorGroups = useMemo(
    () => groupColors(colors, { sortBy, mergeSimilar: merge ? tolerance : 0 }),
    [colors, sortBy, merge, tolerance],
  )
  const gradientGroups = useMemo(() => groupGradients(gradients, { sortBy }), [gradients, sortBy])
  return { colorGroups, gradientGroups }
}
