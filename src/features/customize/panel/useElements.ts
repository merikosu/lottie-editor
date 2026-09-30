/**
 * The elements the Logos section lists: the suggestions of the replace engine and the element
 * the user picked. Finding suggestions measures every candidate over time, which is too slow to
 * repeat on every edit of a big file: it runs a moment after the document changes (at once for a
 * newly opened file), and the previous list stays up meanwhile (color edits keep its paths).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { pathKey, type NodePath } from '@/lottie/path'
import {
  findReplaceableElements,
  measureElement,
  replaceTargetKind,
  type Candidate,
  type ElementPlacement,
  type ReplaceTargetKind,
} from '@/lottie/replace'
import type { Animation } from '@/lottie/types'
import { primaryNode, useDocument } from '@/store/document'
import { instancesOf, keepOrder } from '../lib/targets'

const DEBOUNCE_MS = 250
/** Suggestions listed at most. */
const LIMIT = 24

export interface ElementItem extends ElementPlacement {
  path: NodePath
  key: string
  name: string
  target: ReplaceTargetKind
  /** Kind of a suggestion; null for an element the user picked. */
  kind: Candidate['kind'] | null
  /** Layers showing the same image or composition. */
  usage: number
}

const cache = new WeakMap<Animation, ElementItem[]>()
/** How long the last search took: big files wait longer after an edit before searching again. */
let lastCost = 0

function suggestionsOf(doc: Animation): ElementItem[] {
  let list = cache.get(doc)
  if (!list) {
    const start = performance.now()
    let found: Candidate[] = []
    try {
      found = findReplaceableElements(doc, { limit: LIMIT })
    } catch (err) {
      // A file damaged in a way the engine does not expect: no suggestions (the page still
      // works, and any element can be picked in the preview).
      console.warn('Customize: could not find replaceable elements', err)
    }
    // Texts have their own section. Plain graphics are only suggested when there is no logo or
    // image: they are often decoration, and how many qualify depends on the canvas size.
    // Watermarks are always listed (after logos and images: the engine sorts them).
    const strong = found.some((c) => c.kind === 'logo' || c.kind === 'image')
    const shown = new Set<Candidate['kind']>(
      strong ? ['logo', 'image', 'watermark'] : ['watermark', 'vector'],
    )
    list = found
      .filter((c) => shown.has(c.kind))
      .map((c) => ({
        path: c.path,
        key: pathKey(c.path),
        name: c.name,
        target: c.target,
        kind: c.kind,
        usage: c.usage ?? 1,
        frame: c.frame,
        bounds: c.bounds,
        rootFrame: c.rootFrame,
        rootBounds: c.rootBounds,
      }))
    cache.set(doc, list)
    lastCost = performance.now() - start
  }
  return list
}

/** The element a file dropped on the page replaces when nothing is selected: the top suggestion. */
export function topSuggestion(doc: Animation): NodePath | null {
  return suggestionsOf(doc)[0]?.path ?? null
}

interface Measured {
  /** Document the list was computed for. */
  doc: Animation
  docId: string | undefined
  items: ElementItem[]
}

const structures = new WeakMap<Animation, string>()

/**
 * Where the layers are: each composition's layers in order (index, type, number of shapes).
 * Rows keep valid paths through edits that leave it as it is (colors, texts, timing); a layer
 * or group removed, added or moved makes them point to other elements.
 */
export function structureOf(doc: Animation): string {
  let key = structures.get(doc)
  if (key === undefined) {
    const parts: string[] = []
    const add = (id: string, layers: unknown) => {
      if (!Array.isArray(layers)) return
      const list = layers.map((l) => {
        const layer = (l ?? {}) as { ind?: unknown; ty?: unknown; shapes?: unknown }
        const shapes = Array.isArray(layer.shapes) ? layer.shapes.length : ''
        return `${String(layer.ind)}/${String(layer.ty)}/${shapes}`
      })
      parts.push(`${id}:${list.join(',')}`)
    }
    add('', doc.layers)
    if (Array.isArray(doc.assets))
      for (const asset of doc.assets) add(asset.id, (asset as { layers?: unknown }).layers)
    key = parts.join('|')
    structures.set(doc, key)
  }
  return key
}

/**
 * Suggestions for the current document (`ready` is false until the first list of a newly
 * opened file is there), computed in the background, never while `paused`. `stale` while the
 * list belongs to a document with other layers (its paths point elsewhere): it is recomputed
 * at once then, and its rows must not act meanwhile.
 */
export function useSuggestions(paused: boolean): {
  items: ElementItem[]
  ready: boolean
  stale: boolean
  doc: Animation | null
} {
  const doc = useDocument((s) => s.doc)
  const docId = useDocument((s) => s.meta?.id)
  const [measured, setMeasured] = useState<Measured | null>(null)
  const last = useRef<Measured | null>(null)

  useEffect(() => {
    if (!doc || paused || last.current?.doc === doc) return
    const fresh = last.current?.docId !== docId
    const moved = !!last.current && structureOf(last.current.doc) !== structureOf(doc)
    const timer = setTimeout(
      () => {
        const found = suggestionsOf(doc)
        // Edits of the same file keep the rows where they were (the ranking may change).
        const previous = fresh ? null : last.current
        const items = previous ? keepOrder(found, previous.items) : found
        const next: Measured = { doc, docId, items }
        last.current = next
        setMeasured(next)
      },
      fresh || moved ? 0 : Math.max(DEBOUNCE_MS, lastCost * 4),
    )
    return () => clearTimeout(timer)
  }, [doc, docId, paused])

  const current = measured?.docId === docId ? measured : null
  const stale =
    !!current && !!doc && current.doc !== doc && structureOf(current.doc) !== structureOf(doc)
  return {
    items: current?.items ?? [],
    ready: current !== null,
    stale,
    doc: current?.doc ?? null,
  }
}

/** Display name of a node for lists (layer or group name, else its kind). */
export type NameOf = (doc: Animation, path: NodePath) => string

/**
 * The element picked by the user (the primary selection) when it can be replaced, measured on
 * `doc` (the document the suggestions were computed for, so it updates at the same pace).
 */
export function usePicked(doc: Animation | null, nameOf: NameOf): ElementItem | null {
  // The same array until the selection changes.
  const primary = useDocument((s) => primaryNode(s.selection))
  return useMemo(() => {
    if (!doc || !primary) return null
    const target = replaceTargetKind(doc, primary)
    if (!target) return null
    const placement = measureElement(doc, primary)
    return {
      path: primary,
      key: pathKey(primary),
      name: nameOf(doc, primary),
      target,
      kind: null,
      usage: instancesOf(doc, primary).length,
      frame: placement?.frame ?? 0,
      bounds: placement?.bounds ?? { x: 0, y: 0, w: 0, h: 0 },
      rootFrame: placement?.rootFrame ?? null,
      rootBounds: placement?.rootBounds ?? null,
    }
  }, [doc, primary, nameOf])
}
