/**
 * Names shown for effects: the localized type ("Drop shadow") and whether an effect's name
 * only repeats it.
 */
import type { Dict } from '@/i18n'
import { effectDefOf, matchParams } from '@/lottie/effects'
import type { Effect } from '@/lottie/types'

/** Localized type of an effect ("Drop shadow"), or null for unknown ones. */
export function effectTypeLabel(effect: Effect, t: Dict): string | null {
  const def = effectDefOf(effect)
  if (def) return t.inspector.effects.kinds[def.kind]
  return t.inspector.effects.types[effect.ty] ?? null
}

/** True when the name only repeats the type ("Drop Shadow 2", "Тень"). */
export function namedAfterType(
  name: string,
  effect: Effect,
  type: string | null,
  t: Dict,
): boolean {
  const base = name
    .replace(/\s*\d+$/, '')
    .trim()
    .toLowerCase()
  if (!base) return true
  const def = effectDefOf(effect)
  const defaults: Record<string, string> = t.inspector.effects.defaultNames
  const candidates = [type, def?.nm, def ? defaults[def.kind] : undefined]
  return candidates.some((c) => !!c && c.toLowerCase() === base)
}

/**
 * Friendly label of an effect's control (by match name, so localized exports read the same),
 * or null for controls of unknown effects. For other views listing effect controls.
 */
export function effectParamLabel(effect: Effect, controlIndex: number, t: Dict): string | null {
  const def = effectDefOf(effect)
  const p = def ? matchParams(effect, def)[controlIndex] : null
  return (def && p && t.inspector.effects.params[def.kind]?.[p.id]) || null
}
