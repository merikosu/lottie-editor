/**
 * The virtualized layer tree: selection (click, ⇧ range within a parent, ⌘ toggle), keyboard
 * navigation (ARIA tree), inline rename, drag & drop, context menu, hover sync with the
 * canvas/timeline, reveal requests and live dimming of layers outside their time range.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { layerDisplayName } from '@/components/lottie/labels'
import { Badge, ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui'
import { getT, useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { hasModKey } from '@/lib/platform'
import { matteSources } from '@/lottie/layer-ops'
import { findLayerIndexByInd, isLayerActiveAt } from '@/lottie/layers'
import { getAt, isLayerPath, isShapePath, pathEquals, pathKey, type NodePath } from '@/lottie/path'
import { precompInnerFrame } from '@/lottie/time'
import { assetUsage } from '@/lottie/traverse'
import type { Animation, Layer, PrecompLayer } from '@/lottie/types'
import { getDoc, primaryNode, selectNodes, useDocument } from '@/store/document'
import { subscribeFrame, usePlayback } from '@/store/playback'
import { setHoverNode, useUi } from '@/store/ui'
import { parentOf, renameNodeTo, selectedNodes, setNodesHidden, toggleNodesHidden } from './actions'
import { chainKey, instanceChainFor, noteInstanceChain } from './instances'
import { nodeKeyAncestors, parentRowKey } from './keys'
import { LayerContextMenuItems } from './LayerMenus'
import { ROW_HEIGHT, TREE_PAD, contentLeft, rowTop } from './layout'
import { LayerRow, type RowActions, type RowMatte } from './LayerRow'
import { NodeIcon } from './NodeIcon'
import {
  clearReveal,
  collapseSubtrees,
  finishReveal,
  requestReveal,
  setExpanded,
  setFocusKey,
  setLocked,
  setSearch,
  setSolo,
  startRename,
  stopRename,
  toggleExpanded,
  useLayersView,
} from './state'
import { ancestorRowKeys, subtreeKeys, type TreeModel, type TreeRow } from './tree-model'
import { useTreeDrag } from './useTreeDrag'

const OVERSCAN = 6

/* ------------------------------- Row details ------------------------------- */

const sourcesCache = new WeakMap<object, number[]>()

function compLayers(doc: Animation, row: TreeRow): Layer[] {
  return getAt<Layer[]>(doc, row.arrayPath) ?? []
}

function matteOf(doc: Animation, row: TreeRow, t: Dict): RowMatte | null {
  if (row.kind !== 'layer') return null
  const layer = row.node as Layer
  if (!layer.tt && !layer.td) return null
  const comp = compLayers(doc, row)
  let sources = sourcesCache.get(comp)
  if (!sources) sourcesCache.set(comp, (sources = matteSources(comp)))
  const name = (i: number) => layerDisplayName(comp[i], i, t)
  if (layer.tt) {
    const types = [
      t.layers.matte.alpha,
      t.layers.matte.alphaInverted,
      t.layers.matte.luma,
      t.layers.matte.lumaInverted,
    ]
    const type = types[layer.tt - 1] ?? t.layers.matte.alpha
    const s = sources[row.index] ?? -1
    return s < 0
      ? { role: 'target', type: layer.tt, label: t.layers.matte.missing(type), missing: true }
      : { role: 'target', type: layer.tt, label: t.layers.matte.target(type, name(s)) }
  }
  const targets = sources.flatMap((s, j) => (s === row.index ? [name(j)] : []))
  return { role: 'source', type: 0, label: t.layers.matte.source(targets) }
}

function parentOfRow(
  doc: Animation,
  row: TreeRow,
  t: Dict,
): { label: string; missing: boolean } | null {
  if (row.kind !== 'layer') return null
  const parent = (row.node as Layer).parent
  if (typeof parent !== 'number') return null
  const comp = compLayers(doc, row)
  const i = findLayerIndexByInd(comp, parent)
  return i < 0
    ? { label: t.layers.row.missingParent(parent), missing: true }
    : { label: t.layers.row.parent(layerDisplayName(comp[i], i, t)), missing: false }
}

/** Is the layer of `row` inside its in/out range at the root frame (through precomp instances)? */
function activeAt(doc: Animation, row: TreeRow, frame: number): boolean {
  let f = frame
  for (const instance of row.instances) {
    const layer = getAt<PrecompLayer>(doc, instance)
    if (!layer || !isLayerActiveAt(layer, f)) return false
    f = precompInnerFrame(layer, f, doc.fr)
  }
  const layer = getAt<Layer>(doc, row.layerPath)
  return !!layer && isLayerActiveAt(layer, f)
}

function inView(el: HTMLElement | null, index: number): boolean {
  if (!el) return false
  const top = rowTop(index)
  return top >= el.scrollTop && top + ROW_HEIGHT <= el.scrollTop + el.clientHeight
}

/** Scrolls the minimum needed to show row `index` (or centers it when it is far away). */
function scrollToRow(el: HTMLElement | null, index: number, center = false): void {
  if (!el || inView(el, index)) return
  const top = rowTop(index)
  if (center) el.scrollTop = Math.max(0, top - el.clientHeight / 2 + ROW_HEIGHT / 2)
  else if (top < el.scrollTop) el.scrollTop = top - TREE_PAD
  else el.scrollTop = top + ROW_HEIGHT + TREE_PAD - el.clientHeight
}

/**
 * Rows the preview hides because of solo: a composition with soloed layers shows only those,
 * so any other layer of it — or anything inside such a layer or precomp instance — is hidden.
 */
function soloHiddenOf(row: TreeRow, soloComps: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  if (!soloComps.size) return false
  for (const layerPath of [...row.instances, row.layerPath]) {
    const soloed = soloComps.get(pathKey(layerPath.slice(0, -1)))
    if (soloed && !soloed.has(pathKey(layerPath))) return true
  }
  return false
}

let swipeNonce = 0

function rowIndexOf(target: EventTarget): number {
  const el = (target as HTMLElement).closest<HTMLElement>('[data-layer-row]')
  return el ? Number(el.dataset.layerRow) : -1
}

function clearHover(): void {
  if (useUi.getState().hoverNode) setHoverNode(null)
}

/** Deepest layer or shape path containing `path` (reveals of property paths show their node). */
function nodePathOf(path: NodePath): NodePath | null {
  for (let n = path.length; n >= 2; n--) {
    const p = path.slice(0, n)
    if (isLayerPath(p) || isShapePath(p)) return p
  }
  return null
}

/* ---------------------------------- Tree ---------------------------------- */

export function LayerTree({ model, doc }: { model: TreeModel; doc: Animation }) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const selection = useDocument((s) => s.selection)
  const focusKey = useLayersView((s) => s.focusKey)
  const anchorKey = useLayersView((s) => s.anchorKey)
  const renaming = useLayersView((s) => s.renaming)
  const locked = useLayersView((s) => s.locked)
  const solo = useLayersView((s) => s.solo)
  const reveal = useLayersView((s) => s.reveal)
  const hoverNode = useUi((s) => s.hoverNode)
  const soloNodes = useUi((s) => s.soloNodes)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const { drag, drop, press, chipRef } = useTreeDrag(scrollRef, model)
  const { rows } = model

  const rowKeys = useMemo(() => rows.map((r) => pathKey(r.path)), [rows])
  const usage = useMemo(() => assetUsage(doc), [doc])
  const selectedKeys = useMemo(() => new Set(selection.nodes.map(pathKey)), [selection.nodes])
  /** Composition path key → path keys of its soloed layers. */
  const soloComps = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const p of soloNodes) {
      const comp = pathKey(p.slice(0, -1))
      if (!map.has(comp)) map.set(comp, new Set())
      map.get(comp)!.add(pathKey(p))
    }
    return map
  }, [soloNodes])
  const primary = primaryNode(selection)
  const primaryKey = primary ? pathKey(primary) : ''
  const hoverKey = hoverNode ? pathKey(hoverNode) : ''

  // Latest rows for effects and imperative handlers that must not re-run on every rebuild.
  const rowsRef = useRef(rows)
  const rowKeysRef = useRef(rowKeys)
  const indexOfRef = useRef(model.indexOf)
  useLayoutEffect(() => {
    rowsRef.current = rows
    rowKeysRef.current = rowKeys
    indexOfRef.current = model.indexOf
  }, [rows, rowKeys, model.indexOf])

  /* ------------------------------ Viewport ------------------------------ */

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const first = Math.max(0, Math.floor((viewport.top - TREE_PAD) / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    rows.length,
    Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN,
  )

  /* ------------------------------- Reveal ------------------------------- */

  // Selection from anywhere (canvas, timeline, undo): make the primary node visible. Rows
  // already in view (e.g. just clicked) only take the keyboard cursor. Precomp content opens
  // under the instance it was selected through (drilling into a precomp on the canvas).
  const previousNodesRef = useRef<NodePath[]>([])
  useEffect(() => {
    const nodes = useDocument.getState().selection.nodes
    const previous = previousNodesRef.current
    previousNodesRef.current = nodes
    const node = primaryKey ? nodePathOf(primaryNode(useDocument.getState().selection) ?? []) : null
    if (!node) return
    const key = pathKey(node)
    const keys = rowKeysRef.current
    const current = getDoc()
    // Shared precomp content: show it under the instance it was picked in (canvas, timeline).
    const chain = current ? (instanceChainFor(current, node) ?? []) : []
    const rowsNow = rowsRef.current
    const wanted = chainKey(chain)
    const visible = keys.findIndex(
      (k, i) =>
        k === key &&
        inView(scrollRef.current, i) &&
        (!chain.length || chainKey(rowsNow[i].instances) === wanted),
    )
    if (visible < 0) {
      requestReveal(node, { soft: true, prefer: [...chain, ...previous] })
      return
    }
    const focus = useLayersView.getState().focusKey
    const focusIndex = focus ? indexOfRef.current.get(focus) : undefined
    if (focusIndex === undefined || keys[focusIndex] !== key)
      setFocusKey(rowsRef.current[visible].key, true)
  }, [primaryKey])

  useEffect(() => {
    if (!reveal) return
    const target = nodePathOf(reveal.path)
    const current = getDoc()
    if (!target || !current) {
      clearReveal(reveal.nonce)
      return
    }
    const key = pathKey(target)
    const el = scrollRef.current
    const matches = rowKeys.flatMap((k, i) => (k === key ? [i] : []))
    const ancestors = ancestorRowKeys(current, target, reveal.prefer)
    // Precomp content is listed under every open instance: the preferred one wins, and is
    // opened even when the node already shows under another instance.
    const exact = ancestors ? model.indexOf.get(ancestors.rowKey) : undefined
    const openPreferred = !!ancestors?.preferred && !model.searching && exact === undefined
    if (exact !== undefined || (matches.length && !openPreferred)) {
      const index = exact ?? matches.find((i) => inView(el, i)) ?? matches[0]
      scrollToRow(el, index, true)
      finishReveal(reveal.nonce, rows[index].key, !!reveal.rename)
      return
    }
    if (!ancestors || (model.searching && reveal.soft)) {
      clearReveal(reveal.nonce)
      return
    }
    if (model.searching) {
      setSearch('')
      return
    }
    // Expanding rebuilds the rows, which runs this effect again.
    const collapsed = ancestors.keys.filter((k) => !useLayersView.getState().expanded[k])
    if (collapsed.length) setExpanded(collapsed, true)
    else if (matches.length) {
      scrollToRow(el, matches[0], true)
      finishReveal(reveal.nonce, rows[matches[0]].key, !!reveal.rename)
    } else clearReveal(reveal.nonce)
  }, [reveal, rows, rowKeys, model.searching, model.indexOf])

  // When the cursor row disappears, the cursor moves to its closest listed ancestor (collapsed
  // away) or stays at the same place in the list (deleted), so ↑/↓ continue from there.
  const lastFocusIndexRef = useRef(-1)
  useLayoutEffect(() => {
    const index = focusKey ? model.indexOf.get(focusKey) : undefined
    if (index !== undefined) {
      lastFocusIndexRef.current = index
      return
    }
    if (!focusKey || !rows.length || lastFocusIndexRef.current < 0) return
    let key = parentRowKey(focusKey)
    while (key !== null && !model.indexOf.has(key)) key = parentRowKey(key)
    setFocusKey(key ?? rows[Math.min(lastFocusIndexRef.current, rows.length - 1)].key, true)
  }, [focusKey, model.indexOf, rows])

  // Keep the keyboard cursor visible.
  useEffect(() => {
    const el = scrollRef.current
    const index = focusKey ? indexOfRef.current.get(focusKey) : undefined
    if (index !== undefined && document.activeElement === el) scrollToRow(el, index)
  }, [focusKey])

  /* ------------------------- Out-of-range dimming ------------------------ */

  const dimRef = useRef<(frame: number) => void>(() => {})
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let lastFrame = NaN
    const apply = (frame: number) => {
      const current = getDoc()
      if (!current) return
      lastFrame = Math.floor(frame + 1e-6)
      for (const rowEl of el.querySelectorAll<HTMLElement>('[data-layer-row]')) {
        const row = rowsRef.current[Number(rowEl.dataset.layerRow)]
        const name = rowEl.querySelector<HTMLElement>('[data-row-name]')
        if (!row || !name) continue
        if (activeAt(current, row, lastFrame)) delete name.dataset.inactive
        else name.dataset.inactive = ''
      }
    }
    dimRef.current = () => apply(usePlayback.getState().frame)
    // Only integer frame changes matter for in/out points.
    return subscribeFrame((frame) => {
      if (Math.floor(frame + 1e-6) !== lastFrame) apply(frame)
    })
  }, [])
  useLayoutEffect(() => {
    dimRef.current(usePlayback.getState().frame)
  })

  /* ------------------------------ Selection ----------------------------- */

  /** Rows from the anchor to `index` that share the target's parent. */
  const rangeTo = (index: number): TreeRow[] => {
    const target = rows[index]
    const from = anchorKey ? model.indexOf.get(anchorKey) : undefined
    if (from === undefined || rows[from].parentKey !== target.parentKey) return [target]
    const [a, b] = from <= index ? [from, index] : [index, from]
    const range = rows.slice(a, b + 1).filter((r) => r.parentKey === target.parentKey)
    // The clicked row becomes the primary (last) selection.
    return [...range.filter((r) => r !== target), target]
  }

  const select = (index: number, mode: 'replace' | 'toggle' | 'range' | 'range-add') => {
    const row = rows[index]
    if (!row) return
    // Picked under this precomp instance: the canvas and the timeline follow it.
    if (row.instances.length) noteInstanceChain(doc, row.instances)
    if (mode === 'range' || mode === 'range-add') {
      const paths = rangeTo(index).map((r) => r.path)
      selectNodes(paths, mode === 'range' ? 'replace' : 'add')
      setFocusKey(row.key)
    } else {
      selectNodes([row.path], mode)
      setFocusKey(row.key, true)
    }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // The tree (tabIndex 0) takes focus natively from the click, without a keyboard focus ring.
    if (e.button !== 0 || (e.target as HTMLElement).closest('input')) return
    const index = rowIndexOf(e.target)
    const row = rows[index]
    if (!row) {
      selectNodes([])
      setFocusKey(null, true)
      return
    }
    const mod = hasModKey(e)
    const wasSelected = selectedKeys.has(rowKeys[index])
    if (e.shiftKey) select(index, mod ? 'range-add' : 'range')
    else if (mod) select(index, 'toggle')
    else if (!wasSelected) select(index, 'replace')
    // A plain press on a selected row keeps the selection for dragging; a click narrows it.
    const narrow = !e.shiftKey && !mod && wasSelected
    press(e, row, () => {
      if (narrow) select(index, 'replace')
    })
  }

  const onDoubleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-row-control], input')) return
    const row = rows[rowIndexOf(e.target)]
    if (row) startRename(row.key)
  }

  const onContextMenu = (e: MouseEvent) => {
    const index = rowIndexOf(e.target)
    const row = rows[index]
    if (!row) {
      // The menu key (⇧F10) targets the focused tree: keep the selection it refers to. A right
      // click (button 2, or ⌃-click on macOS) on the empty area deselects.
      const fromKeyboard = e.button === 0 && !e.ctrlKey
      if (!fromKeyboard) selectNodes([])
      return
    }
    if (!selectedKeys.has(rowKeys[index])) select(index, 'replace')
    else setFocusKey(row.key)
  }

  const onPointerOver = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) return
    const row = rows[rowIndexOf(e.target)]
    const next = row?.path ?? null
    const current = useUi.getState().hoverNode
    if (!pathEquals(current, next)) setHoverNode(next)
  }

  /* ------------------------------ Keyboard ------------------------------ */

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing || renaming) return
    const cur = focusKey ? (model.indexOf.get(focusKey) ?? -1) : -1
    const row = cur >= 0 ? rows[cur] : null
    // ⌥→ / ⌥← expand or collapse the whole subtree.
    if (
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      row?.expandable &&
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
    ) {
      e.preventDefault()
      if (e.key === 'ArrowRight') setExpanded(subtreeKeys(doc, row, t), true)
      else collapseSubtrees([row.key])
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey || !rows.length) return
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1)
    const go = (index: number) =>
      select(Math.max(0, Math.min(rows.length - 1, index)), e.shiftKey ? 'range' : 'replace')
    switch (e.key) {
      case 'ArrowDown':
        go(cur + 1)
        break
      case 'ArrowUp':
        go(cur < 0 ? 0 : cur - 1)
        break
      case 'PageDown':
        go(cur + page)
        break
      case 'PageUp':
        go(cur - page)
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(rows.length - 1)
        break
      case 'ArrowRight':
        if (!row) return
        if (row.expandable && !row.expanded) toggleExpanded(row.key)
        else if (row.expanded) go(cur + 1)
        break
      case 'ArrowLeft': {
        if (!row) return
        const parent = row.parentKey ? model.indexOf.get(row.parentKey) : undefined
        if (row.expanded) toggleExpanded(row.key)
        else if (parent !== undefined) go(parent)
        break
      }
      case 'Enter':
      case 'F2':
        if (!row) return
        startRename(row.key)
        break
      case ' ': {
        // Space toggles visibility here instead of playing (the tree has focus).
        const paths = selectedNodes().all
        if (paths.length) toggleNodesHidden(paths)
        else if (row) setNodesHidden([row.path], !row.hidden)
        break
      }
      default:
        return
    }
    e.preventDefault()
  }

  /* --------------------------- Row callbacks ---------------------------- */

  const actions = useMemo<RowActions>(
    () => ({
      toggleExpand: (row, deep) => {
        const current = getDoc()
        if (!deep || !current) toggleExpanded(row.key)
        else if (row.expanded) collapseSubtrees([row.key])
        else setExpanded(subtreeKeys(current, row, getT()), true)
      },
      toggleHidden: (row) => setNodesHidden([row.path], !row.hidden),
      toggleLocked: (row) => setLocked([row.path], !useLayersView.getState().locked[row.nodeKey]),
      swipe: (row, what, e) => {
        const el = scrollRef.current
        if (!el) return
        const hide = !row.hidden
        const lock = !useLayersView.getState().locked[row.nodeKey]
        // One undo step for the whole swipe (lock is editor state, outside the history).
        const coalesceKey = `layers-swipe-${++swipeNonce}`
        const done = new Set<string>()
        const apply = (target: TreeRow | undefined) => {
          const key = target && pathKey(target.path)
          if (!target || !key || done.has(key)) return
          done.add(key)
          // In progress until release: one undo step however slowly the pointer sweeps.
          if (what === 'hidden') setNodesHidden([target.path], hide, { coalesceKey, final: false })
          else setLocked([target.path], lock)
        }
        const indexAt = (y: number) =>
          Math.floor((y - el.getBoundingClientRect().top + el.scrollTop - TREE_PAD) / ROW_HEIGHT)
        let prevIndex = indexAt(e.clientY)
        apply(row)
        const onMove = (ev: globalThis.PointerEvent) => {
          const next = indexAt(ev.clientY)
          // Fast sweeps skip rows between two events: fill them in.
          const step = next > prevIndex ? 1 : -1
          for (let i = prevIndex; i !== next; i += step) apply(rowsRef.current[i + step])
          prevIndex = next
        }
        const end = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
      },
      toggleSolo: (row) => setSolo([row.path], !useLayersView.getState().solo[row.nodeKey]),
      commitRename: (row, name) => {
        stopRename()
        if (name.trim() && name.trim() !== row.name) renameNodeTo(row.path, name)
        scrollRef.current?.focus({ preventScroll: true })
      },
      renameNext: (row, name, step) => {
        const list = rowsRef.current
        const index = indexOfRef.current.get(row.key)
        const next = index === undefined ? undefined : list[index + step]
        stopRename()
        if (name.trim() && name.trim() !== row.name) renameNodeTo(row.path, name)
        if (next) {
          startRename(next.key)
          scrollToRow(scrollRef.current, index! + step)
        } else scrollRef.current?.focus({ preventScroll: true })
      },
      cancelRename: () => {
        stopRename()
        scrollRef.current?.focus({ preventScroll: true })
      },
      selectParentOf: (row) => {
        const current = getDoc()
        const parent = current ? parentOf(current, row.path) : null
        if (parent) selectNodes([parent])
      },
      hoverParentOf: (row) => {
        const current = getDoc()
        setHoverNode(row && current ? parentOf(current, row.path) : null)
      },
    }),
    [],
  )

  /* ------------------------------- Render ------------------------------- */

  const focusIndex = focusKey ? model.indexOf.get(focusKey) : undefined
  const activeId =
    focusIndex !== undefined && focusIndex >= first && focusIndex < last
      ? `le-layer-row-${focusIndex}`
      : undefined
  const isSelected = (i: number) => i >= 0 && i < rows.length && selectedKeys.has(rowKeys[i])
  const dropInsideRow = drop?.indicator.type === 'inside' ? drop.indicator.row : -1

  const visible: ReactNode[] = []
  for (let i = first; i < last; i++) {
    const row = rows[i]
    const selected = isSelected(i)
    const parent = parentOfRow(doc, row, t)
    visible.push(
      <LayerRow
        key={row.key}
        row={row}
        index={i}
        selected={selected ? (rowKeys[i] === primaryKey ? 2 : 1) : 0}
        joinTop={selected && isSelected(i - 1)}
        joinBottom={selected && isSelected(i + 1)}
        focused={row.key === focusKey}
        hovered={!drag && rowKeys[i] === hoverKey}
        renaming={row.key === renaming}
        locked={!!locked[row.nodeKey]}
        lockedByParent={nodeKeyAncestors(row.nodeKey).some((k) => locked[k])}
        soloed={!!solo[row.nodeKey]}
        soloHidden={soloHiddenOf(row, soloComps)}
        dragged={!!drag && drag.keys.has(rowKeys[i])}
        dropInside={i === dropInsideRow}
        usage={row.node.ty === 0 ? (usage.get((row.node as PrecompLayer).refId) ?? 0) : 0}
        parentLabel={parent?.label ?? null}
        parentMissing={!!parent?.missing}
        matte={matteOf(doc, row, t)}
        actions={actions}
      />,
    )
  }

  const line = drop?.indicator.type === 'line' ? drop.indicator : null

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            role="tree"
            aria-label={t.layers.treeLabel}
            aria-multiselectable
            aria-activedescendant={activeId}
            tabIndex={0}
            data-testid="layer-tree"
            className={cn(
              'group/tree relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--le-accent)]',
              // While dragging, rows ignore the pointer: no hover highlights or toggles.
              drag && 'cursor-grabbing [&_[data-layer-row]]:pointer-events-none',
            )}
            onScroll={(e) => {
              const el = e.currentTarget
              setViewport((v) =>
                v.top === el.scrollTop && v.height === el.clientHeight
                  ? v
                  : { top: el.scrollTop, height: el.clientHeight },
              )
            }}
            onPointerDown={onPointerDown}
            onPointerOver={onPointerOver}
            onPointerLeave={clearHover}
            onDoubleClick={onDoubleClick}
            onKeyDown={onKeyDown}
            onContextMenu={onContextMenu}
          >
            <div className="relative" style={{ height: rows.length * ROW_HEIGHT + TREE_PAD * 2 }}>
              {visible}
              {line && (
                <div
                  aria-hidden
                  data-testid="layer-drop-line"
                  className="pointer-events-none absolute right-2 z-10 h-0.5 rounded-full bg-accent"
                  style={{ top: rowTop(line.row) - 1, left: contentLeft(line.depth) + 18 }}
                >
                  <span className="absolute top-1/2 -left-1.5 size-2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface-1" />
                </div>
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="max-w-96 min-w-[236px]">
          <LayerContextMenuItems />
        </ContextMenuContent>
      </ContextMenu>
      {drag &&
        createPortal(
          <div
            ref={chipRef}
            className="pointer-events-none fixed top-0 left-0 z-50 flex h-7 max-w-64 items-center gap-2 rounded-md bg-surface-3 pr-2 pl-2 text-sm text-fg shadow-popover"
            style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }}
          >
            <NodeIcon node={drag.lead.node} kind={drag.lead.kind} />
            <span className="min-w-0 truncate">
              {drag.count > 1 ? t.layers.drag.items(drag.count) : drag.lead.name}
            </span>
            {drag.count > 1 && <Badge tone="accent">{drag.count}</Badge>}
          </div>,
          document.body,
        )}
    </>
  )
}
