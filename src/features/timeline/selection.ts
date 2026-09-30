/**
 * Selection helpers for the timeline: which node owns a property's keyframes, applying
 * keyframe selections, and a lookup index for rendering.
 */
import { getAt, layerPathOf, pathKey, type NodePath } from '@/lottie/path'
import type { KeyRef } from '@/lottie/timeline-ops'
import type { Animation } from '@/lottie/types'
import { getDoc, setSelection, type Selection } from '@/store/document'

/**
 * Node selected together with a property's keyframes: the shape item holding it (the group
 * for a group's transform) or the layer.
 */
export function ownerOfProperty(doc: Animation, propPath: NodePath): NodePath {
  for (let i = propPath.length - 2; i >= 0; i--) {
    const seg = propPath[i]
    if (seg === 'layers' && typeof propPath[i + 1] === 'number') break
    if ((seg === 'shapes' || seg === 'it') && typeof propPath[i + 1] === 'number') {
      const itemPath = propPath.slice(0, i + 2)
      const item = getAt<{ ty?: string }>(doc, itemPath)
      if (item?.ty === 'tr' && seg === 'it') return propPath.slice(0, i)
      return itemPath
    }
  }
  return layerPathOf(propPath) ?? propPath
}

export const refKey = (r: KeyRef) => `${pathKey(r.path)}#${r.index}`

let selfSelecting = 0

/** True while the timeline itself is changing the selection (no auto-reveal then). */
export function isSelfSelecting(): boolean {
  return selfSelecting > 0
}

/** Runs a selection change that originates in the timeline. */
export function selectFromTimeline(fn: () => void): void {
  selfSelecting++
  try {
    fn()
  } finally {
    selfSelecting--
  }
}

function uniquePaths(paths: readonly NodePath[]): NodePath[] {
  const seen = new Set<string>()
  const out: NodePath[] = []
  for (const p of paths) {
    const key = pathKey(p)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

function singleProperty(refs: readonly KeyRef[]): NodePath | null {
  if (refs.length === 0) return null
  const first = pathKey(refs[0].path)
  return refs.every((r) => pathKey(r.path) === first) ? refs[0].path : null
}

export type KeySelectMode = 'replace' | 'add' | 'remove'

export interface SelectKeysOptions {
  /** Property to focus; defaults to the single property of the result (or none). */
  focus?: NodePath | null
  /** Keep the selected nodes (live marquee) instead of selecting the keys' owners. */
  keepNodes?: boolean
  /** Nodes to select instead of the keys' owners (e.g. the layer of a summary key). */
  nodes?: NodePath[]
}

/** Selects keyframes and, unless told otherwise, the nodes that own them. */
export function selectKeys(
  refs: readonly KeyRef[],
  mode: KeySelectMode,
  opts: SelectKeysOptions = {},
): void {
  const doc = getDoc()
  if (!doc) return
  selectFromTimeline(() =>
    setSelection((prev) => {
      let keyframes: KeyRef[]
      if (mode === 'replace') keyframes = [...refs]
      else {
        const change = new Set(refs.map(refKey))
        const kept = prev.keyframes.filter((k) => !change.has(refKey(k)))
        keyframes = mode === 'add' ? [...kept, ...refs] : kept
      }
      const owners = uniquePaths(keyframes.map((k) => ownerOfProperty(doc, k.path)))
      const nodes = opts.nodes ?? (opts.keepNodes || owners.length === 0 ? prev.nodes : owners)
      const property = opts.focus !== undefined ? opts.focus : singleProperty(keyframes)
      return { nodes, keyframes, property }
    }),
  )
}

/**
 * Selection resolver for `updateDoc(…, { selection })` after an edit that produced new
 * keyframe refs: selects them with their owners (evaluated against the edited document).
 */
export function selectionWithKeys(refs: () => readonly KeyRef[], focus?: NodePath | null) {
  return (doc: Animation): Selection => {
    const keyframes = [...refs()]
    const owners = uniquePaths(keyframes.map((k) => ownerOfProperty(doc, k.path)))
    return {
      nodes: owners,
      keyframes,
      property: focus !== undefined ? focus : singleProperty(keyframes),
    }
  }
}

/** Clears the keyframe selection (and the focused property), keeping selected nodes. */
export function clearKeySelection(): void {
  selectFromTimeline(() =>
    setSelection((prev) =>
      prev.keyframes.length === 0 && prev.property === null
        ? prev
        : { ...prev, keyframes: [], property: null },
    ),
  )
}

/* -------------------------------------------------------------------------- */
/*                               Rendering index                              */
/* -------------------------------------------------------------------------- */

export interface SelectionIndex {
  /** Selected node path keys. */
  nodes: Set<string>
  /** Primary (last) selected node. */
  primary: string | null
  /** Property path key → selected keyframe indices. */
  keys: Map<string, Set<number>>
  /** Focused property path key. */
  property: string | null
  keyCount: number
}

const indexCache = new WeakMap<Selection, SelectionIndex>()

export function indexSelection(sel: Selection): SelectionIndex {
  const cached = indexCache.get(sel)
  if (cached) return cached
  const keys = new Map<string, Set<number>>()
  for (const k of sel.keyframes) {
    const key = pathKey(k.path)
    let set = keys.get(key)
    if (!set) {
      set = new Set()
      keys.set(key, set)
    }
    set.add(k.index)
  }
  const index: SelectionIndex = {
    nodes: new Set(sel.nodes.map(pathKey)),
    primary: sel.nodes.length ? pathKey(sel.nodes[sel.nodes.length - 1]) : null,
    keys,
    property: sel.property ? pathKey(sel.property) : null,
    keyCount: sel.keyframes.length,
  }
  indexCache.set(sel, index)
  return index
}

export function isRefSelected(index: SelectionIndex, ref: KeyRef): boolean {
  return index.keys.get(pathKey(ref.path))?.has(ref.index) ?? false
}
