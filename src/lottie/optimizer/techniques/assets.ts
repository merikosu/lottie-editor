/**
 * `unusedAssets` and `dedupeAssets`.
 *
 * Assets are only reachable through layers' `refId` (precomps, images, image sequences) and
 * glyph data (`chars[].data.refId`); fonts through text documents' `f`. Assets bound to slots
 * (themes may swap images by `sid`) and duplicated ids (ambiguous) are kept. When expressions
 * reach compositions or layers (`comp("name")`, `layer(…)`) nothing is removed.
 */
import { mayRestructure } from '../expressions'
import { arr, compLayers, isObj, listComps, type Json } from '../model'
import type { TechniqueContext, TechniqueDetails } from './context'

/** Asset ids reachable from the root composition (transitively) and from glyphs. */
function reachableAssets(doc: Json): { assets: Set<string>; fonts: Set<string> } {
  const byId = new Map<string, Json>()
  for (const a of arr(doc.assets))
    if (isObj(a) && typeof a.id === 'string' && !byId.has(a.id)) byId.set(a.id, a)
  const assets = new Set<string>()
  const fonts = new Set<string>()
  const queue: unknown[][] = [arr(doc.layers)]
  const visit = (id: unknown) => {
    if (typeof id !== 'string' || assets.has(id)) return
    assets.add(id)
    const asset = byId.get(id)
    if (asset && Array.isArray(asset.layers)) queue.push(asset.layers)
  }
  for (const ch of arr(doc.chars)) if (isObj(ch) && isObj(ch.data)) visit(ch.data.refId)
  while (queue.length) {
    for (const layer of queue.shift()!) {
      if (!isObj(layer)) continue
      visit(layer.refId)
      if (layer.ty === 5 && isObj(layer.t) && isObj(layer.t.d)) {
        for (const kf of arr(layer.t.d.k))
          if (isObj(kf) && isObj(kf.s) && typeof kf.s.f === 'string') fonts.add(kf.s.f)
      }
    }
  }
  return { assets, fonts }
}

function hasTextLayers(doc: Json): boolean {
  return listComps(doc).some((comp) => compLayers(comp).some((l) => l.ty === 5))
}

function duplicateIds(assets: readonly unknown[]): Set<string> {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const a of assets) {
    if (!isObj(a) || typeof a.id !== 'string') continue
    if (seen.has(a.id)) dup.add(a.id)
    seen.add(a.id)
  }
  return dup
}

export function unusedAssets(tc: TechniqueContext): TechniqueDetails {
  if (!mayRestructure(tc.info.reach)) return { assets: 0, fonts: 0, glyphs: 0 }
  const doc = tc.doc
  const { assets: used, fonts: usedFonts } = reachableAssets(doc)
  const all = arr(doc.assets)
  const dup = duplicateIds(all)
  const keep = all.filter((a) => {
    if (!isObj(a) || typeof a.id !== 'string') return true
    if (used.has(a.id) || dup.has(a.id) || typeof a.sid === 'string') return true
    // Only precompositions and images are known to be referenced by layers.
    return !(Array.isArray(a.layers) || typeof a.p === 'string')
  })
  const removed = all.length - keep.length
  if (removed) doc.assets = keep

  let fonts = 0
  let glyphs = 0
  if (usedFonts.size === 0 && !hasTextLayers(doc)) {
    // No text at all: fonts and glyphs are dead weight.
    if (isObj(doc.fonts)) fonts = arr(doc.fonts.list).length
    glyphs = arr(doc.chars).length
    delete doc.fonts
    delete doc.chars
  } else if (isObj(doc.fonts) && Array.isArray(doc.fonts.list)) {
    const list = doc.fonts.list
    const kept = list.filter((f) => !isObj(f) || usedFonts.has(String(f.fName)))
    fonts = list.length - kept.length
    // An empty font list breaks text layers that fall back to the first font: keep one.
    if (fonts && kept.length) doc.fonts.list = kept
    else fonts = 0
    if (fonts && Array.isArray(doc.chars)) {
      const families = new Set(
        kept.filter(isObj).map((f) => `${String(f.fFamily)}\u0000${String(f.fStyle)}`),
      )
      const chars = doc.chars
      const keptChars = chars.filter(
        (c) => !isObj(c) || families.has(`${String(c.fFamily)}\u0000${String(c.style)}`),
      )
      glyphs = chars.length - keptChars.length
      // An empty chars array switches lottie-web to glyph mode for every text layer: never leave one.
      if (glyphs && keptChars.length) doc.chars = keptChars
      else glyphs = 0
    }
  }
  return { assets: removed, fonts, glyphs }
}

/** Canonical content key of an asset without its id and name (or null when not dedupable). */
function assetKey(a: Json): string | null {
  if (typeof a.id !== 'string' || typeof a.sid === 'string') return null
  const rest: Json = {}
  for (const key of Object.keys(a).sort()) if (key !== 'id' && key !== 'nm') rest[key] = a[key]
  if (Array.isArray(a.layers)) return `c:${JSON.stringify(rest)}`
  if (typeof a.p === 'string') return `i:${JSON.stringify(rest)}`
  return null
}

function remapRefs(doc: Json, remap: Map<string, string>): number {
  let refs = 0
  for (const comp of listComps(doc)) {
    for (const layer of compLayers(comp)) {
      if (typeof layer.refId === 'string' && remap.has(layer.refId)) {
        layer.refId = remap.get(layer.refId)
        refs++
      }
    }
  }
  for (const ch of arr(doc.chars)) {
    if (
      isObj(ch) &&
      isObj(ch.data) &&
      typeof ch.data.refId === 'string' &&
      remap.has(ch.data.refId)
    ) {
      ch.data.refId = remap.get(ch.data.refId)
      refs++
    }
  }
  return refs
}

/**
 * Merges precompositions and images with identical content (ignoring id and name): instances
 * of the duplicates point to the first copy. Repeats until stable, since merging inner
 * compositions can make outer ones identical.
 */
export function dedupeAssets(tc: TechniqueContext): TechniqueDetails {
  if (!mayRestructure(tc.info.reach)) return { assets: 0, references: 0 }
  const doc = tc.doc
  let assets = 0
  let references = 0
  for (let round = 0; round < 16; round++) {
    const list = arr(doc.assets)
    const dup = duplicateIds(list)
    const firstByKey = new Map<string, string>()
    const remap = new Map<string, string>()
    for (const a of list) {
      if (!isObj(a) || typeof a.id !== 'string' || dup.has(a.id)) continue
      const key = assetKey(a)
      if (key === null) continue
      const first = firstByKey.get(key)
      if (first === undefined) firstByKey.set(key, a.id)
      else remap.set(a.id, first)
    }
    if (remap.size === 0) break
    references += remapRefs(doc, remap)
    doc.assets = list.filter((a) => !isObj(a) || typeof a.id !== 'string' || !remap.has(a.id))
    assets += remap.size
  }
  return { assets, references }
}
