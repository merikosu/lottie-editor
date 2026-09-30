/**
 * Drop targets for drag & drop in the layer tree (pure; the tree supplies rows and pointer).
 *
 * - Layers reorder within their composition (under the same precomp instance row). Dropping
 *   onto a layer's expanded content means "after that layer"; drops never split a matte pair.
 * - Shape items move within their layer: before/after items, into groups (middle of a group
 *   row), to the top of the layer (layer row), and out of a group by moving the pointer left
 *   of the group's content while over its last item.
 */
import { canMoveShapes, layersAt, normalizeLayerInsertIndex } from '@/lottie/layer-ops'
import type { NodePath } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import type { TreeRow } from './tree-model'

export type DragSource =
  | { kind: 'layer'; parentKey: string | null; compPath: NodePath; paths: NodePath[] }
  | { kind: 'shape'; layerRowKey: string; paths: NodePath[] }

export type DropIndicator =
  /** Line at the top edge of `rows[row]` (row = rows.length: below the last row). */
  | { type: 'line'; row: number; depth: number }
  /** Highlight `rows[row]` as the container receiving the items. */
  | { type: 'inside'; row: number }

export interface DropTarget {
  /** Array receiving the items and the insertion index in its current order. */
  arrayPath: NodePath
  index: number
  indicator: DropIndicator
}

export interface DropPointer {
  /** Row under the pointer (may be ≥ rows.length below the list). */
  row: number
  /** Vertical position inside that row, 0..1. */
  fraction: number
  /** Tree depth under the pointer's x position (for leaving groups). */
  depth: number
}

/** Index of the last row of the subtree starting at `i`. */
export function subtreeEnd(rows: readonly TreeRow[], i: number): number {
  const depth = rows[i].depth
  let j = i
  while (j + 1 < rows.length && rows[j + 1].depth > depth) j++
  return j
}

function layerDrop(
  doc: Animation,
  rows: readonly TreeRow[],
  source: Extract<DragSource, { kind: 'layer' }>,
  p: DropPointer,
): DropTarget | null {
  const layers = layersAt(doc, source.compPath)
  if (!layers) return null
  // Candidates: layers of the same composition under the same precomp instance row.
  const isCandidate = (r: TreeRow) => r.kind === 'layer' && r.parentKey === source.parentKey
  const depth = rows.find(isCandidate)?.depth
  if (depth === undefined) return null
  // Walk up to the candidate whose subtree contains the pointer; rows shallower than the
  // candidates mean the pointer left their composition (another instance, the root).
  let c = -1
  for (let i = Math.min(p.row, rows.length - 1); i >= 0; i--) {
    if (isCandidate(rows[i])) {
      c = i
      break
    }
    if (rows[i].depth <= depth) return null
  }
  if (c < 0) return null
  const end = subtreeEnd(rows, c)
  if (p.row >= rows.length && end !== rows.length - 1) return null

  let index: number
  let row: number
  if (p.row === c && p.fraction < 0.5) {
    index = rows[c].index
    row = c
  } else {
    index = rows[c].index + 1
    row = end + 1
  }
  const normalized = normalizeLayerInsertIndex(layers, index)
  if (normalized !== index) {
    index = normalized
    const at = rows.findIndex((r) => isCandidate(r) && r.index === normalized)
    if (at < 0) return null
    row = at
  }
  return {
    arrayPath: source.compPath,
    index,
    indicator: { type: 'line', row, depth: rows[c].depth },
  }
}

function shapeDrop(
  rows: readonly TreeRow[],
  source: Extract<DragSource, { kind: 'shape' }>,
  p: DropPointer,
): DropTarget | null {
  const L = rows.findIndex((r) => r.key === source.layerRowKey)
  if (L < 0 || p.row >= rows.length) return null
  const end = subtreeEnd(rows, L)
  if (p.row < L || p.row > end) return null
  const layerRow = rows[L]
  const shapesPath = [...layerRow.path, 'shapes']

  let target: DropTarget
  if (p.row === L) {
    target =
      layerRow.expanded && p.fraction >= 0.5 && end > L
        ? {
            arrayPath: shapesPath,
            index: 0,
            indicator: { type: 'line', row: L + 1, depth: layerRow.depth + 1 },
          }
        : { arrayPath: shapesPath, index: 0, indicator: { type: 'inside', row: L } }
  } else {
    const r = rows[p.row]
    const isGroup = (r.node as { ty?: string }).ty === 'gr'
    if (isGroup && p.fraction >= 0.25 && p.fraction < 0.75) {
      target = { arrayPath: [...r.path, 'it'], index: 0, indicator: { type: 'inside', row: p.row } }
    } else if (p.fraction < 0.5) {
      target = {
        arrayPath: r.arrayPath,
        index: r.index,
        indicator: { type: 'line', row: p.row, depth: r.depth },
      }
    } else if (isGroup && r.expanded) {
      target = {
        arrayPath: [...r.path, 'it'],
        index: 0,
        indicator: { type: 'line', row: p.row + 1, depth: r.depth + 1 },
      }
    } else {
      // After the row; over a group's last item the pointer's x can leave the group.
      let i = p.row
      while (rows[i].last && p.depth < rows[i].depth) {
        const parent = rows.findIndex((row) => row.key === rows[i].parentKey)
        if (parent <= L) break
        i = parent
      }
      const t = rows[i]
      target = {
        arrayPath: t.arrayPath,
        index: t.index + 1,
        indicator: { type: 'line', row: subtreeEnd(rows, i) + 1, depth: t.depth },
      }
    }
  }
  return canMoveShapes(source.paths, target.arrayPath) ? target : null
}

/** Drop target for the pointer position, or null when nothing can be dropped there. */
export function dropTarget(
  doc: Animation,
  rows: readonly TreeRow[],
  source: DragSource,
  pointer: DropPointer,
): DropTarget | null {
  if (!rows.length || pointer.row < 0) return null
  return source.kind === 'layer'
    ? layerDrop(doc, rows, source, pointer)
    : shapeDrop(rows, source, pointer)
}
