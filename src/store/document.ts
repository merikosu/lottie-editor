/**
 * The document store: the Lottie JSON being edited, its undo/redo history and the selection.
 *
 * - The document is an immutable (frozen) tree; every edit goes through `updateDoc`, which
 *   runs an immer recipe and records patches for undo/redo.
 * - Continuous gestures (scrubbing a number, dragging a color picker, moving keyframes)
 *   pass the same `coalesceKey` for every update of the gesture so they become ONE history
 *   entry.
 * - `revision` increments on every change (including undo/redo); renderers and autosave
 *   subscribe to it.
 */
import {
  applyPatches,
  enablePatches,
  freeze,
  produceWithPatches,
  type Draft,
  type Patch,
} from 'immer'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { getAt, pathEquals, pathKey, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { uid } from '@/lib/id'

enablePatches()

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

/** Reference to a keyframe: the property path and the keyframe index in `k`. */
export interface KeyframeRef {
  path: NodePath
  index: number
}

export interface Selection {
  /** Selected layers and/or shape items (JSON paths). The last one is the primary. */
  nodes: NodePath[]
  /** Selected keyframes. */
  keyframes: KeyframeRef[]
  /** Property focused in the timeline/inspector (e.g. for keyframe navigation). */
  property: NodePath | null
}

export const EMPTY_SELECTION: Selection = Object.freeze({
  nodes: [],
  keyframes: [],
  property: null,
}) as Selection

export type SourceFormat = 'json' | 'lottie'

export interface DocumentMeta {
  /** Editor-session id of this document (autosave key). */
  id: string
  fileName: string
  format: SourceFormat
  /** Opaque dotLottie container data needed to re-export (owned by the io feature). */
  dotLottie?: unknown
  /** Size of the source file in bytes, if known. */
  sourceSize?: number
  loadedAt: number
}

export interface HistoryEntry {
  id: number
  label: string
  patches: Patch[]
  inverse: Patch[]
  selectionBefore: Selection
  selectionAfter: Selection
  time: number
  coalesceKey?: string
  /** True once the gesture that produced this entry has ended. */
  closed?: boolean
}

export interface DocumentState {
  doc: Animation | null
  meta: DocumentMeta | null
  /** The document as it was loaded (for "compare with original" and revert). */
  original: Animation | null
  revision: number
  savedRevision: number
  past: HistoryEntry[]
  future: HistoryEntry[]
  selection: Selection
}

export interface UpdateOptions {
  /**
   * Updates with the same key merge into one history entry: freely while the gesture is in
   * progress, and within COALESCE_MS after it ended (e.g. repeated arrow-key nudges).
   */
  coalesceKey?: string
  /**
   * Gesture state: `false` while the gesture is in progress (merges regardless of time),
   * `true` for its last update (merges, then closes the entry). When omitted, updates with the
   * same key only merge within COALESCE_MS.
   */
  final?: boolean
  /** New selection after the change (defaults to the current one, pruned). */
  selection?: Selection | ((doc: Animation) => Selection)
}

const HISTORY_LIMIT = 300
const COALESCE_MS = 1500

let nextEntryId = 1

/* -------------------------------------------------------------------------- */
/*                                    Store                                   */
/* -------------------------------------------------------------------------- */

export const useDocument = create<DocumentState>()(
  subscribeWithSelector((): DocumentState => ({
    doc: null,
    meta: null,
    original: null,
    revision: 0,
    savedRevision: 0,
    past: [],
    future: [],
    selection: EMPTY_SELECTION,
  })),
)

/** Current document (non-reactive read). */
export function getDoc(): Animation | null {
  return useDocument.getState().doc
}

/** Current document; throws if none is open. Use inside commands that require a document. */
export function requireDoc(): Animation {
  const doc = getDoc()
  if (!doc) throw new Error('No document is open')
  return doc
}

/* ---------------------------------- Hooks --------------------------------- */

/** Reactive document (null when nothing is open). */
export function useDoc(): Animation | null {
  return useDocument((s) => s.doc)
}

export function useSelection(): Selection {
  return useDocument((s) => s.selection)
}

/**
 * Reactive value at a JSON path. Thanks to structural sharing it only re-renders when that
 * part of the document changes.
 */
export function useNodeAt<T = unknown>(path: NodePath | null | undefined): T | undefined {
  return useDocument((s) => (s.doc && path ? getAt<T>(s.doc, path) : undefined))
}

/* -------------------------------------------------------------------------- */
/*                                  Lifecycle                                 */
/* -------------------------------------------------------------------------- */

export interface LoadOptions {
  fileName: string
  format?: SourceFormat
  dotLottie?: unknown
  sourceSize?: number
  /** Reuse an id (e.g. when restoring an autosaved session). */
  id?: string
  /** The "original" to compare/revert against (defaults to `doc`), e.g. when restoring a session. */
  original?: Animation
  /** Start in the dirty state (changes not yet downloaded/exported), e.g. when restoring. */
  dirty?: boolean
}

/** Opens a document, replacing the current one and resetting history and selection. */
export function loadDocument(doc: Animation, opts: LoadOptions): void {
  // JSON copy: detaches the caller's object and breaks any shared references.
  const frozen = freeze(JSON.parse(JSON.stringify(doc)) as Animation, true)
  const original = opts.original
    ? freeze(JSON.parse(JSON.stringify(opts.original)) as Animation, true)
    : frozen
  useDocument.setState((s) => ({
    doc: frozen,
    original,
    meta: {
      id: opts.id ?? uid('doc'),
      fileName: opts.fileName,
      format: opts.format ?? 'json',
      dotLottie: opts.dotLottie,
      sourceSize: opts.sourceSize,
      loadedAt: Date.now(),
    },
    revision: s.revision + 1,
    savedRevision: opts.dirty ? s.revision : s.revision + 1,
    past: [],
    future: [],
    selection: EMPTY_SELECTION,
  }))
}

export function closeDocument(): void {
  useDocument.setState((s) => ({
    doc: null,
    original: null,
    meta: null,
    revision: s.revision + 1,
    savedRevision: s.revision + 1,
    past: [],
    future: [],
    selection: EMPTY_SELECTION,
  }))
}

export function setDocumentMeta(patch: Partial<Omit<DocumentMeta, 'id'>>): void {
  useDocument.setState((s) => (s.meta ? { meta: { ...s.meta, ...patch } } : {}))
}

/** Marks the current revision as saved/exported (clears the dirty indicator). */
export function markSaved(): void {
  useDocument.setState((s) => ({ savedRevision: s.revision }))
}

export function isDirty(s: DocumentState = useDocument.getState()): boolean {
  return s.doc !== null && s.revision !== s.savedRevision
}

/* -------------------------------------------------------------------------- */
/*                                   Editing                                  */
/* -------------------------------------------------------------------------- */

function resolveSelection(
  opts: UpdateOptions | undefined,
  doc: Animation,
  current: Selection,
): Selection {
  const next = opts?.selection
  if (typeof next === 'function') return next(doc)
  if (next) return next
  return pruneSelection(doc, current)
}

function commit(
  label: string,
  nextDoc: Animation,
  patches: Patch[],
  inverse: Patch[],
  opts: UpdateOptions | undefined,
): void {
  const s = useDocument.getState()
  const selectionAfter = resolveSelection(opts, nextDoc, s.selection)
  const now = Date.now()
  const last = s.past[s.past.length - 1]
  let past: HistoryEntry[]

  if (
    opts?.coalesceKey &&
    last &&
    last.coalesceKey === opts.coalesceKey &&
    s.future.length === 0 &&
    (!last.closed || now - last.time < COALESCE_MS)
  ) {
    const merged: HistoryEntry = {
      ...last,
      patches: last.patches.concat(patches),
      inverse: inverse.concat(last.inverse),
      selectionAfter,
      time: now,
      closed: opts.final !== false,
    }
    past = s.past.slice(0, -1).concat(merged)
  } else {
    const entry: HistoryEntry = {
      id: nextEntryId++,
      label,
      patches,
      inverse,
      selectionBefore: s.selection,
      selectionAfter,
      time: now,
      coalesceKey: opts?.coalesceKey,
      closed: !opts?.coalesceKey || opts.final !== false,
    }
    past = s.past.concat(entry)
    if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT)
  }

  useDocument.setState({
    doc: nextDoc,
    past,
    future: [],
    selection: selectionAfter,
    revision: s.revision + 1,
  })
}

/**
 * Applies an edit to the document as one undoable step.
 * Returns false when there is no document or the recipe changed nothing.
 *
 * @example
 * updateDoc(t.inspector.changeOpacity, (d) => { d.layers[0].ks.o!.k = 50 }, { coalesceKey: gestureId })
 */
export function updateDoc(
  label: string,
  recipe: (draft: Draft<Animation>) => void,
  opts?: UpdateOptions,
): boolean {
  const doc = getDoc()
  if (!doc) return false
  const [nextDoc, patches, inverse] = produceWithPatches(doc, (draft) => {
    recipe(draft)
  })
  if (patches.length === 0) {
    if (opts?.selection) setSelection(resolveSelection(opts, doc, useDocument.getState().selection))
    return false
  }
  commit(label, nextDoc, patches, inverse, opts)
  return true
}

/**
 * Replaces the whole document as one undoable step (cheap for large rewrites such as
 * applying the JSON editor or the optimizer).
 */
export function replaceDoc(label: string, nextDoc: Animation, opts?: UpdateOptions): void {
  const doc = getDoc()
  if (!doc) return
  const frozen = freeze(nextDoc, true)
  commit(
    label,
    frozen,
    [{ op: 'replace', path: [], value: frozen }],
    [{ op: 'replace', path: [], value: doc }],
    opts,
  )
}

/* -------------------------------------------------------------------------- */
/*                                 Undo / redo                                */
/* -------------------------------------------------------------------------- */

export function canUndo(): boolean {
  return useDocument.getState().past.length > 0
}

export function canRedo(): boolean {
  return useDocument.getState().future.length > 0
}

export function undo(): HistoryEntry | null {
  const s = useDocument.getState()
  const entry = s.past[s.past.length - 1]
  if (!s.doc || !entry) return null
  const doc = applyPatches(s.doc, entry.inverse)
  useDocument.setState({
    doc,
    past: s.past.slice(0, -1),
    future: [entry, ...s.future],
    selection: pruneSelection(doc, entry.selectionBefore),
    revision: s.revision + 1,
  })
  return entry
}

export function redo(): HistoryEntry | null {
  const s = useDocument.getState()
  const entry = s.future[0]
  if (!s.doc || !entry) return null
  const doc = applyPatches(s.doc, entry.patches)
  useDocument.setState({
    doc,
    past: [...s.past, entry],
    future: s.future.slice(1),
    selection: pruneSelection(doc, entry.selectionAfter),
    revision: s.revision + 1,
  })
  return entry
}

/**
 * Jumps to a point in history: `index` = number of entries of `past` to keep
 * (0 = the state right after loading).
 */
export function jumpToHistory(index: number): void {
  const s = useDocument.getState()
  const total = s.past.length + s.future.length
  const target = Math.max(0, Math.min(total, index))
  let guard = total + 1
  while (useDocument.getState().past.length > target && guard-- > 0) undo()
  while (useDocument.getState().past.length < target && guard-- > 0) redo()
}

/* -------------------------------------------------------------------------- */
/*                                  Selection                                 */
/* -------------------------------------------------------------------------- */

/** Drops selected paths that no longer resolve to an object in `doc`. */
export function pruneSelection(doc: Animation, sel: Selection): Selection {
  const exists = (p: NodePath) => {
    const v = getAt(doc, p)
    return v !== null && typeof v === 'object'
  }
  const nodes = sel.nodes.filter(exists)
  const keyframes = sel.keyframes.filter((k) => {
    const prop = getAt<{ k?: unknown }>(doc, k.path)
    return !!prop && Array.isArray(prop.k) && k.index >= 0 && k.index < prop.k.length
  })
  const property = sel.property && exists(sel.property) ? sel.property : null
  if (
    nodes.length === sel.nodes.length &&
    keyframes.length === sel.keyframes.length &&
    property === sel.property
  ) {
    return sel
  }
  return { nodes, keyframes, property }
}

export function setSelection(next: Selection | ((prev: Selection) => Selection)): void {
  useDocument.setState((s) => ({
    selection: typeof next === 'function' ? next(s.selection) : next,
  }))
}

export type SelectMode = 'replace' | 'add' | 'toggle'

/** Selects nodes (layers / shape items). Keyframe selection is cleared on 'replace'. */
export function selectNodes(paths: NodePath[], mode: SelectMode = 'replace'): void {
  setSelection((prev) => {
    if (mode === 'replace') return { nodes: [...paths], keyframes: [], property: null }
    const keys = new Set(prev.nodes.map(pathKey))
    let nodes = [...prev.nodes]
    for (const p of paths) {
      const key = pathKey(p)
      if (keys.has(key)) {
        if (mode === 'toggle') nodes = nodes.filter((n) => pathKey(n) !== key)
      } else {
        nodes.push(p)
        keys.add(key)
      }
    }
    return { ...prev, nodes }
  })
}

export function selectKeyframes(refs: KeyframeRef[], mode: SelectMode = 'replace'): void {
  const refKey = (r: KeyframeRef) => `${pathKey(r.path)}#${r.index}`
  setSelection((prev) => {
    if (mode === 'replace') return { ...prev, keyframes: [...refs] }
    const keys = new Set(prev.keyframes.map(refKey))
    let keyframes = [...prev.keyframes]
    for (const r of refs) {
      const key = refKey(r)
      if (keys.has(key)) {
        if (mode === 'toggle') keyframes = keyframes.filter((k) => refKey(k) !== key)
      } else {
        keyframes.push(r)
        keys.add(key)
      }
    }
    return { ...prev, keyframes }
  })
}

export function focusProperty(path: NodePath | null): void {
  setSelection((prev) => (pathEquals(prev.property, path) ? prev : { ...prev, property: path }))
}

export function clearSelection(): void {
  setSelection(EMPTY_SELECTION)
}

export function isNodeSelected(sel: Selection, path: NodePath): boolean {
  return sel.nodes.some((n) => pathEquals(n, path))
}

export function isKeyframeSelected(sel: Selection, path: NodePath, index: number): boolean {
  return sel.keyframes.some((k) => k.index === index && pathEquals(k.path, path))
}

/** Primary (last) selected node, if any. */
export function primaryNode(sel: Selection): NodePath | null {
  return sel.nodes.length ? sel.nodes[sel.nodes.length - 1] : null
}
