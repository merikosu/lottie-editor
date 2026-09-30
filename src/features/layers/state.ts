/**
 * View state of the layer tree and editor-only layer state (lock, solo). None of it is part of
 * the document or its undo history.
 *
 * Keys are stable node/row keys (see keys.ts), remapped on every document change so expansion,
 * locks and solo follow nodes when they are reordered.
 */
import { create } from 'zustand'
import { isLayerPath, isShapePath, pathKey, type NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { getDoc, useDocument } from '@/store/document'
import { setHoverNode, setSoloNodes, useUi } from '@/store/ui'
import { nodeKeyOf, pathOfNodeKey, remapKey, remapRecord } from './keys'

export interface RevealRequest {
  path: NodePath
  /** Start inline rename once revealed. */
  rename?: boolean
  /** Follows a selection change: never clears the search filter to show the node. */
  soft?: boolean
  /** Precomp layers to reveal precomp content through (the one it was selected through). */
  prefer?: NodePath[]
  /** Distinguishes repeated requests for the same path. */
  nonce: number
}

export interface LayersViewState {
  /** Expanded rows (row keys). */
  expanded: Record<string, true>
  search: string
  /** Row being renamed inline. */
  renaming: string | null
  /** Keyboard cursor row (aria-activedescendant). */
  focusKey: string | null
  /** Anchor row for Shift range selection. */
  anchorKey: string | null
  /** Node to reveal (expand ancestors and scroll into view) when the tree renders. */
  reveal: RevealRequest | null
  /** Locked nodes (node keys): not selectable on the canvas. */
  locked: Record<string, true>
  /** Soloed layers (node keys): the preview hides other layers of their compositions. */
  solo: Record<string, true>
}

const initial: LayersViewState = {
  expanded: {},
  search: '',
  renaming: null,
  focusKey: null,
  anchorKey: null,
  reveal: null,
  locked: {},
  solo: {},
}

export const useLayersView = create<LayersViewState>()(() => ({ ...initial }))

const set = (
  patch: Partial<LayersViewState> | ((s: LayersViewState) => Partial<LayersViewState>),
) => useLayersView.setState(patch)

/* ---------------------------------- Tree ---------------------------------- */

export function setSearch(search: string): void {
  set({ search })
}

export function setExpanded(keys: readonly string[], expanded: boolean): void {
  set((s) => {
    const next = { ...s.expanded }
    let changed = false
    for (const key of keys) {
      if (expanded && !next[key]) {
        next[key] = true
        changed = true
      } else if (!expanded && next[key]) {
        delete next[key]
        changed = true
      }
    }
    return changed ? { expanded: next } : {}
  })
}

/** Collapses rows and everything below them (keys under the given row keys). */
export function collapseSubtrees(keys: readonly string[]): void {
  set((s) => {
    const next: Record<string, true> = {}
    let changed = false
    for (const key of Object.keys(s.expanded)) {
      const inside = keys.some(
        (k) => key === k || (key.startsWith(k) && '|.>'.includes(key.charAt(k.length))),
      )
      if (inside) changed = true
      else next[key] = true
    }
    return changed ? { expanded: next } : {}
  })
}

export function toggleExpanded(key: string): void {
  setExpanded([key], !useLayersView.getState().expanded[key])
}

export function collapseAll(): void {
  set({ expanded: {} })
}

export function startRename(rowKey: string): void {
  set({ renaming: rowKey, focusKey: rowKey })
}

export function stopRename(): void {
  set({ renaming: null })
}

export function setFocusKey(focusKey: string | null, anchor = false): void {
  set(anchor ? { focusKey, anchorKey: focusKey } : { focusKey })
}

let revealNonce = 0

/** Asks the tree to reveal a node (and optionally rename it) as soon as it renders. */
export function requestReveal(
  path: NodePath,
  opts: { rename?: boolean; soft?: boolean; prefer?: NodePath[] } = {},
): void {
  set({
    reveal: {
      path,
      rename: opts.rename,
      soft: opts.soft,
      prefer: opts.prefer,
      nonce: ++revealNonce,
    },
  })
}

export function clearReveal(nonce: number): void {
  set((s) => (s.reveal?.nonce === nonce ? { reveal: null } : {}))
}

/** Completes a reveal in one update: moves the keyboard cursor to the row (and renames it). */
export function finishReveal(nonce: number, rowKey: string, rename: boolean): void {
  set((s) => ({
    reveal: s.reveal?.nonce === nonce ? null : s.reveal,
    focusKey: rowKey,
    anchorKey: rowKey,
    ...(rename ? { renaming: rowKey } : null),
  }))
}

/* ------------------------------- Lock & solo ------------------------------- */

const LOCKS_STORAGE = 'lottie-editor:layer-locks'
const MAX_REMEMBERED_DOCS = 20

type LockMemory = Record<string, { keys: string[]; time: number }>

function readMemory(): LockMemory {
  try {
    const raw = localStorage.getItem(LOCKS_STORAGE)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as LockMemory) : {}
  } catch {
    return {}
  }
}

/** Locks survive reloads (autosave restores documents with the same session id). */
function rememberLocks(docId: string | null, locked: Record<string, true>): void {
  if (!docId) return
  try {
    const memory = readMemory()
    const keys = Object.keys(locked)
    if (keys.length) memory[docId] = { keys, time: Date.now() }
    else delete memory[docId]
    const kept = Object.entries(memory)
      .sort((a, b) => b[1].time - a[1].time)
      .slice(0, MAX_REMEMBERED_DOCS)
    localStorage.setItem(LOCKS_STORAGE, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Storage full or unavailable: locks still work for this session.
  }
}

function recalledLocks(docId: string | null): Record<string, true> {
  if (!docId) return {}
  const entry = readMemory()[docId]
  return Array.isArray(entry?.keys)
    ? Object.fromEntries(entry.keys.map((k) => [String(k), true as const]))
    : {}
}

function currentDocId(): string | null {
  return useDocument.getState().meta?.id ?? null
}

function keysOf(doc: Animation, paths: readonly NodePath[]): string[] {
  return paths.map((p) => nodeKeyOf(doc, p)).filter((k): k is string => !!k)
}

/** Locks or unlocks nodes (layers and shape items). */
export function setLocked(paths: readonly NodePath[], locked: boolean): void {
  const doc = getDoc()
  if (!doc) return
  const next = { ...useLayersView.getState().locked }
  for (const key of keysOf(doc, paths)) {
    if (locked) next[key] = true
    else delete next[key]
  }
  set({ locked: next })
  rememberLocks(currentDocId(), next)
}

/** Solos or unsolos layers (shape items are ignored: solo hides whole layers). */
export function setSolo(paths: readonly NodePath[], solo: boolean): void {
  const doc = getDoc()
  if (!doc) return
  const next = { ...useLayersView.getState().solo }
  for (const key of keysOf(doc, paths.filter(isLayerPath))) {
    if (solo) next[key] = true
    else delete next[key]
  }
  set({ solo: next })
  syncSolo()
}

function ancestry(path: NodePath): NodePath[] {
  const out: NodePath[] = []
  for (let n = path.length; n >= 2; n--) {
    const p = path.slice(0, n)
    if (isLayerPath(p) || isShapePath(p)) out.push(p)
  }
  return out
}

/**
 * True if the node at `path` — or the layer/group containing it — is locked. Locked nodes
 * cannot be selected on the canvas (they stay selectable in the layer tree).
 */
export function isNodeLocked(path: NodePath, doc: Animation | null = getDoc()): boolean {
  return lockedIn(useLayersView.getState().locked, path, doc)
}

function lockedIn(
  locked: Record<string, true>,
  path: NodePath | null | undefined,
  doc: Animation | null,
): boolean {
  if (!doc || !path?.length || Object.keys(locked).length === 0) return false
  return ancestry(path).some((p) => {
    const key = nodeKeyOf(doc, p)
    return !!key && !!locked[key]
  })
}

/**
 * Reactive `isNodeLocked`. Re-renders only when the answer changes: edits of the document
 * (every step of a drag) re-run the cheap check without re-rendering the caller.
 */
export function useNodeLocked(path: NodePath | null | undefined): boolean {
  const locked = useLayersView((s) => s.locked)
  return useDocument((s) => lockedIn(locked, path, s.doc))
}

export function isNodeSoloed(path: NodePath, doc: Animation | null = getDoc()): boolean {
  const key = doc ? nodeKeyOf(doc, path) : null
  return !!key && !!useLayersView.getState().solo[key]
}

/** Publishes solo as paths for the preview (ui.soloNodes), resolved in the current document. */
function syncSolo(doc: Animation | null = getDoc()): void {
  const keys = Object.keys(useLayersView.getState().solo)
  const paths = doc ? keys.map((k) => pathOfNodeKey(doc, k)).filter((p): p is NodePath => !!p) : []
  const current = useUi.getState().soloNodes
  const same =
    current.length === paths.length && current.every((p, i) => pathKey(p) === pathKey(paths[i]))
  if (!same) setSoloNodes(paths)
}

/* ------------------------------ Document sync ------------------------------ */

function resetForDocument(docId: string | null): void {
  useLayersView.setState({ ...initial, locked: recalledLocks(docId) })
}

function remapAll(prev: Animation, next: Animation): void {
  const s = useLayersView.getState()
  const patch: Partial<LayersViewState> = {}
  const expanded = remapRecord(s.expanded, prev, next)
  if (expanded !== s.expanded) patch.expanded = expanded
  const locked = remapRecord(s.locked, prev, next)
  if (locked !== s.locked) patch.locked = locked
  const solo = remapRecord(s.solo, prev, next)
  if (solo !== s.solo) patch.solo = solo
  for (const field of ['focusKey', 'anchorKey', 'renaming'] as const) {
    const key = s[field]
    const mapped = key ? remapKey(key, prev, next) : key
    if (mapped !== key) patch[field] = mapped
  }
  if (Object.keys(patch).length) useLayersView.setState(patch)
  if (patch.locked) rememberLocks(currentDocId(), patch.locked)
}

/**
 * The hovered node (tree, canvas or timeline) is a path: once an edit moves or removes that node
 * the path names another one, whose outline would light up on the canvas until the pointer
 * moves. Drop the hover then; the next pointer move sets it again.
 */
function dropStaleHover(prev: Animation, next: Animation): void {
  const hover = useUi.getState().hoverNode
  if (!hover || (!isLayerPath(hover) && !isShapePath(hover))) return
  const key = nodeKeyOf(prev, hover)
  const path = key ? pathOfNodeKey(next, remapKey(key, prev, next)) : null
  if (!path || pathKey(path) !== pathKey(hover)) setHoverNode(null)
}

/**
 * Keeps the view state in sync with the document: a new document resets it (restoring
 * remembered locks); edits remap keys of moved shape items and republish solo paths.
 * Returns an unsubscribe function.
 */
export function installLayersSync(): () => void {
  let lastDoc = useDocument.getState().doc
  let lastId = currentDocId()
  resetForDocument(lastId)
  syncSolo(lastDoc)
  return useDocument.subscribe((s) => {
    const id = s.meta?.id ?? null
    if (s.doc === lastDoc && id === lastId) return
    const prevDoc = lastDoc
    const prevId = lastId
    lastDoc = s.doc
    lastId = id
    if (id !== prevId) {
      resetForDocument(id)
      if (useUi.getState().hoverNode) setHoverNode(null)
    } else if (prevDoc && s.doc) {
      remapAll(prevDoc, s.doc)
      dropStaleHover(prevDoc, s.doc)
    }
    syncSolo(s.doc)
  })
}
