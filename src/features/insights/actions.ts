/**
 * Actions of the insights feature: fixing issues (one undo step each), showing where they are,
 * and opening the tools that resolve the rest.
 *
 * Fixes never trust the paths of the last analysis: they validate the current document again
 * and apply the issue with the same id, so an edit made after the analysis cannot redirect a
 * fix to the wrong node.
 */
import { layout } from '@/app/layout'
import { currentRoute, navigate } from '@/app/router'
import { runCommand } from '@/commands/registry'
import { toast } from '@/components/ui'
import { getT, type Language } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { emit } from '@/lib/events'
import { arr, isObj } from '@/lottie/compat'
import { pathKey, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import {
  applyFixes,
  canFix,
  issuesForTarget,
  isGlobalFix,
  validate,
  type FixId,
  type Issue,
} from '@/lottie/validate'
import {
  EMPTY_SELECTION,
  getDoc,
  selectNodes,
  setSelection,
  updateDoc,
  type KeyframeRef,
} from '@/store/document'
import { setPrefs, usePrefs } from '@/store/prefs'
import { scheduleAnalysis } from './engine'
import {
  describeIssue,
  issueTitle,
  showTarget,
  type FormatOptions,
  type ToolAction,
} from './format'
import { markFixed, useAnalysis, useInsightsPrefs } from './store'

/** Fixes that remove or move nodes: selected paths could point at other nodes afterwards. */
const STRUCTURAL_FIXES = new Set<FixId>([
  'removeItem',
  'removeOrphanMatte',
  'removeCameras',
  'removeDisabledEffect',
  'moveMatteSource',
  'removeUnusedAssets',
])

function formatOptions(): FormatOptions {
  return { t: getT(), lang: usePrefs.getState().language as Language }
}

/** The issue as it is in the current document (null when it is gone). */
function currentIssue(doc: Animation, id: string): Issue | null {
  return validate(doc).find((i) => i.id === id) ?? null
}

/** True when a fix can be limited to one place (see `isGlobalFix`). */
export function canFixPlace(issue: Issue): boolean {
  return !!issue.fix && !isGlobalFix(issue.fix) && issue.paths.length > 1
}

/**
 * Applies the fix of an issue as one undo step, everywhere or only at `only` (paths of the
 * issue). Returns false when there was nothing to change.
 */
export function fixIssue(issue: Issue, only?: readonly NodePath[]): boolean {
  const doc = getDoc()
  if (!doc) return false
  const fresh = currentIssue(doc, issue.id)
  if (!fresh || !canFix(fresh)) {
    // Already gone (fixed elsewhere or edited away): let the next analysis confirm it.
    markFixed([issue.id])
    scheduleAnalysis({ immediate: true })
    return false
  }
  const o = formatOptions()
  const label = o.t.insights.history.fix(issueTitle(fresh, o, doc))
  const structural = STRUCTURAL_FIXES.has(fresh.fix!)
  const changed = updateDoc(
    label,
    (draft) => {
      applyFixes(draft as Animation, [fresh], only)
    },
    structural ? { selection: EMPTY_SELECTION } : undefined,
  )
  if (!only || only.length >= fresh.paths.length) markFixed([issue.id])
  scheduleAnalysis({ immediate: true })
  return changed
}

/** Safe fixes available for the chosen players in the current document. */
export function safeFixes(doc: Animation): Issue[] {
  const target = useInsightsPrefs.getState().target
  return issuesForTarget(validate(doc), target).filter((i) => i.safe === true && canFix(i))
}

/** Applies every safe fix for the chosen players as one undo step. Returns the number of issues fixed. */
export function fixAllSafe(): number {
  const doc = getDoc()
  if (!doc) return 0
  const fixes = safeFixes(doc)
  if (!fixes.length) return 0
  const t = getT()
  let fixed = 0
  const structural = fixes.some((i) => STRUCTURAL_FIXES.has(i.fix!))
  updateDoc(
    t.insights.history.fixAll(fixes.length),
    (draft) => {
      fixed = applyFixes(draft as Animation, fixes)
    },
    structural ? { selection: EMPTY_SELECTION } : undefined,
  )
  markFixed(fixes.map((i) => i.id))
  scheduleAnalysis({ immediate: true })
  return fixed
}

/** Number of safe fixes in the last analysis for the chosen players (cheap: no validation). */
export function fixableCount(): number {
  const issues = useAnalysis.getState().result?.issues
  if (!issues) return 0
  const target = useInsightsPrefs.getState().target
  return issuesForTarget(issues, target).filter((i) => i.safe === true && canFix(i)).length
}

/* ---------------------------------- Show ----------------------------------- */

/** Layers of the current document that use an asset (precomp or image) by index. */
function layersUsingAsset(doc: Animation, assetIndex: number): NodePath[] {
  const asset = arr((doc as unknown as { assets?: unknown }).assets)[assetIndex]
  if (!isObj(asset) || asset.id === undefined) return []
  const id = asset.id
  const out: NodePath[] = []
  const visit = (layers: unknown, base: NodePath) => {
    arr(layers).forEach((l, i) => {
      if (isObj(l) && l.refId === id) out.push([...base, i])
    })
  }
  visit(doc.layers, ['layers'])
  arr((doc as unknown as { assets?: unknown }).assets).forEach((a, i) => {
    if (isObj(a) && Array.isArray(a.layers)) visit(a.layers, ['assets', i, 'layers'])
  })
  return out
}

/**
 * Selects what the given issue paths point at: layers and shape items (revealed in the layer
 * tree and timeline), with the property and keyframe focused when there is exactly one place.
 * Asset paths select the layers using the asset and open the Assets panel.
 */
export function showPlaces(paths: readonly NodePath[]): void {
  const doc = getDoc()
  if (!doc || !paths.length) return
  const targets = paths.map((p) => showTarget(doc, p))
  const seen = new Set<string>()
  const nodes: NodePath[] = []
  for (const target of targets) {
    if (!target.node) continue
    const key = pathKey(target.node)
    if (seen.has(key)) continue
    seen.add(key)
    nodes.push(target.node)
  }
  if (nodes.length) {
    const single = targets.length === 1 ? targets[0] : null
    const keyframes: KeyframeRef[] = single?.keyframe ? [single.keyframe] : []
    setSelection({ nodes, keyframes, property: single?.property ?? null })
    emit('reveal-node', { path: nodes[nodes.length - 1] })
    return
  }
  const assets = targets.flatMap((t) => (t.asset === null ? [] : [t.asset]))
  if (assets.length) {
    const layers = assets.flatMap((a) => layersUsingAsset(doc, a))
    if (layers.length) selectNodes(layers)
    runCommand('assets.show')
  }
}

/** Shows a place in the JSON view. */
export function showInJson(path: NodePath): void {
  emit('reveal-code', { path })
}

/** Copies a plain-text description of an issue. */
export async function copyIssue(issue: Issue): Promise<void> {
  const o = formatOptions()
  const doc = useAnalysis.getState().doc
  const ok = await copyText(describeIssue(issue, o, doc))
  if (!ok) toast.error(o.t.common.somethingWentWrong)
}

/* ---------------------------------- Tools ---------------------------------- */

/** Opens the optimizer for the current document (the optimizer service owns the command). */
export function openOptimizer(): void {
  if (runCommand('anim.optimize')) return
  navigate('optimize')
}

/** Runs the tool that helps with an issue that has no automatic fix. */
export function runTool(action: ToolAction): void {
  switch (action) {
    case 'resize':
      runCommand('anim.resize')
      break
    case 'timing':
      runCommand('anim.timing')
      break
    case 'optimize':
      openOptimizer()
      break
    case 'locate':
      runCommand('assets.embedMissing')
      break
    case 'fonts':
      runCommand('assets.show')
      break
  }
}

/** Switches to the editor's Issues tab (expanding the right sidebar when it is collapsed). */
export function openIssuesPanel(): void {
  if (currentRoute() !== 'edit') navigate('edit')
  setPrefs({ rightTab: 'issues' })
  // The layout API is installed by the workspace; after a route change it mounts on the next frame.
  requestAnimationFrame(() => {
    if (layout().isRightCollapsed()) layout().toggleRight()
  })
}
