/**
 * The precomp instance the user works in.
 *
 * A composition used by several precomp layers is listed under each of them in the layer tree
 * and the timeline, and drawn by each of them on the canvas. Once its content is picked in one
 * place (a click on the canvas, a tree row, a timeline row), the other views reveal it under
 * the same instance, and edits that depend on the instance's timing (scaling a key selection,
 * pasting keys or moving layers at the playhead) use that instance.
 *
 * Remembered per composition as the chain of precomp layers leading to it from the root
 * composition, outermost first. Editor-only state, forgotten when another document opens.
 * Pure module (no React); cheap to import from any view.
 */
import { getAt, pathKey, type NodePath } from '@/lottie/path'
import { findPrecomp } from '@/lottie/traverse'
import type { Animation, Layer } from '@/lottie/types'
import { isPrecompLayer } from '@/lottie/types'
import { useDocument } from '@/store/document'

/** Composition (asset id) → precomp layer chain showing it, outermost first. */
let chains = new Map<string, NodePath[]>()
let docId: string | null | undefined

/** Chains belong to one document: start over when another one is open. */
function sync(): void {
  const id = useDocument.getState().meta?.id ?? null
  if (id === docId) return
  docId = id
  chains = new Map()
}

/** Precomp layer paths of a chain (outermost first) as one string, e.g. for comparisons. */
export function chainKey(chain: readonly NodePath[]): string {
  return chain.map(pathKey).join('>')
}

/**
 * True when `chain` leads from the root composition to the composition `assetId`: the first
 * layer is in the root, each next one inside the composition shown by the previous one, and
 * every one of them is a precomp layer.
 */
export function isInstanceChain(
  doc: Animation,
  chain: readonly NodePath[],
  assetId: string,
): boolean {
  if (chain.length === 0) return false
  let compId: string | null = null
  for (const path of chain) {
    const layer = getAt<Layer>(doc, path)
    if (!layer || !isPrecompLayer(layer)) return false
    if (compId === null) {
      if (path.length !== 2 || path[0] !== 'layers') return false
    } else {
      const found = findPrecomp(doc, compId)
      if (!found || path.length !== 4 || path[0] !== 'assets' || path[1] !== found.index)
        return false
    }
    compId = layer.refId
  }
  return compId === assetId
}

/**
 * Notes that the user works through `chain` (precomp layer paths from the root, outermost
 * first): every composition along it is now shown through that instance. Paths that are not
 * precomp layers end the chain (a hit stack may list other nodes after it).
 */
export function noteInstanceChain(doc: Animation, chain: readonly NodePath[]): void {
  sync()
  const kept: NodePath[] = []
  for (const path of chain) {
    const layer = getAt<Layer>(doc, path)
    if (!layer || !isPrecompLayer(layer)) break
    kept.push([...path])
    if (isInstanceChain(doc, kept, layer.refId)) chains.set(layer.refId, [...kept])
    else break
  }
}

/** Notes the precomp layers among the paths under the pointer (a canvas hit stack). */
export function noteInstancesInStack(doc: Animation, stack: readonly NodePath[]): void {
  noteInstanceChain(
    doc,
    stack.filter((p) => {
      const layer = getAt<Layer>(doc, p)
      return !!layer && isPrecompLayer(layer) && (p.length === 2 || p.length === 4)
    }),
  )
}

/** The chain the user last worked through to reach the composition `assetId`, if still valid. */
export function instanceChainOf(doc: Animation, assetId: string): NodePath[] | null {
  sync()
  const chain = chains.get(assetId)
  return chain && isInstanceChain(doc, chain, assetId) ? chain : null
}

/**
 * The chain the user last worked through to reach the node at `path` (a layer, shape item or
 * property inside a precomp); null for root content or when none was noted.
 */
export function instanceChainFor(doc: Animation, path: NodePath): NodePath[] | null {
  if (path[0] !== 'assets' || typeof path[1] !== 'number') return null
  const id = doc.assets?.[path[1]]?.id
  return id === undefined ? null : instanceChainOf(doc, id)
}

/** Forgets every noted instance (tests). */
export function resetInstanceChains(): void {
  chains = new Map()
  docId = undefined
}
