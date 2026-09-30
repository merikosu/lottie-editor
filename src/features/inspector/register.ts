import { SlidersHorizontal, SquareX } from 'lucide-react'
import { layout } from '@/app/layout'
import { registerCommands, type Command } from '@/commands/registry'
import { on } from '@/lib/events'
import { ADDABLE_EFFECTS, EFFECT_DEFS, type AddableEffectKind } from '@/lottie/effects'
import { getAt, isLayerPath, pathKey } from '@/lottie/path'
import type { Layer } from '@/lottie/types'
import { clearSelection, getDoc, isNodeSelected, selectNodes, useDocument } from '@/store/document'
import { setPrefs } from '@/store/prefs'
import { addEffect, canAddEffect, removeAllEffects } from './effects-actions'
import { EFFECT_ICONS } from './sections/effects/icons'
import { requestTextFocus } from './state'

/** Shows the Properties tab (expanding the right panel when it is collapsed). */
function showProperties(): void {
  setPrefs({ rightTab: 'properties' })
  const l = layout()
  if (l.isRightCollapsed()) l.toggleRight()
}

/** Selected layers (effects belong to layers; selected shape items are ignored). */
function selectedLayers() {
  return useDocument.getState().selection.nodes.filter(isLayerPath)
}

/** "Add effect: Drop shadow"… for the command palette and the menus. */
function addEffectCommand(kind: AddableEffectKind): Command {
  return {
    id: `effect.add.${kind}`,
    title: (t) => t.inspector.commands.addEffect(t.inspector.effects.kinds[kind]),
    category: 'layer',
    icon: EFFECT_ICONS[kind],
    keywords: ['effect', 'fx', 'эффект', EFFECT_DEFS[kind].nm.toLowerCase()],
    enabled: () => {
      const doc = getDoc()
      return selectedLayers().some((path) => canAddEffect(doc, path, kind))
    },
    run: () => {
      if (addEffect(selectedLayers(), kind) >= 0) showProperties()
    },
  }
}

/**
 * Registers this feature's commands and dialogs. Called once by the app on startup;
 * returns a cleanup function.
 */
export function register(): () => void {
  const disposers = [
    registerCommands([
      {
        id: 'anim.settings',
        title: (t) => t.inspector.commands.animationSettings,
        category: 'animation',
        icon: SlidersHorizontal,
        keywords: ['document', 'animation', 'properties', 'size', 'fps', 'документ', 'свойства'],
        enabled: () => getDoc() !== null,
        run: () => {
          clearSelection()
          showProperties()
        },
      },
      ...ADDABLE_EFFECTS.map(addEffectCommand),
      {
        id: 'effect.removeAll',
        title: (t) => t.inspector.commands.removeEffects,
        category: 'layer',
        icon: SquareX,
        keywords: ['effects', 'fx', 'clear', 'эффекты', 'удалить'],
        enabled: () => {
          const doc = getDoc()
          return !!doc && selectedLayers().some((p) => (getAt<Layer>(doc, p)?.ef?.length ?? 0) > 0)
        },
        run: () => void removeAllEffects(selectedLayers()),
      },
    ]),
    // Another feature (canvas double-click, layer menu) wants to edit a text layer's content.
    on('edit-text', ({ path }) => {
      if (!getDoc()) return
      if (!isNodeSelected(useDocument.getState().selection, path)) selectNodes([path])
      showProperties()
      requestTextFocus(pathKey(path))
    }),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
