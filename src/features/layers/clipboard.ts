/**
 * Copy / cut / paste of layers and shape items.
 *
 * Copies are written to the system clipboard as JSON with the editor marker
 * (`{ "__lottieEditor": "layers", … }`, see layer-ops `LayersClipboard`), so they paste into
 * another tab or window; an in-memory copy covers browsers that refuse clipboard reads.
 */
import { dispatchPaste, type PasteHandler } from '@/commands/paste'
import { formatShortcut } from '@/commands/shortcuts'
import { toast } from '@/components/ui'
import { getT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { compInfoAt, createEmptyShapeLayer, nextNumberedName } from '@/lottie/create'
import {
  insertLayers,
  layersAt,
  parseLayersClipboard,
  pasteLayers,
  pasteShapes,
  serializeLayers,
  serializeShapes,
  type LayersClipboard,
} from '@/lottie/layer-ops'
import { nextLayerInd } from '@/lottie/layers'
import {
  compPathOf,
  getAt,
  isLayerPath,
  isShapePath,
  layerPathOf,
  pathEquals,
  type NodePath,
} from '@/lottie/path'
import type { Animation, Layer } from '@/lottie/types'
import { getDoc, updateDoc, useDocument } from '@/store/document'
import { countLabel, deleteNodes, insertionPoint, selectedNodes } from './actions'

/** Last copy, for browsers that refuse clipboard reads (Edit ▸ Paste). */
let memory: LayersClipboard | null = null

/**
 * Payload for the current selection — layers of the primary node's composition when the
 * primary node is a layer, otherwise shape items of its layer — and the selected nodes it holds.
 */
function payloadForSelection(): { payload: LayersClipboard; nodes: NodePath[] } | null {
  const doc = getDoc()
  const { layers, shapes, primary } = selectedNodes()
  if (!doc || !primary) return null
  if (isLayerPath(primary)) {
    const docId = useDocument.getState().meta?.id
    const payload = serializeLayers(doc, layers, { docId })
    const nodes = layers.filter((p) => pathEquals(compPathOf(p), compPathOf(primary)))
    return payload && { payload, nodes }
  }
  const payload = serializeShapes(doc, shapes)
  const nodes = shapes.filter((p) => pathEquals(layerPathOf(p), layerPathOf(primary)))
  return payload && { payload, nodes }
}

/** Copies the selected layers or shape items. Returns false when there is nothing to copy. */
export async function copySelection(): Promise<boolean> {
  const copied = payloadForSelection()
  if (!copied) return false
  memory = copied.payload
  await copyText(JSON.stringify(copied.payload))
  return true
}

/** Copies, then deletes exactly what was copied (other selected nodes stay). */
export async function cutSelection(): Promise<boolean> {
  const copied = payloadForSelection()
  if (!copied) return false
  memory = copied.payload
  await copyText(JSON.stringify(copied.payload))
  return deleteNodes(copied.nodes, getT().layers.history.cut(countLabel(copied.nodes)))
}

/** Asset id of the composition at `compPath` (null for the root). */
function compIdOf(doc: Animation, compPath: NodePath): string | null {
  return compPath[0] === 'assets' ? (doc.assets?.[compPath[1] as number]?.id ?? null) : null
}

/**
 * Pastes a payload relative to the selection:
 *  - layers go above the topmost selected layer of the primary node's composition;
 *  - shape items go above the selected item, into the selected shape layer, or — without a
 *    shape target — into a new shape layer.
 */
export function pastePayload(payload: LayersClipboard): boolean {
  const doc = getDoc()
  if (!doc) return false
  const t = getT()
  const sel = useDocument.getState().selection
  let pasted: NodePath[] = []
  const selection = () => ({ nodes: pasted, keyframes: [], property: null })

  if (payload.kind === 'layers') {
    const { compPath, index } = insertionPoint(sel)
    const meta = useDocument.getState().meta
    const sameComp =
      !!meta &&
      payload.sourceDoc === meta.id &&
      (payload.sourceComp ?? null) === compIdOf(doc, compPath)
    const changed = updateDoc(
      t.layers.history.paste(t.layers.count.layers(payload.layers?.length ?? 0)),
      (d) => {
        pasted = pasteLayers(d as Animation, compPath, payload, index, {
          keepOutsideLinks: sameComp,
        })
      },
      { selection },
    )
    if (pasted.length < (payload.layers?.length ?? 0)) toast.error(t.layers.errors.recursivePaste)
    return changed
  }

  const shapes = payload.shapes ?? []
  const primary = selectedNodes(sel).primary
  const primaryNode = primary ? getAt<Layer>(doc, primary) : undefined
  let arrayPath: NodePath | null = null
  let index = 0
  if (primary && isShapePath(primary)) {
    arrayPath = primary.slice(0, -1)
    index = primary[primary.length - 1] as number
  } else if (primary && isLayerPath(primary) && primaryNode?.ty === 4) {
    arrayPath = [...primary, 'shapes']
  }
  return updateDoc(
    t.layers.history.paste(t.layers.count.items(shapes.length)),
    (d) => {
      const anim = d as Animation
      if (arrayPath) {
        pasted = pasteShapes(anim, arrayPath, shapes, index)
        return
      }
      // No shape target: wrap the items into a new shape layer at the insertion point.
      const { compPath, index: at } = insertionPoint(sel)
      const layers = layersAt(anim, compPath)
      if (!layers) return
      const info = compInfoAt(anim, compPath)
      const layer = createEmptyShapeLayer({
        name: nextNumberedName(
          layers.map((l) => l.nm),
          t.layers.defaultNames.shapeLayer,
        ),
        ind: nextLayerInd(layers),
        ip: info.ip,
        op: info.op,
      })
      const [layerPath] = insertLayers(anim, compPath, [layer], at)
      if (layerPath) pasted = pasteShapes(anim, [...layerPath, 'shapes'], shapes, 0)
      if (!pasted.length && layerPath) pasted = [layerPath]
    },
    { selection },
  )
}

/** Paste registry handler (priority 10): editor layer/shape payloads from the system clipboard. */
export const layersPasteHandler: PasteHandler = ({ json }) => {
  const payload = getDoc() ? parseLayersClipboard(json) : null
  if (!payload) return false
  pastePayload(payload)
  return true
}

/**
 * Edit ▸ Paste from menus and the palette (⌘V itself arrives as a native paste event).
 * Falls back to the in-memory copy when the browser does not allow reading the clipboard.
 */
export async function pasteFromMenu(): Promise<void> {
  let text: string | null
  try {
    text = await navigator.clipboard.readText()
  } catch {
    text = null
  }
  if (text !== null) {
    await dispatchPaste(text, [], null)
    return
  }
  if (memory) {
    pastePayload(memory)
    return
  }
  const t = getT()
  toast.error(t.layers.errors.clipboard, {
    description: t.layers.errors.clipboardHint(formatShortcut('mod+v')),
  })
}
