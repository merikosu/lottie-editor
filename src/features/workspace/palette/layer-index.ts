/**
 * Searchable list of every layer in the document (root composition and precomps), for the
 * command palette's "Layers" results.
 */
import type { Dict } from '@/i18n'
import { layerDisplayName } from '@/components/lottie/labels'
import { layerKind, type LayerKind } from '@/lottie/layers'
import { pathKey, type NodePath } from '@/lottie/path'
import { forEachLayer } from '@/lottie/traverse'
import type { Animation } from '@/lottie/types'
import type { SearchField } from '../search/rank'

export interface LayerEntry {
  path: NodePath
  key: string
  name: string
  kind: LayerKind
  /** Name of the precomp that contains the layer; null in the root composition. */
  comp: string | null
  /** 1-based position in its composition, set only when another layer there has the same name. */
  ordinal?: number
  hidden: boolean
  fields: SearchField[]
}

/** Key of a name within a composition (NUL cannot occur in either part). */
const nameKey = (comp: string, name: string) => `${comp}\u0000${name}`

const WEIGHT_KIND = 0.5
const WEIGHT_COMP = 0.35

/** Builds the index; cheap enough to rebuild when the palette opens (500 layers ≈ 1 ms). */
export function buildLayerIndex(doc: Animation, t: Dict): LayerEntry[] {
  const out: LayerEntry[] = []
  // Names used more than once in the same composition get their position shown.
  const nameCounts = new Map<string, number>()
  forEachLayer(doc, (layer, path, comp) => {
    const index = path[path.length - 1] as number
    const name = layerDisplayName(layer, index, t)
    const kind = layerKind(layer)
    const compName = comp.assetIndex === null ? null : comp.name || comp.id || null
    const fields: SearchField[] = [
      { text: name, weight: 1 },
      { text: t.common.layerKinds[kind], weight: WEIGHT_KIND, exact: true },
    ]
    if (compName) fields.push({ text: compName, weight: WEIGHT_COMP })
    const key = nameKey(pathKey(comp.layersPath), name)
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
    out.push({
      path,
      key: pathKey(path),
      name,
      kind,
      comp: compName,
      hidden: layer.hd === true,
      fields,
    })
  })
  for (const entry of out) {
    const compKey = pathKey(entry.path.slice(0, -1))
    if ((nameCounts.get(nameKey(compKey, entry.name)) ?? 0) > 1) {
      entry.ordinal = (entry.path[entry.path.length - 1] as number) + 1
    }
  }
  return out
}
