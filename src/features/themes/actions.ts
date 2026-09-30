/**
 * Edits of the themes feature, usable outside React (commands, menus, the Colors panel). Every
 * edit is one undo step with a translated label: theme colors (slots) are document edits, theme
 * values live in the dotLottie package (see history.ts).
 */
import { layout } from '@/app/layout'
import { runCommand } from '@/commands/registry'
import type { ChangeGesture } from '@/components/ui'
import { getT } from '@/i18n'
import type { RGBA } from '@/lib/color'
import { copyText } from '@/lib/clipboard'
import type { ColorUsage } from '@/lottie/colors'
import type { DotLottieContainer } from '@/lottie/dotlottie'
import {
  bindColorSlot,
  colorRule,
  defaultRule,
  findSlot,
  listSlots,
  nextColorSlotId,
  removeSlot,
  renameSlot,
  scalarRule,
  setSlotColor,
  setSlotStaticValue,
  vectorRule,
  type BindResult,
} from '@/lottie/slots'
import { clearSelection, getDoc, selectNodes, updateDoc, useDocument } from '@/store/document'
import { setPrefs, toggleSection } from '@/store/prefs'
import { setHighlightNodes, useUi } from '@/store/ui'
import { commitDocAndPackage, commitPackage } from './history'
import {
  addTheme,
  canHoldThemes,
  clearRule,
  createPackage,
  deleteTheme,
  dropSlotRules,
  fillRules,
  findTheme,
  packageOf,
  renameSlotRules,
  renameTheme,
  setInitialTheme,
  setRule,
} from './model'
import { getSelectedThemeId, requestReveal, setThemesUi } from './store'

/** Id of the Themes section (its collapsed state lives in the app preferences). */
export const THEMES_SECTION_ID = 'themes'

/** The package of the open document (null for documents without one). */
export function currentPackage(): DotLottieContainer | null {
  return packageOf(useDocument.getState().meta?.dotLottie)
}

/** The package, or a new one for a document that has none (JSON documents). */
function packageForEdit(): DotLottieContainer | null {
  const meta = useDocument.getState().meta
  if (!meta || !canHoldThemes(meta.dotLottie)) return null
  return packageOf(meta.dotLottie) ?? createPackage(meta.fileName)
}

function gestureOptions(gesture?: ChangeGesture) {
  return gesture ? { coalesceKey: gesture.key, final: gesture.final } : {}
}

/* -------------------------------------------------------------------------- */
/*                                Theme colors                                */
/* -------------------------------------------------------------------------- */

/**
 * Makes the static color properties among `usages` one theme color (a new slot named
 * `color_<n>`, renamed right away in the Themes section). Returns its id, or null when none of
 * the usages can be bound.
 */
export function makeThemeColor(usages: readonly ColorUsage[], reveal = true): string | null {
  const doc = getDoc()
  if (!doc || usages.length === 0) return null
  const id = nextColorSlotId(doc)
  let result: BindResult | null = null
  commitDocAndPackage(
    getT().themes.history.makeColor,
    (d) => {
      result = bindColorSlot(d, usages, id)
    },
    (before) => {
      // Existing themes get the new color's value: every theme stays complete.
      const pkg = packageOf(before)
      const slot = findSlot(getDoc() ?? doc, id)
      return result && pkg && slot ? fillRules(pkg, [slot]) : before
    },
  )
  if (!result) return null
  setThemesUi({ renamingSlot: id })
  if (reveal) revealThemesSection()
  return id
}

/** Renames a theme color (its `sid`s, its dictionary entry and its rules in every theme). */
export function renameThemeColor(from: string, to: string): boolean {
  const done = commitDocAndPackage(
    getT().themes.history.renameColor,
    (d) => {
      renameSlot(d, from, to)
    },
    (before) => {
      const pkg = packageOf(before)
      return pkg ? renameSlotRules(pkg, from, to) : before
    },
  )
  if (done) setThemesUi({ renamingSlot: null })
  return done
}

/** Turns a theme color back into plain colors (nothing changes on screen) and drops its rules. */
export function removeThemeColor(id: string): boolean {
  return commitDocAndPackage(
    getT().themes.history.removeColor,
    (d) => {
      removeSlot(d, id)
    },
    (before) => {
      const pkg = packageOf(before)
      return pkg ? dropSlotRules(pkg, id) : before
    },
  )
}

/** Sets the default (the document's) value of a color slot. */
export function setDefaultColor(id: string, color: RGBA, gesture?: ChangeGesture): boolean {
  return updateDoc(
    getT().themes.history.editDefault,
    (d) => {
      setSlotColor(d, id, color)
    },
    gestureOptions(gesture),
  )
}

/** Sets the default value of a number, vector or position slot. */
export function setDefaultValue(
  id: string,
  value: number | number[],
  gesture?: ChangeGesture,
): boolean {
  return updateDoc(
    getT().themes.history.editDefault,
    (d) => {
      setSlotStaticValue(d, id, value)
    },
    gestureOptions(gesture),
  )
}

/** Selects the layers that use a theme color. */
export function selectSlotLayers(id: string): void {
  const doc = getDoc()
  const slot = doc ? findSlot(doc, id) : undefined
  if (!slot) return
  const seen = new Set<string>()
  const layers = []
  for (const ref of slot.refs) {
    if (!ref.layerPath) continue
    const key = ref.layerPath.join('/')
    if (seen.has(key)) continue
    seen.add(key)
    layers.push(ref.layerPath)
  }
  if (layers.length) selectNodes(layers)
}

/** Highlights on the canvas what a theme color paints (null clears the highlight). */
export function highlightSlot(id: string | null): void {
  const doc = getDoc()
  const slot = id && doc ? findSlot(doc, id) : undefined
  if (!slot) {
    if (useUi.getState().highlightNodes.length > 0) setHighlightNodes([])
    return
  }
  const seen = new Set<string>()
  const nodes = []
  for (const ref of slot.refs) {
    // The group (or layer) that holds the fill/stroke is what it paints.
    const node =
      ref.nodePath && ref.layerPath && ref.nodePath.length > ref.layerPath.length
        ? ref.nodePath.slice(0, -2)
        : ref.layerPath
    if (!node) continue
    const key = node.join('/')
    if (seen.has(key)) continue
    seen.add(key)
    nodes.push(node)
  }
  setHighlightNodes(nodes)
}

/* -------------------------------------------------------------------------- */
/*                                   Themes                                   */
/* -------------------------------------------------------------------------- */

/** Shows (and edits) a theme in the section and on the canvas; null shows Default. */
export function selectTheme(id: string | null): void {
  setThemesUi({ themeId: id, renamingTheme: null })
}

/** Adds a theme (a copy of `copyOf`, or empty) and selects it. Returns its id. */
export function createTheme(name: string, copyOf?: string): string | null {
  const pkg = packageForEdit()
  const clean = name.trim()
  if (!pkg || !clean) return null
  const { pkg: added, id } = addTheme(pkg, clean, copyOf)
  // A new theme starts as a copy of Default: a rule for every slot (see `fillRules`).
  const doc = getDoc()
  const next = copyOf || !doc ? added : fillRules(added, listSlots(doc), id)
  const label = copyOf ? getT().themes.history.duplicateTheme : getT().themes.history.newTheme
  if (!commitPackage(label, next)) return null
  setThemesUi({ themeId: id, renamingTheme: null })
  return id
}

export function renameThemeTo(id: string, name: string): boolean {
  const pkg = currentPackage()
  if (!pkg) return false
  setThemesUi({ renamingTheme: null })
  return commitPackage(getT().themes.history.renameTheme, renameTheme(pkg, id, name))
}

/** Duplicates a theme ("Dark" → "Dark copy") and selects the copy. */
export function duplicateTheme(id: string): string | null {
  const theme = findTheme(currentPackage(), id)
  if (!theme) return null
  return createTheme(getT().themes.copyName(theme.name), id)
}

export function removeTheme(id: string): boolean {
  const pkg = currentPackage()
  if (!pkg) return false
  const done = commitPackage(getT().themes.history.deleteTheme, deleteTheme(pkg, id))
  if (done && getSelectedThemeId() === id) selectTheme(null)
  return done
}

/** Makes a theme (null: none) the one players start with. */
export function setStartingTheme(id: string | null): boolean {
  const pkg = currentPackage()
  if (!pkg) return false
  return commitPackage(getT().themes.history.initialTheme, setInitialTheme(pkg, id))
}

/** Sets the color a theme gives a slot. */
export function setThemeColor(
  themeId: string,
  slotId: string,
  color: RGBA,
  gesture?: ChangeGesture,
): boolean {
  const pkg = currentPackage()
  if (!pkg) return false
  return commitPackage(
    getT().themes.history.editTheme,
    setRule(pkg, themeId, colorRule(slotId, color)),
    gestureOptions(gesture),
  )
}

/** Sets the number (Scalar) or vector (Vector/Position) a theme gives a slot. */
export function setThemeValue(
  themeId: string,
  slotId: string,
  value: number | number[],
  type: 'Scalar' | 'Vector' | 'Position',
  gesture?: ChangeGesture,
): boolean {
  const pkg = currentPackage()
  if (!pkg) return false
  const rule =
    type === 'Scalar' && typeof value === 'number'
      ? scalarRule(slotId, value)
      : vectorRule(
          slotId,
          typeof value === 'number' ? [value, value] : value,
          type === 'Position' ? 'Position' : 'Vector',
        )
  return commitPackage(
    getT().themes.history.editTheme,
    setRule(pkg, themeId, rule),
    gestureOptions(gesture),
  )
}

/**
 * Gives a slot its default value in a theme. The rule stays (with the default value) so the
 * theme remains complete; slots whose value cannot be written as a rule lose their rule.
 */
export function resetThemeValue(themeId: string, slotId: string): boolean {
  const pkg = currentPackage()
  const doc = getDoc()
  const slot = doc ? findSlot(doc, slotId) : undefined
  if (!pkg || !slot) return false
  const rule = defaultRule(slot)
  const next = rule ? setRule(pkg, themeId, rule) : clearRule(pkg, themeId, slotId)
  return commitPackage(getT().themes.history.resetValue, next)
}

/* -------------------------------------------------------------------------- */
/*                                 Navigation                                 */
/* -------------------------------------------------------------------------- */

/**
 * Shows the Themes section: the Properties tab with nothing selected (the document view), the
 * section expanded and scrolled into view.
 */
export function revealThemesSection(): void {
  setPrefs({ rightTab: 'properties' })
  if (layout().isRightCollapsed()) layout().toggleRight()
  if (useDocument.getState().selection.nodes.length > 0) clearSelection()
  toggleSection(THEMES_SECTION_ID, false)
  requestReveal()
}

/** Opens the export dialog on dotLottie, the format that keeps themes. */
export function exportWithThemes(): void {
  runCommand('export.dotlottie')
}

/** Copies text; failures get a toast from the caller's feedback. */
export async function copyId(id: string): Promise<boolean> {
  return copyText(id)
}
