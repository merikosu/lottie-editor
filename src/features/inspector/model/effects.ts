/**
 * Editable parameters of a layer effect (`ef`). After Effects exports every effect parameter as
 * a control with a type and an animatable value `v`; groups nest their own `ef` list.
 *
 * Known effects (see `@/lottie/effects`) get friendly parameters: labels by match name, units,
 * menus with named options, layer and mask pickers, and the parameters no player reads set
 * apart. Other effects get one generic row per control, by control type.
 */
import {
  effectDefOf,
  matchParams,
  type EffectDef,
  type EffectParamDef,
  type ParamUi,
} from '@/lottie/effects'
import type { NodePath } from '@/lottie/path'
import { getKeyframes, isPropertyLike } from '@/lottie/property'
import type { Effect, EffectValue } from '@/lottie/types'
import { nameText } from './names'

/** Generic kind of a control, from its type (fallback labels and hints). */
export type EffectControlKind =
  'slider' | 'angle' | 'color' | 'point' | 'checkbox' | 'dropdown' | 'layer' | 'mask'

export interface EffectParam {
  kind: EffectControlKind
  /** How the value is edited (from the catalog, or from the control type). */
  ui: ParamUi
  /** Parameter name as exported (After Effects localizes it). */
  name: string
  /** Path of the control's value property (`v`). */
  path: NodePath
  /** Names of the groups containing the control, outermost first. */
  groups: string[]
  /** Catalog entry of a known effect's parameter. */
  def: EffectParamDef | null
  /** No Lottie player reads it. */
  unused: boolean
}

export interface EffectModel {
  /** Catalog entry, for known effects. */
  def: EffectDef | null
  params: EffectParam[]
}

const MAX_DEPTH = 8

/** Number of components of a control's value (null when it has no animatable value). */
function valueLength(v: unknown): number | null {
  if (!isPropertyLike(v)) return null
  const kfs = getKeyframes<unknown>(v)
  const value = kfs ? (kfs[0]?.s ?? kfs[0]?.e) : v.k
  if (typeof value === 'number') return 1
  if (Array.isArray(value) && value.length > 0 && value.every((c) => typeof c === 'number'))
    return value.length
  return null
}

const KIND_BY_TY: Record<number, EffectControlKind> = {
  0: 'slider',
  1: 'angle',
  2: 'color',
  3: 'point',
  4: 'checkbox',
  7: 'dropdown',
  10: 'layer',
  11: 'mask',
}

/** How an unknown control is edited: by its type, if its value fits. */
function genericUi(kind: EffectControlKind, len: number): ParamUi | null {
  switch (kind) {
    case 'angle':
      return len === 1 ? { kind: 'angle' } : null
    case 'color':
      return len >= 3 ? { kind: 'color' } : null
    case 'point':
      return len >= 2 ? { kind: 'point', dims: len >= 3 ? 3 : 2 } : null
    case 'checkbox':
      return len === 1 ? { kind: 'checkbox' } : null
    // Built-in checkboxes are exported as menus too: a plain number fits both.
    case 'dropdown':
      return len === 1 ? { kind: 'number', precision: 0, min: 0 } : null
    case 'layer':
      return len === 1 ? { kind: 'layer' } : null
    case 'mask':
      return len === 1 ? { kind: 'mask' } : null
    case 'slider':
      return len === 1 ? { kind: 'number', precision: 2 } : null
  }
}

/** Generic kind matching a catalog parameter's editor (for fallback labels). */
function kindOfUi(ui: ParamUi, fallback: EffectControlKind): EffectControlKind {
  switch (ui.kind) {
    case 'angle':
    case 'color':
    case 'point':
    case 'checkbox':
    case 'layer':
    case 'mask':
      return ui.kind
    case 'menu':
      return 'dropdown'
    default:
      return fallback
  }
}

/**
 * The editable parameters of an effect, in order, with nested groups flattened. Controls
 * without an animatable value (buttons, group markers) are skipped.
 */
export function effectModel(effect: Effect, effectPath: NodePath): EffectModel {
  const def = effectDefOf(effect)
  const matches = def ? matchParams(effect, def) : []
  const params: EffectParam[] = []
  const visit = (
    values: EffectValue[] | undefined,
    base: NodePath,
    groups: string[],
    depth: number,
  ) => {
    if (!Array.isArray(values) || depth > MAX_DEPTH) return
    values.forEach((value, i) => {
      if (!value || typeof value !== 'object') return
      const path = [...base, 'ef', i]
      // Groups are recognized by their own list: their `ty` may collide with control types.
      const nested = (value as { ef?: EffectValue[] }).ef
      if (Array.isArray(nested)) {
        visit(nested, path, [...groups, nameText(value.nm)], depth + 1)
        return
      }
      const len = valueLength(value.v)
      if (len === null) return
      const tyKind = KIND_BY_TY[value.ty] ?? 'slider'
      const known = depth === 0 ? (matches[i] ?? null) : null
      const ui = known?.ui ?? genericUi(tyKind, len)
      if (!ui) return
      params.push({
        kind: known ? kindOfUi(known.ui, tyKind) : tyKind,
        ui,
        name: nameText(value.nm),
        path: [...path, 'v'],
        groups: groups.filter(Boolean),
        def: known,
        // A known effect's players read the catalog's controls only.
        unused: known ? !!known.unused : !!def,
      })
    })
  }
  visit(effect.ef, effectPath, [], 0)
  return { def, params }
}
