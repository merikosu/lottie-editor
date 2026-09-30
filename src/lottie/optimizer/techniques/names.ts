/**
 * `names` (lossy, opt-in): strips names that only authoring tools and runtime code read.
 *
 * Players never draw names, but lottie-ios / lottie-android keypaths (value providers, dynamic
 * colors), lottie-web `getElementsByName`-style lookups and expressions address layers and
 * shapes by `nm`; `cl` / `ln` become CSS classes and ids in lottie-web's SVG. So the scope is
 * configurable and a warning is always reported. Files whose expressions look items up by name
 * keep them (see expressions.ts). Never touched: effect names and match names
 * (players match effects by them), marker names, font names, stroke dash names (lottie-web keys
 * its stroke interface by them), the mask `cl` flag (in old files it means "closed").
 */
import { mayDropNames } from '../expressions'
import { arr, compLayers, isObj, isProperty, listComps, type Json } from '../model'
import type { TechniqueContext, TechniqueDetails } from './context'

interface Counter {
  names: number
  classes: number
}

function dropKey(o: Json, key: string, c: Counter, kind: 'names' | 'classes'): void {
  if (key in o) {
    delete o[key]
    c[kind]++
  }
}

/**
 * Names inside a subtree of shape items. Stroke dash entries (`d[].nm`) keep theirs: lottie-web
 * defines them as properties of the stroke's interface (`Object.defineProperty(dashOb, nm, …)`)
 * while building layers, and a second entry without a name ("undefined" again) throws, so the
 * whole precomposition stops rendering.
 */
function stripShapeNames(items: unknown, classes: boolean, c: Counter): void {
  for (const item of arr(items)) {
    if (!isObj(item)) continue
    dropKey(item, 'nm', c, 'names')
    dropKey(item, 'mn', c, 'names')
    if (classes) {
      dropKey(item, 'cl', c, 'classes')
      dropKey(item, 'ln', c, 'classes')
    }
    if (item.ty === 'gr') stripShapeNames(item.it, classes, c)
  }
}

export function names(tc: TechniqueContext): TechniqueDetails {
  const { scope, classes } = tc.options.names
  const c: Counter = { names: 0, classes: 0 }
  // Expressions reach layers, shapes and properties by name.
  // Expressions reach shapes, masks and properties by name through lookups (`content("…")`,
  // `mask("…")`, …) and layers through `layer("…")`: keep what they could address.
  if (!mayDropNames(tc.info.reach, scope === 'all')) return { names: 0, classes: 0 }
  const doc = tc.doc
  const everything = scope === 'all'
  const exceptLayers = scope !== 'shapes'
  for (const comp of listComps(doc)) {
    for (const layer of compLayers(comp)) {
      if (everything) dropKey(layer, 'nm', c, 'names')
      if (exceptLayers) {
        dropKey(layer, 'mn', c, 'names')
        for (const mask of arr(layer.masksProperties))
          if (isObj(mask)) dropKey(mask, 'nm', c, 'names')
        // Property-level names (`nm` on transforms and animated properties) are never drawn.
        if (isObj(layer.ks)) {
          dropKey(layer.ks, 'nm', c, 'names')
          for (const v of Object.values(layer.ks)) if (isProperty(v)) dropKey(v, 'nm', c, 'names')
        }
      }
      if (classes) {
        dropKey(layer, 'cl', c, 'classes')
        dropKey(layer, 'ln', c, 'classes')
      }
      if (layer.ty === 4) stripShapeNames(layer.shapes, classes, c)
    }
  }
  if (everything) {
    for (const a of arr(doc.assets)) if (isObj(a)) dropKey(a, 'nm', c, 'names')
  }
  if (c.names) tc.warn('namesStripped', c.names)
  if (c.classes) tc.warn('classesStripped', c.classes)
  return { names: c.names, classes: c.classes }
}
