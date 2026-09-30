/**
 * Pointer-driven drag & drop for the layer tree: a press becomes a drag after a few pixels;
 * the drop target follows the pointer (with auto-scroll near the edges); Esc cancels; the
 * drop is one undoable move.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  compPathOf,
  isLayerPath,
  isShapePath,
  layerPathOf,
  pathEquals,
  pathKey,
  type NodePath,
} from '@/lottie/path'
import { getDoc, useDocument } from '@/store/document'
import { setHoverNode } from '@/store/ui'
import { moveLayersTo, moveShapesTo } from './actions'
import { dropTarget, type DragSource, type DropTarget } from './dnd'
import { INDENT, ROW_HEIGHT, TREE_PAD, contentLeft } from './layout'
import { setExpanded } from './state'
import type { TreeModel, TreeRow } from './tree-model'

export interface DragState {
  source: DragSource
  /** Path keys of the dragged nodes (rows shown dimmed). */
  keys: Set<string>
  /** Node shown in the drag chip and how many items move. */
  lead: TreeRow
  count: number
  /** Pointer position when the drag started (first position of the chip). */
  x: number
  y: number
}

interface Press {
  x: number
  y: number
  row: TreeRow
  /** Runs when the press ends without a drag (click). */
  onClick: () => void
}

const THRESHOLD = 4
const EDGE = 32

/** Rows dragged together with `row`: the selected nodes of the same kind and context, or `row` alone. */
function dragSourceFor(model: TreeModel, row: TreeRow): DragState | null {
  if (model.searching) return null
  const sel = useDocument.getState().selection.nodes
  const selected = sel.some((p) => pathEquals(p, row.path))
  let source: DragSource
  let paths: NodePath[]
  if (row.kind === 'layer') {
    paths = selected
      ? sel.filter((p) => isLayerPath(p) && pathEquals(compPathOf(p), row.arrayPath))
      : [row.path]
    source = { kind: 'layer', parentKey: row.parentKey, compPath: row.arrayPath, paths }
  } else {
    paths = selected
      ? sel.filter((p) => isShapePath(p) && pathEquals(layerPathOf(p), row.layerPath))
      : [row.path]
    // The owning layer row within the same precomp instance.
    let layerRow: TreeRow | undefined = row
    while (layerRow && layerRow.kind !== 'layer') {
      const parent: number | undefined = layerRow.parentKey
        ? model.indexOf.get(layerRow.parentKey)
        : undefined
      layerRow = parent === undefined ? undefined : model.rows[parent]
    }
    if (!layerRow) return null
    source = { kind: 'shape', layerRowKey: layerRow.key, paths }
  }
  return { source, keys: new Set(paths.map(pathKey)), lead: row, count: paths.length, x: 0, y: 0 }
}

export function useTreeDrag(scrollRef: RefObject<HTMLDivElement | null>, model: TreeModel) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const chipRef = useRef<HTMLDivElement | null>(null)
  const modelRef = useRef(model)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    modelRef.current = model
  }, [model])

  // Abort a pending press/drag when the tree unmounts.
  useEffect(() => () => cleanupRef.current?.(), [])

  const press = (e: { clientX: number; clientY: number }, row: TreeRow, onClick: () => void) => {
    cleanupRef.current?.()
    const start: Press = { x: e.clientX, y: e.clientY, row, onClick }
    let state: DragState | null = null
    let target: DropTarget | null = null
    let last = { x: e.clientX, y: e.clientY }
    let raf = 0

    const locate = () => {
      const el = scrollRef.current
      const doc = getDoc()
      if (!el || !doc || !state) return
      const rect = el.getBoundingClientRect()
      const y = last.y - rect.top + el.scrollTop - TREE_PAD
      const rowF = y / ROW_HEIGHT
      const rowIndex = Math.max(0, Math.floor(rowF))
      const depth = Math.floor((last.x - rect.left - contentLeft(0) + INDENT / 2) / INDENT)
      const next =
        y < 0
          ? null
          : dropTarget(doc, modelRef.current.rows, state.source, {
              row: rowIndex,
              fraction: rowF - rowIndex,
              depth,
            })
      const same =
        next === target ||
        (!!next &&
          !!target &&
          next.index === target.index &&
          pathEquals(next.arrayPath, target.arrayPath) &&
          JSON.stringify(next.indicator) === JSON.stringify(target.indicator))
      if (!same) {
        target = next
        setDrop(next)
      }
    }

    const moveChip = () => {
      const chip = chipRef.current
      if (chip) chip.style.transform = `translate(${last.x + 14}px, ${last.y + 10}px)`
    }

    // Scrolls while the pointer rests near the top/bottom edge.
    const tick = () => {
      raf = 0
      const el = scrollRef.current
      if (!el || !state) return
      const rect = el.getBoundingClientRect()
      const speed =
        last.y < rect.top + EDGE
          ? -(rect.top + EDGE - last.y)
          : last.y > rect.bottom - EDGE
            ? last.y - (rect.bottom - EDGE)
            : 0
      if (!speed) return
      el.scrollTop += Math.max(-24, Math.min(24, speed * 0.5))
      locate()
      raf = requestAnimationFrame(tick)
    }

    const onMove = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY }
      if (!state) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < THRESHOLD) return
        state = dragSourceFor(modelRef.current, start.row)
        if (!state) {
          end()
          return
        }
        state.x = last.x
        state.y = last.y
        setHoverNode(null)
        document.body.style.cursor = 'grabbing'
        setDrag(state)
      }
      ev.preventDefault()
      moveChip()
      locate()
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const end = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('keydown', onKey, true)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      document.body.style.cursor = ''
      cleanupRef.current = null
      if (state) {
        setDrag(null)
        setDrop(null)
      }
    }

    const onUp = () => {
      const dragged = state
      const at = target
      end()
      if (!dragged) {
        start.onClick()
        return
      }
      if (!at) return
      const rows = modelRef.current.rows
      if (dragged.source.kind === 'layer') {
        moveLayersTo(
          dragged.source.compPath,
          dragged.source.paths.map((p) => p[p.length - 1] as number),
          at.index,
        )
      } else {
        moveShapesTo(dragged.source.paths, at.arrayPath, at.index)
      }
      // Dropping into a collapsed group or layer: open it so the result is visible.
      if (at.indicator.type === 'inside') {
        const container = rows[at.indicator.row]
        if (container?.expandable || container?.kind === 'layer') setExpanded([container.key], true)
      }
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !state) return
      ev.preventDefault()
      ev.stopPropagation()
      state = null
      end()
      setDrag(null)
      setDrop(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', end)
    window.addEventListener('keydown', onKey, true)
    cleanupRef.current = end
  }

  return { drag, drop, press, chipRef }
}
