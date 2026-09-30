/**
 * Actions shared by the Customize page and the editor commands: replacing the selected element,
 * importing an SVG as a new layer and importing another animation as a precomp layer.
 */
import { toast } from '@/components/ui'
import { describeOpenError, notifyError } from '@/features/io'
import { getT } from '@/i18n'
import { compInfoAt } from '@/lottie/create'
import { fileStem, OPEN_ACCEPT, readLottieFile } from '@/lottie/formats'
import { insertLayers, layersAt } from '@/lottie/layer-ops'
import { nextLayerInd } from '@/lottie/layers'
import { compPathOf, layerPathOf, pathEquals, ROOT_LAYERS, type NodePath } from '@/lottie/path'
import { replaceTargetKind } from '@/lottie/replace'
import { importSvg, SvgImportError } from '@/lottie/svg'
import type { Animation } from '@/lottie/types'
import { getDoc, primaryNode, updateDoc, useDocument, type Selection } from '@/store/document'
import { importLottieAsLayer } from './lib/import-lottie'
import { svgShapeLayer } from './lib/svg-layer'
import { svgWarningLines } from './replace/messages'
import { openReplace } from './replace/open'

/** The selected element when it can be replaced (the primary selection). */
export function replaceableSelection(): NodePath | null {
  const doc = getDoc()
  const primary = primaryNode(useDocument.getState().selection)
  return doc && primary && replaceTargetKind(doc, primary) ? primary : null
}

/** Opens the Replace dialog for the selected element. */
export function replaceSelected(file?: File): boolean {
  const target = replaceableSelection()
  if (!target) return false
  openReplace(target, file)
  return true
}

/** Where new layers go: above the topmost selected layer of its composition, else on top of the root. */
function insertionPoint(): { compPath: NodePath; index: number } {
  const sel = useDocument.getState().selection
  const primary = primaryNode(sel)
  const layerPath = primary ? layerPathOf(primary) : null
  if (!layerPath) return { compPath: ROOT_LAYERS, index: 0 }
  const compPath = compPathOf(layerPath)
  let index = layerPath[layerPath.length - 1] as number
  for (const node of sel.nodes) {
    const lp = layerPathOf(node)
    if (lp && pathEquals(compPathOf(lp), compPath))
      index = Math.min(index, lp[lp.length - 1] as number)
  }
  return { compPath, index }
}

const selectionOf = (path: NodePath | null): Selection => ({
  nodes: path ? [path] : [],
  keyframes: [],
  property: null,
})

/** Opens the system file picker for one file; resolves null when cancelled. */
function pickOne(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.hidden = true
    input.addEventListener(
      'change',
      () => {
        input.remove()
        resolve(input.files?.[0] ?? null)
      },
      { once: true },
    )
    input.addEventListener(
      'cancel',
      () => {
        input.remove()
        resolve(null)
      },
      { once: true },
    )
    document.body.appendChild(input)
    input.click()
  })
}

/**
 * "Import SVG as layer…": a new shape layer drawing the SVG, centered and fitted to half of
 * the composition, above the selection. Returns its path.
 */
export async function importSvgLayer(file?: File | null): Promise<NodePath | null> {
  const t = getT()
  const picked = file ?? (await pickOne('.svg,image/svg+xml'))
  if (!picked || !getDoc()) return null
  const name = fileStem(picked.name) || picked.name
  let svg
  try {
    svg = importSvg(await picked.text(), { name })
  } catch (err) {
    const code = err instanceof SvgImportError ? err.code : 'invalid'
    // An SVG with only text (or only a bitmap) says why nothing could be imported.
    const reasons = err instanceof SvgImportError ? svgWarningLines(err.warnings, t) : []
    notifyError({
      title: t.customize.errors.importSvg(picked.name),
      lines: [t.customize.replace.errors[code](picked.name), ...reasons],
    })
    return null
  }
  const doc = getDoc()
  if (!doc) return null
  const { compPath, index } = insertionPoint()
  const layers = layersAt(doc, compPath)
  if (!layers) return null
  const info = compInfoAt(doc, compPath)
  const layer = svgShapeLayer(svg.shapes, svg.bounds, {
    name,
    ind: nextLayerInd(layers),
    ip: info.ip,
    op: info.op,
    comp: { w: info.w, h: info.h },
  })
  let path: NodePath | null = null
  updateDoc(
    t.customize.history.importSvg(picked.name),
    (d) => {
      path = insertLayers(d as Animation, compPath, [layer], index)[0] ?? null
    },
    { selection: () => selectionOf(path) },
  )
  if (svg.warnings.length) {
    // The layer is there, but not everything of the SVG made it: say what is missing.
    const lines = svgWarningLines(svg.warnings, t)
    toast.warning(t.customize.errors.svgPartial(lines.length), {
      description: lines.join(' '),
      duration: 10_000,
    })
  }
  return path
}

/**
 * "Import Lottie as layer…": another animation (.json, .lottie, .tgs, .zip) becomes a precomp
 * layer above the selection (see lib/import-lottie.ts). Returns its path.
 */
export async function importLottieLayer(file?: File | null): Promise<NodePath | null> {
  const t = getT()
  const picked = file ?? (await pickOne(OPEN_ACCEPT))
  if (!picked || !getDoc()) return null
  const name = fileStem(picked.name) || picked.name
  let source: Animation
  try {
    const result = await readLottieFile(picked)
    const opened = result.animations.find((a) => a.id === result.activeId) ?? result.animations[0]
    if (!opened) throw new Error('No animation in the file')
    source = opened.data
  } catch (err) {
    const message = describeOpenError(err, picked.name, t)
    notifyError({ title: t.customize.errors.importLottie(picked.name), lines: message.lines })
    return null
  }
  const { compPath, index } = insertionPoint()
  let path: NodePath | null = null
  updateDoc(
    t.customize.history.importLottie(picked.name),
    (d) => {
      path = importLottieAsLayer(d as Animation, source, { compPath, index, name })
    },
    { selection: () => selectionOf(path) },
  )
  return path
}
