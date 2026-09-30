/**
 * Precompose and release precomp layers: the actions behind `layer.precompose` (through its
 * dialog) and `layer.unprecompose`, the dialog's remembered options and the states menus show.
 * Each edit is one undo step; the domain logic (render-exact) lives in `@/lottie/layer-ops`.
 */
import { create } from 'zustand'
import { toast } from '@/components/ui'
import { layerDisplayName } from '@/components/lottie/labels'
import { getT, type Dict } from '@/i18n'
import { nextNumberedName } from '@/lottie/create'
import {
  planPrecompose,
  precomposeLayers,
  releaseBlocker,
  releasePrecomps,
  releaseRevealsContent,
  type PrecomposeMode,
  type PrecomposePlan,
  type ReleaseBlocker,
  type ReleaseResult,
} from '@/lottie/layer-ops'
import { compPathOf, getAt, isLayerPath, pathEquals, type NodePath } from '@/lottie/path'
import { forEachLayer } from '@/lottie/traverse'
import type { Animation, Layer, PrecompLayer } from '@/lottie/types'
import { isPrecompLayer } from '@/lottie/types'
import { getDoc, updateDoc, useDocument, type Selection } from '@/store/document'
import { openDialog } from '@/store/ui'
import { isNodeLocked, isNodeSoloed, setLocked, setSolo } from './state'

/** Id of the precompose dialog (see register.ts). */
export const PRECOMPOSE_DIALOG = 'precompose'

const selectionOf = (nodes: NodePath[]): Selection => ({ nodes, keyframes: [], property: null })

/**
 * Locks and solo are keyed by composition and `ind`: when layers move to another composition,
 * they follow them (`moves` = [path in `prev`, path now]).
 */
function carryViewState(prev: Animation, moves: ReadonlyArray<readonly [NodePath, NodePath]>) {
  const locked = moves.filter(([from]) => isNodeLocked(from, prev)).map(([, to]) => to)
  const soloed = moves.filter(([from]) => isNodeSoloed(from, prev)).map(([, to]) => to)
  if (locked.length) setLocked(locked, true)
  if (soloed.length) setSolo(soloed, true)
}

/* -------------------------------------------------------------------------- */
/*                                  Precompose                                */
/* -------------------------------------------------------------------------- */

export interface PrecomposePrefs {
  mode: PrecomposeMode
  adjustDuration: boolean
}

/** The dialog's options, remembered for the session like After Effects does. */
export const usePrecomposePrefs = create<PrecomposePrefs>()(() => ({
  mode: 'move',
  adjustDuration: false,
}))

export function setPrecomposePrefs(patch: Partial<PrecomposePrefs>): void {
  usePrecomposePrefs.setState(patch)
}

/** Selected layers when they all belong to one composition (shape items are not layers). */
export function precomposeTargets(
  sel: Selection = useDocument.getState().selection,
): NodePath[] | null {
  const layers = sel.nodes.filter(isLayerPath)
  if (!layers.length) return null
  const comp = compPathOf(layers[0])
  return layers.every((p) => pathEquals(compPathOf(p), comp)) ? layers : null
}

export function canPrecompose(): boolean {
  return getDoc() !== null && precomposeTargets() !== null
}

export function openPrecompose(): void {
  if (canPrecompose()) openDialog(PRECOMPOSE_DIALOG)
}

/** Names of every composition and precomp layer: new names are numbered after them. */
function compositionNames(doc: Animation): string[] {
  const names: string[] = []
  for (const asset of doc.assets ?? []) if (typeof asset.nm === 'string') names.push(asset.nm)
  forEachLayer(doc, (layer) => {
    if (isPrecompLayer(layer) && typeof layer.nm === 'string') names.push(layer.nm)
  })
  return names
}

/**
 * After Effects' default name for the new composition: "<layer> Comp 1" for one layer,
 * "Pre-comp 1" for several (numbered past the existing ones).
 */
export function defaultPrecompName(doc: Animation, plan: PrecomposePlan, t: Dict = getT()): string {
  const layers = getAt<Layer[]>(doc, plan.compPath) ?? []
  const base =
    plan.selected.length === 1
      ? t.layers.precompose.layerCompName(
          layerDisplayName(layers[plan.selected[0]], plan.selected[0], t),
        )
      : t.layers.precompose.defaultName
  return nextNumberedName(compositionNames(doc), base)
}

/** Display name of the composition the layers are in ("" for an unnamed root). */
export function compositionName(doc: Animation, compPath: NodePath): string {
  if (compPath[0] === 'assets') {
    const asset = doc.assets?.[compPath[1] as number]
    return (typeof asset?.nm === 'string' && asset.nm.trim()) || String(asset?.id ?? '')
  }
  return typeof doc.nm === 'string' ? doc.nm.trim() : ''
}

/** What precomposing the current selection would do (null when it cannot be precomposed). */
export function currentPrecomposePlan(doc: Animation | null = getDoc()): PrecomposePlan | null {
  const targets = precomposeTargets()
  return doc && targets ? planPrecompose(doc, targets) : null
}

export interface PrecomposeRequest {
  name: string
  mode: PrecomposeMode
  adjustDuration: boolean
}

/**
 * Precomposes the selected layers as one undo step and selects the new precomp layer.
 * Returns false when nothing changed (no document, invalid selection, unavailable mode).
 */
export function precomposeSelection(request: PrecomposeRequest): boolean {
  const doc = getDoc()
  const targets = precomposeTargets()
  if (!doc || !targets) return false
  const plan = planPrecompose(doc, targets, { scanExpressions: false })
  if (!plan) return false
  const t = getT()
  const name = request.name.trim() || defaultPrecompName(doc, plan, t)
  let created: NodePath | null = null
  const changed = updateDoc(
    t.layers.history.precompose(name),
    (d) => {
      created = precomposeLayers(d as Animation, targets, {
        name,
        mode: request.mode,
        adjustDuration: request.adjustDuration,
      })
    },
    { selection: () => selectionOf(created ? [created] : []) },
  )
  const path = created as NodePath | null
  const next = getDoc()
  if (!changed || !path || !next) return false
  // "Leave" keeps the layer's ind here: its lock and solo stay on the precomp layer.
  if (request.mode === 'move') {
    const refId = getAt<PrecompLayer>(next, path)?.refId
    const assetIndex = next.assets?.findIndex((a) => a.id === refId) ?? -1
    if (assetIndex >= 0) {
      carryViewState(
        doc,
        plan.moved.map((i, k) => [
          [...plan.compPath, i],
          ['assets', assetIndex, 'layers', k],
        ]),
      )
    }
  }
  return true
}

/* -------------------------------------------------------------------------- */
/*                                   Release                                  */
/* -------------------------------------------------------------------------- */

type BlockerKey = keyof Dict['layers']['release']['blocked']

const BLOCKER_KEYS: Record<Exclude<ReleaseBlocker, 'not-precomp'>, BlockerKey> = {
  missing: 'missing',
  recursive: 'recursive',
  'time-remap': 'timeRemap',
  stretch: 'stretch',
  matte: 'matte',
  masks: 'masks',
  effects: 'effects',
  styles: 'styles',
  blend: 'blend',
}

/** Short reason for menus ("Time remapping"). */
export function releaseBlockerLabel(reason: ReleaseBlocker, t: Dict = getT()): string {
  return reason === 'not-precomp' ? '' : t.layers.release.blocked[BLOCKER_KEYS[reason]]
}

/** The reason as a sentence, for notifications. */
function releaseBlockerHint(reason: ReleaseBlocker, t: Dict): string {
  return reason === 'not-precomp' ? '' : t.layers.release.blockedHint[BLOCKER_KEYS[reason]]
}

/** Selected precomp layers. */
export function releaseTargets(
  doc: Animation | null = getDoc(),
  sel: Selection = useDocument.getState().selection,
): NodePath[] {
  if (!doc) return []
  return sel.nodes.filter((p) => {
    if (!isLayerPath(p)) return false
    const layer = getAt<Layer>(doc, p)
    return !!layer && isPrecompLayer(layer)
  })
}

export interface ReleaseState {
  /** Selected precomp layers. */
  targets: NodePath[]
  /** Why none of them can be released (the first one's reason), or null when some can. */
  blocker: ReleaseBlocker | null
}

/** What the release command would do with the current selection (menus show the reason). */
export function releaseState(
  doc: Animation | null = getDoc(),
  sel: Selection = useDocument.getState().selection,
): ReleaseState {
  const targets = releaseTargets(doc, sel)
  if (!doc || !targets.length) return { targets, blocker: null }
  const reasons = targets.map((p) => releaseBlocker(doc, p))
  return { targets, blocker: reasons.includes(null) ? null : reasons[0] }
}

export function canRelease(): boolean {
  return releaseTargets().length > 0
}

/**
 * Releases the selected precomp layers as one undo step and selects the released layers.
 * Layers that cannot be released are reported; so are the (rare) visual differences a release
 * cannot avoid: content the composition clipped, opacity and blend modes of several layers.
 */
export function releaseSelection(): boolean {
  const doc = getDoc()
  const targets = releaseTargets(doc)
  if (!doc || !targets.length) return false
  const t = getT()
  const reasons = targets.map((p) => releaseBlocker(doc, p))
  const releasable = targets.filter((_, k) => reasons[k] === null)
  const firstReason = reasons.find((r): r is ReleaseBlocker => r !== null)
  if (!releasable.length) {
    const name =
      targets.length === 1
        ? layerDisplayName(
            getAt<Layer>(doc, targets[0])!,
            targets[0][targets[0].length - 1] as number,
            t,
          )
        : null
    toast.error(name ? t.layers.release.failedOne(name) : t.layers.release.failedMany, {
      description: firstReason ? releaseBlockerHint(firstReason, t) : undefined,
    })
    return false
  }
  // Measured on the untouched document (reading through immer drafts is much slower).
  const reveals = releasable.some((p) => releaseRevealsContent(doc, p))
  let result: ReleaseResult | null = null
  const changed = updateDoc(
    t.layers.history.release(releasable.length),
    (d) => {
      result = releasePrecomps(d as Animation, releasable)
    },
    { selection: () => selectionOf((result as ReleaseResult | null)?.layers ?? []) },
  )
  const done = result as ReleaseResult | null
  if (!changed || !done) return false
  carryViewState(doc, done.origins)

  if (releasable.length < targets.length && firstReason) {
    toast.warning(t.layers.release.skipped(targets.length - releasable.length), {
      description: releaseBlockerHint(firstReason, t),
    })
  }
  const notes = [
    reveals ? t.layers.release.reveals : null,
    done.splitOpacity ? t.layers.release.opacity : null,
    done.blendModes ? t.layers.release.blendModes : null,
  ].filter((n): n is string => !!n)
  if (notes.length) toast.warning(t.layers.release.changed, { description: notes.join(' ') })
  return true
}
