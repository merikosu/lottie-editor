/**
 * Effect edits issued by the inspector and by commands. Every function is ONE undo step.
 *
 * Structural edits (add, delete, move, duplicate) shift effect indices, so selected keyframes
 * and the focused property inside the layer's effects are remapped to the effect's new
 * position (or dropped with a deleted effect) instead of pointing at a neighbour.
 *
 * No React here: `register.ts` (loaded at startup) uses these for the command palette.
 */
import { getT } from '@/i18n'
import {
  applyEffectFix,
  canHaveEffects,
  createEffect,
  duplicateEffect,
  effectContext,
  effectIndexMaps,
  insertEffect,
  moveEffect,
  remapEffectPath,
  removeEffect,
  renameEffect,
  resetEffect,
  setEffectEnabled,
  uniqueEffectName,
  type AddableEffectKind,
  type EffectFix,
} from '@/lottie/effects'
import { getAt, isLayerPath, type NodePath } from '@/lottie/path'
import type { Animation, Layer } from '@/lottie/types'
import { getDoc, pruneSelection, updateDoc, useDocument, type Selection } from '@/store/document'
import { requestEffectReveal } from './state'

type IndexMap = (index: number) => number | null

/** Selection after a structural edit of one layer's effects. */
function remapSelection(layerPath: NodePath, map: IndexMap): (doc: Animation) => Selection {
  const sel = useDocument.getState().selection
  return (doc) => {
    const keyframes = sel.keyframes.flatMap((k) => {
      const path = remapEffectPath(k.path, layerPath, map)
      return path ? [path === k.path ? k : { ...k, path }] : []
    })
    const property = sel.property ? remapEffectPath(sel.property, layerPath, map) : null
    return pruneSelection(doc, { nodes: sel.nodes, keyframes, property })
  }
}

function layerIn(draft: unknown, layerPath: NodePath): Layer | null {
  const layer = getAt<Layer>(draft, layerPath)
  return layer && typeof layer === 'object' ? layer : null
}

/** True when the layer at `path` can take an effect of this kind (Stroke needs masks). */
export function canAddEffect(
  doc: Animation | null,
  path: NodePath,
  kind: AddableEffectKind,
): boolean {
  if (!doc || !isLayerPath(path)) return false
  const layer = getAt<Layer>(doc, path)
  if (!canHaveEffects(layer)) return false
  return kind !== 'stroke' || (layer?.masksProperties?.length ?? 0) > 0
}

/**
 * Adds an effect of `kind` at the end of each layer's effects (one undo step) and returns the
 * index it got in the last layer, or -1. The new effect opens in the inspector.
 */
export function addEffect(layerPaths: readonly NodePath[], kind: AddableEffectKind): number {
  const doc = getDoc()
  const targets = layerPaths.filter((p) => canAddEffect(doc, p, kind))
  if (targets.length === 0) return -1
  const t = getT()
  let index = -1
  updateDoc(t.inspector.history.addEffect, (draft) => {
    for (const path of targets) {
      const layer = layerIn(draft, path)
      if (!layer) continue
      const effects = Array.isArray(layer.ef) ? layer.ef : []
      const effect = createEffect(kind, {
        name: uniqueEffectName(effects, t.inspector.effects.defaultNames[kind]),
        ix: effects.length + 1,
        context: effectContext(draft as Animation, path),
      })
      index = insertEffect(layer, effect)
    }
  })
  if (index >= 0) requestEffectReveal(targets[targets.length - 1], index)
  return index
}

/** Deletes the effect at `index`. */
export function removeEffectAt(layerPath: NodePath, index: number): boolean {
  return updateDoc(
    getT().inspector.history.removeEffect,
    (draft) => {
      const layer = layerIn(draft, layerPath)
      if (layer) removeEffect(layer, index)
    },
    { selection: remapSelection(layerPath, effectIndexMaps.remove(index)) },
  )
}

/** Deletes every effect of the layers (selection inside them is dropped). */
export function removeAllEffects(layerPaths: readonly NodePath[]): boolean {
  const sel = useDocument.getState().selection
  const inside = (path: NodePath) =>
    layerPaths.some(
      (lp) =>
        path.length > lp.length && path[lp.length] === 'ef' && lp.every((s, i) => path[i] === s),
    )
  return updateDoc(
    getT().inspector.history.removeEffects,
    (draft) => {
      for (const path of layerPaths) {
        const layer = layerIn(draft, path)
        if (layer && 'ef' in layer) delete layer.ef
      }
    },
    {
      selection: (doc) =>
        pruneSelection(doc, {
          nodes: sel.nodes,
          keyframes: sel.keyframes.filter((k) => !inside(k.path)),
          property: sel.property && inside(sel.property) ? null : sel.property,
        }),
    },
  )
}

/** Inserts a copy after the effect (named like After Effects: "Drop Shadow 2"). */
export function duplicateEffectAt(layerPath: NodePath, index: number): number {
  let at = -1
  updateDoc(
    getT().inspector.history.duplicateEffect,
    (draft) => {
      const layer = layerIn(draft, layerPath)
      if (layer) at = duplicateEffect(layer, index)
    },
    { selection: remapSelection(layerPath, effectIndexMaps.insert(index + 1)) },
  )
  if (at >= 0) requestEffectReveal(layerPath, at)
  return at
}

/** Moves an effect to position `to` (its index after the move). */
export function moveEffectTo(layerPath: NodePath, from: number, to: number): boolean {
  if (from === to) return false
  return updateDoc(
    getT().inspector.history.moveEffect,
    (draft) => {
      const layer = layerIn(draft, layerPath)
      if (layer) moveEffect(layer, from, to)
    },
    { selection: remapSelection(layerPath, effectIndexMaps.move(from, to)) },
  )
}

export function renameEffectAt(layerPath: NodePath, index: number, name: string): boolean {
  return updateDoc(getT().inspector.history.renameEffect, (draft) => {
    const layer = layerIn(draft, layerPath)
    if (layer) renameEffect(layer, index, name)
  })
}

/** Resets a known effect's parameters to their defaults (values become static). */
export function resetEffectAt(layerPath: NodePath, index: number): boolean {
  return updateDoc(getT().inspector.history.resetEffect, (draft) => {
    const layer = layerIn(draft, layerPath)
    if (layer) resetEffect(layer, index, effectContext(draft as Animation, layerPath))
  })
}

export function setEffectEnabledAt(layerPath: NodePath, index: number, enabled: boolean): boolean {
  return updateDoc(getT().inspector.history.effect, (draft) => {
    const layer = layerIn(draft, layerPath)
    if (layer) setEffectEnabled(layer, index, enabled)
  })
}

export function fixEffectAt(layerPath: NodePath, index: number, fix: EffectFix): boolean {
  return updateDoc(getT().inspector.history.fixEffect, (draft) => {
    const layer = layerIn(draft, layerPath)
    if (layer) applyEffectFix(layer, index, fix, effectContext(draft as Animation, layerPath))
  })
}
