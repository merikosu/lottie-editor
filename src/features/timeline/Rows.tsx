/**
 * Timeline rows: a names cell (fixed column) and a track cell (horizontally scrolled through
 * the `--sx` CSS variable, so scrolling never re-renders rows).
 */
import { ChevronLeft, ChevronRight, CircleDot, Eye, EyeOff, Lock } from 'lucide-react'
import {
  memo,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Tooltip } from '@/components/ui'
import { LayerKindIcon, ShapeTypeIcon } from '@/components/lottie/icons'
import { setLocked, setSolo, useNodeLocked } from '@/features/layers'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { hasModKey } from '@/lib/platform'
import { findKeyframeAt, insertKeyframe } from '@/lottie/keyframes'
import type { LayerKind } from '@/lottie/layers'
import { getAt, pathEquals, pathKey, setAt, type NodePath } from '@/lottie/path'
import { getKeyframes, type AnyProperty } from '@/lottie/property'
import { allKeyRefs, deleteKeys, normalizeLegacyKeys, type KeyRef } from '@/lottie/timeline-ops'
import type { Layer } from '@/lottie/types'
import { getDoc, selectNodes, updateDoc, useDocument } from '@/store/document'
import { setFrame, usePlayback } from '@/store/playback'
import { setHoverNode, useUi } from '@/store/ui'
import { useController, useMetrics } from './context'
import { readValue } from './format'
import { frameToX } from './geometry'
import { EasingGlyph, KeyGlyph } from './glyphs'
import { curveOf, keySides } from './interp'
import { useGraphState } from './graph/state'
import { groupKeys, summaryKeys, type FlatRow, type PropNode } from './model'
import { indexSelection, isRefSelected, selectFromTimeline, selectKeys } from './selection'
import { setExpanded, setTimelineView, useTimelinePrefs, useTimelineView } from './store'

/** Label color of a layer kind as a CSS color (bars are tinted versions of it). */
const LABEL_VAR: Record<LayerKind, string> = {
  precomp: 'var(--le-label-precomp)',
  solid: 'var(--le-label-solid)',
  image: 'var(--le-label-image)',
  null: 'var(--le-label-null)',
  shape: 'var(--le-label-shape)',
  text: 'var(--le-label-text)',
  audio: 'var(--le-label-other)',
  camera: 'var(--le-label-other)',
  adjustment: 'var(--le-label-other)',
  other: 'var(--le-label-other)',
}

const INDENT = 12

/** Row buttons handle their own clicks; they must not start row gestures. */
const stopRowPointer = (e: ReactPointerEvent) => e.stopPropagation()
/** Mouse clicks on row buttons keep focus where it is (focusing would scroll the list). */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

/* Per-row selection selectors return primitives, so a selection change re-renders only the rows
   whose state actually changed. */
function useNodeSelected(path: NodePath): boolean {
  const key = pathKey(path)
  return useDocument((s) => indexSelection(s.selection).nodes.has(key))
}

/** 0 not selected, 1 selected, 2 primary (last) selection — styled like the layer panel. */
function useNodeSelection(path: NodePath): 0 | 1 | 2 {
  const key = pathKey(path)
  return useDocument((s) => {
    const index = indexSelection(s.selection)
    return index.nodes.has(key) ? (index.primary === key ? 2 : 1) : 0
  })
}

function usePropertyFocused(path: NodePath): boolean {
  const key = pathKey(path)
  return useDocument((s) => indexSelection(s.selection).property === key)
}

/** Selected keyframe indices of a property as a stable string ("1,3"). */
function useSelectedIndices(path: NodePath): string {
  const key = pathKey(path)
  return useDocument((s) => {
    const set = indexSelection(s.selection).keys.get(key)
    return set ? [...set].sort((a, b) => a - b).join(',') : ''
  })
}

function ownerOfRow(row: FlatRow): NodePath {
  return row.node?.owner ?? row.model.path
}

function hoverOn(path: NodePath) {
  setHoverNode(path)
}

function hoverOff(path: NodePath) {
  const current = useUi.getState().hoverNode
  if (current && pathEquals(current, path)) setHoverNode(null)
}

/* -------------------------------------------------------------------------- */
/*                                  Expanding                                 */
/* -------------------------------------------------------------------------- */

/**
 * Opening a layer reveals all of its animated properties at once (the timeline only lists
 * animated ones, so that is what you want to see); Alt-click toggles just the row.
 */
function toggleRow(row: FlatRow, alt: boolean): void {
  if (!row.expandable) return
  const layerKey = row.kind === 'layer' ? row.key : row.key.slice(0, row.key.indexOf('#'))
  const children =
    row.kind === 'layer' ? row.model.children : row.node?.kind === 'group' ? row.node.children : []
  const descendants = groupKeys(layerKey, children)
  const isLayer = row.kind === 'layer'
  if (row.expanded) {
    // Closing a layer forgets its groups, so reopening it reveals everything again.
    setExpanded([row.key, ...(isLayer || alt ? descendants : [])], false)
  } else {
    // Layers open fully (Alt: just the row); groups open one level (Alt: all levels).
    setExpanded([row.key, ...(isLayer !== alt ? descendants : [])], true)
  }
}

function Chevron({ row }: { row: FlatRow }) {
  const t = useT()
  if (!row.expandable) return <span className="w-4 shrink-0" aria-hidden />
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={row.expanded ? t.timeline.rows.collapse : t.timeline.rows.expand}
      onPointerDown={stopRowPointer}
      onMouseDown={keepFocus}
      onClick={(e) => {
        e.stopPropagation()
        toggleRow(row, e.altKey)
      }}
      className="flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:text-fg"
    >
      <ChevronRight
        size={12}
        className={cn('transition-transform duration-100', row.expanded && 'rotate-90')}
      />
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/*                                 Names column                               */
/* -------------------------------------------------------------------------- */

/** Text that shows its full value in a tooltip only when it is truncated. */
function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  return (
    <Tooltip content={text} disabled={!overflow} side="top" align="start">
      <span
        ref={ref}
        className={cn('min-w-0 truncate', className)}
        onPointerEnter={() => {
          const el = ref.current
          if (el) setOverflow(el.scrollWidth > el.clientWidth + 1)
        }}
      >
        {text}
      </span>
    </Tooltip>
  )
}

function RenameInput({
  initial,
  label,
  onCommit,
}: {
  initial: string
  label: string
  onCommit: (value: string | null) => void
}) {
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onCommit(value)
  }
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={initial}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={stopRowPointer}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-5 min-w-0 flex-1 rounded-sm bg-surface-2 px-1 text-sm text-fg shadow-[inset_0_0_0_1px_var(--le-accent)] outline-none"
    />
  )
}

function EyeToggle({ row }: { row: FlatRow }) {
  const t = useT()
  const hidden = !!row.model.layer.hd
  const path = row.model.path
  return (
    <Tooltip content={hidden ? t.timeline.rows.show : t.timeline.rows.hide}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={hidden ? t.timeline.rows.show : t.timeline.rows.hide}
        onPointerDown={stopRowPointer}
        onMouseDown={keepFocus}
        onClick={(e) => {
          e.stopPropagation()
          updateDoc(hidden ? t.timeline.history.showLayer : t.timeline.history.hideLayer, (d) => {
            const layer = getAt<Layer>(d, path)
            if (!layer) return
            if (hidden) delete layer.hd
            else layer.hd = true
          })
        }}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg',
          hidden
            ? 'text-fg-muted'
            : 'opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100',
        )}
      >
        {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </Tooltip>
  )
}

/**
 * Preview-only solo (set in the layer panel): 'soloed' layers, and layers 'hidden' because
 * another layer of their composition is soloed.
 */
function useSoloState(path: NodePath): 'soloed' | 'hidden' | null {
  const key = pathKey(path)
  const comp = pathKey(path.slice(0, -1))
  return useUi((s) => {
    if (s.soloNodes.length === 0) return null
    let sameComp = false
    for (const p of s.soloNodes) {
      if (pathKey(p) === key) return 'soloed'
      if (pathKey(p.slice(0, -1)) === comp) sameComp = true
    }
    return sameComp ? 'hidden' : null
  })
}

/** Shown on soloed layers; a click turns solo off. */
function SoloIndicator({ row }: { row: FlatRow }) {
  const t = useT()
  if (useSoloState(row.model.path) !== 'soloed') return null
  return (
    <Tooltip content={t.timeline.rows.soloed}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t.timeline.rows.soloed}
        onPointerDown={stopRowPointer}
        onMouseDown={keepFocus}
        onClick={(e) => {
          e.stopPropagation()
          setSolo([row.model.path], false)
        }}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-accent-text hover:bg-hover"
      >
        <CircleDot size={12} />
      </button>
    </Tooltip>
  )
}

/** Shown on locked layers (editor-only lock from the layer panel); a click unlocks. */
function LockIndicator({ row }: { row: FlatRow }) {
  const t = useT()
  const locked = useNodeLocked(row.model.path)
  if (!locked) return null
  return (
    <Tooltip content={t.timeline.rows.locked}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t.timeline.rows.locked}
        onPointerDown={stopRowPointer}
        onMouseDown={keepFocus}
        onClick={(e) => {
          e.stopPropagation()
          setLocked([row.model.path], false)
        }}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg"
      >
        <Lock size={12} />
      </button>
    </Tooltip>
  )
}

function selectLayerRow(e: ReactPointerEvent, row: FlatRow, rows: readonly FlatRow[]): void {
  if (e.button !== 0) return
  const path = row.model.path
  selectFromTimeline(() => {
    if (hasModKey(e)) return selectNodes([path], 'toggle')
    if (e.shiftKey) {
      const sel = useDocument.getState().selection
      const anchorPath = sel.nodes[sel.nodes.length - 1]
      const siblings = rows.filter((r) => r.kind === 'layer' && r.instance === row.instance)
      const from = anchorPath ? siblings.findIndex((r) => pathEquals(r.model.path, anchorPath)) : -1
      const to = siblings.findIndex((r) => r.key === row.key)
      if (from >= 0 && to >= 0) {
        const range = siblings
          .slice(Math.min(from, to), Math.max(from, to) + 1)
          .map((r) => r.model.path)
        // The clicked row becomes the primary selection.
        return selectNodes([...range.filter((p) => !pathEquals(p, path)), path], 'replace')
      }
    }
    selectNodes([path], 'replace')
  })
}

function LayerName({ row }: { row: FlatRow }) {
  const t = useT()
  const ctl = useController()
  const selection = useNodeSelection(row.model.path)
  const selected = selection > 0
  const hovered = useUi((s) => !!s.hoverNode && pathEquals(s.hoverNode, row.model.path))
  const renaming = useTimelineView((s) => s.renaming === row.key)
  const soloHidden = useSoloState(row.model.path) === 'hidden'
  const layer = row.model.layer
  const hidden = !!layer.hd || soloHidden
  return (
    <div
      data-ctx="layer"
      data-row={row.key}
      className={cn(
        'group/name flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1.5',
        selection === 2
          ? 'bg-selected-strong text-fg'
          : selection === 1
            ? 'bg-selected text-fg'
            : hovered
              ? 'bg-hover'
              : 'hover:bg-hover',
      )}
      style={{ paddingLeft: 4 + row.depth * INDENT }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        ctl.focus()
        ctl.notePreferred(row)
        selectLayerRow(e, row, ctl.rows().rows)
      }}
      onDoubleClick={() => setTimelineView({ renaming: row.key })}
      onPointerEnter={() => hoverOn(row.model.path)}
      onPointerLeave={() => hoverOff(row.model.path)}
    >
      <Chevron row={row} />
      <LayerKindIcon kind={row.model.kind} size={14} className={cn(hidden && 'opacity-50')} />
      {renaming ? (
        <RenameInput
          initial={layer.nm ?? row.model.name}
          label={t.timeline.rows.renameLayer}
          onCommit={(value) => {
            setTimelineView({ renaming: null })
            const name = value?.trim()
            if (!name || name === layer.nm) return
            updateDoc(t.timeline.history.renameLayer, (d) => {
              const target = getAt<Layer>(d, row.model.path)
              if (target) target.nm = name
            })
          }}
        />
      ) : (
        <TruncatedText
          text={row.model.name}
          className={cn(
            'flex-1 text-sm',
            hidden
              ? 'text-fg-faint'
              : selected
                ? 'text-fg'
                : 'text-fg-muted group-hover/name:text-fg',
          )}
        />
      )}
      <SoloIndicator row={row} />
      <LockIndicator row={row} />
      <EyeToggle row={row} />
    </div>
  )
}

function selectPropertyRow(e: ReactPointerEvent, row: FlatRow): void {
  if (e.button !== 0) return
  const doc = getDoc()
  if (!doc || !row.node) return
  const props = row.node.kind === 'property' ? [row.node] : row.node.props
  const refs = allKeyRefs(
    doc,
    props.map((p) => p.path),
  )
  const additive = e.shiftKey || hasModKey(e)
  selectKeys(refs, additive ? 'add' : 'replace', {
    focus: row.node.kind === 'property' ? row.node.path : null,
    nodes: additive ? undefined : [row.node.owner],
  })
}

function ValueReadout({ node, row }: { node: PropNode; row: FlatRow }) {
  const t = useT()
  const frame = useTimelineView((s) => s.valueFrame)
  if (!row.map) return null
  const value = readValue(node, row.map.toLocal(frame), t)
  if (!value.text && !value.swatch) return null
  return (
    <span className="flex min-w-0 shrink items-center justify-end gap-1.5 pl-1 text-xs text-fg-subtle tabular-nums">
      {value.swatch && (
        <span
          className="size-2.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)]"
          style={{ background: value.swatch }}
          aria-hidden
        />
      )}
      <span className="truncate">{value.text}</span>
    </span>
  )
}

/** Keys around a local frame: before it, at it (±½ frame) and after it (indices, -1 for none). */
function keysAround(kfs: readonly { t: number }[], local: number): [number, number, number] {
  let prev = -1
  let at = -1
  let next = -1
  kfs.forEach((kf, i) => {
    if (kf.t < local - 0.5) prev = i
    else if (Math.abs(kf.t - local) < 0.5) at = i
    else if (next < 0) next = i
  })
  return [prev, at, next]
}

/** ◀ ◆ ▶: previous key, add/remove key at the playhead, next key. */
function KeyNavigator({ node, row }: { node: PropNode; row: FlatRow }) {
  const t = useT()
  const ctl = useController()
  const map = row.map
  const kfs = getKeyframes(node.prop) ?? []
  // The buttons change only when the playhead passes a key: re-render then, not every frame.
  const around = useTimelineView((s) =>
    map ? keysAround(kfs, map.toLocal(Math.round(s.valueFrame))).join(',') : '',
  )
  if (!map) return <span className="w-[46px] shrink-0" />
  const readOnly = node.textKeys || !map.linear
  const [prevIndex, at, nextIndex] = around.split(',').map(Number)
  const prev = kfs[prevIndex]
  const next = kfs[nextIndex]
  const go = (kf: { t: number } | undefined) => {
    if (!kf) return
    ctl.notePreferred(row)
    const target = map.toRoot(kf.t)
    setFrame(target, { allowSubframe: !Number.isInteger(target) })
  }
  const toggleKey = () => {
    const doc = getDoc()
    const original = doc ? getAt<AnyProperty>(doc, node.path) : undefined
    if (!original) return
    ctl.notePreferred(row)
    const history = t.timeline.history
    // The playhead now (the readouts lag behind it while playing).
    const local = map.toLocal(Math.round(usePlayback.getState().frame))
    const [, atNow] = keysAround(kfs, local)
    if (atNow >= 0) {
      updateDoc(history.removeKey, (d) => deleteKeys(d, [{ path: node.path, index: atNow }]))
      return
    }
    // Keyframe insertion evaluates the value on a plain copy (never on a draft).
    const copy = structuredClone(original)
    normalizeLegacyKeys(copy)
    const frameLocal = Math.round(local * 1000) / 1000
    insertKeyframe(copy, frameLocal)
    updateDoc(history.addKey, (d) => setAt(d, node.path, copy), {
      selection: (docAfter) => {
        const prop = getAt<AnyProperty>(docAfter, node.path)
        const index = prop ? findKeyframeAt(prop, frameLocal) : -1
        const sel = useDocument.getState().selection
        return index >= 0
          ? { ...sel, keyframes: [{ path: node.path, index }], property: node.path }
          : sel
      },
    })
  }
  const arrow =
    'flex h-5 w-3.5 items-center justify-center rounded-sm text-fg-faint hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-0'
  return (
    <span className="flex shrink-0 items-center">
      <Tooltip content={t.timeline.rows.prevKey} shortcut="j">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t.timeline.rows.prevKey}
          disabled={!prev}
          className={arrow}
          onPointerDown={stopRowPointer}
          onMouseDown={keepFocus}
          onClick={() => go(prev)}
        >
          <ChevronLeft size={11} />
        </button>
      </Tooltip>
      <Tooltip
        content={
          node.textKeys
            ? t.timeline.rows.textKeys
            : at >= 0
              ? t.timeline.rows.removeKey
              : t.timeline.rows.addKey
        }
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={at >= 0 ? t.timeline.rows.removeKey : t.timeline.rows.addKey}
          aria-pressed={at >= 0}
          // Not `disabled`: the tooltip still explains why nothing happens.
          aria-disabled={readOnly || undefined}
          onPointerDown={stopRowPointer}
          onMouseDown={keepFocus}
          onClick={() => {
            if (!readOnly) toggleKey()
          }}
          className={cn(
            'group/key flex size-5 items-center justify-center rounded-sm',
            readOnly ? 'cursor-default' : 'hover:bg-hover',
          )}
        >
          <KeyGlyph
            size={9}
            sides={at >= 0 ? keySides(kfs, at, node.textKeys) : ['linear', 'linear']}
            tone={at >= 0 ? 'selected' : 'muted'}
            className={cn(at < 0 && 'opacity-70 group-hover/key:opacity-100')}
          />
        </button>
      </Tooltip>
      <Tooltip content={t.timeline.rows.nextKey} shortcut="k">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t.timeline.rows.nextKey}
          disabled={!next}
          className={arrow}
          onPointerDown={stopRowPointer}
          onMouseDown={keepFocus}
          onClick={() => go(next)}
        >
          <ChevronRight size={11} />
        </button>
      </Tooltip>
    </span>
  )
}

/**
 * Graph mode: the colors of the property's curves (the names column doubles as the legend).
 * Takes the place of the chevron column, which property rows leave empty.
 */
function GraphMark({ path }: { path: NodePath }) {
  const key = pathKey(path)
  const colors = useGraphState((s) => s.legend[key]?.join(',') ?? '')
  return (
    <span className="flex w-4 shrink-0 items-center justify-center gap-px" aria-hidden>
      {colors &&
        colors
          .split(',')
          .map((color, i) => (
            <span
              key={i}
              className="h-2.5 w-[2px] rounded-full"
              style={{ background: `var(${color})` }}
            />
          ))}
    </span>
  )
}

function PropertyName({ row }: { row: FlatRow }) {
  const ctl = useController()
  const node = row.node as PropNode
  const focused = usePropertyFocused(node.path)
  const owner = ownerOfRow(row)
  return (
    <div
      data-ctx="property"
      data-row={row.key}
      className={cn(
        'group/prop flex h-full min-w-0 flex-1 items-center gap-1 pr-1',
        focused ? 'bg-selected' : 'hover:bg-hover',
      )}
      style={{ paddingLeft: 4 + row.depth * INDENT }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        ctl.focus()
        ctl.notePreferred(row)
        selectPropertyRow(e, row)
      }}
      onPointerEnter={() => hoverOn(owner)}
      onPointerLeave={() => hoverOff(owner)}
    >
      <GraphMark path={node.path} />
      <TruncatedText
        text={node.label}
        className={cn('flex-1 text-xs', focused ? 'text-fg' : 'text-fg-muted')}
      />
      <ValueReadout node={node} row={row} />
      <KeyNavigator node={node} row={row} />
    </div>
  )
}

function GroupName({ row }: { row: FlatRow }) {
  const ctl = useController()
  const node = row.node
  if (!node || node.kind !== 'group') return null
  const owner = node.owner
  return (
    <div
      data-ctx="group"
      data-row={row.key}
      className="flex h-full min-w-0 flex-1 items-center gap-1 pr-1.5 hover:bg-hover"
      style={{ paddingLeft: 4 + row.depth * INDENT }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        ctl.focus()
        ctl.notePreferred(row)
        selectPropertyRow(e, row)
      }}
      onDoubleClick={() => toggleRow(row, false)}
      onPointerEnter={() => hoverOn(owner)}
      onPointerLeave={() => hoverOff(owner)}
    >
      <Chevron row={row} />
      {node.shape && <ShapeTypeIcon item={node.shape} size={12} />}
      <TruncatedText text={node.label} className="flex-1 text-xs text-fg-muted" />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Tracks                                   */
/* -------------------------------------------------------------------------- */

/** Dimmed overlay for parts of the row outside the precomp window (content not shown there). */
function WindowShade({ row }: { row: FlatRow }) {
  const { ip, ppf, contentWidth } = useMetrics()
  if (!row.window) return null
  const [a, b] = row.window
  const left = Math.max(0, frameToX(a, ip, ppf))
  const right = Math.min(contentWidth, frameToX(b, ip, ppf))
  return (
    <>
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-surface-1/60"
        style={{ width: left }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 bg-surface-1/60"
        style={{ left: Math.max(left, right) }}
      />
    </>
  )
}

function SummaryKeys({
  row,
  props,
  owner,
}: {
  row: FlatRow
  props: readonly PropNode[]
  owner: NodePath
}) {
  const ctl = useController()
  const { ip, ppf } = useMetrics()
  const keys = summaryKeys(props)
  // One character per summary key ("0" none, "1" some, "2" all selected): re-render only on change.
  const states = useDocument((s) => {
    const index = indexSelection(s.selection)
    if (index.keyCount === 0) return ''
    return keys
      .map((k) => {
        const n = k.refs.reduce((acc, r) => acc + (isRefSelected(index, r) ? 1 : 0), 0)
        return n === 0 ? '0' : n === k.refs.length ? '2' : '1'
      })
      .join('')
  })
  const map = row.map
  if (!map) return null
  return (
    <>
      {keys.map((s, i) => {
        const root = map.toRoot(s.t)
        const selected = states[i] === '2'
        const partly = states[i] === '1'
        return (
          <div
            key={s.t}
            data-ctx="summary"
            data-row={row.key}
            data-time={s.t}
            className="group/key absolute top-0 flex h-full w-3.5 -translate-x-1/2 items-center justify-center"
            style={{ left: frameToX(root, ip, ppf) }}
            onPointerDown={(e) =>
              ctl.onKeysPointerDown(e, row, s.refs, root, { focus: null, nodes: [owner] })
            }
            onDoubleClick={() => setFrame(root, { allowSubframe: !Number.isInteger(root) })}
          >
            <KeyGlyph
              size={9}
              tone={selected || partly ? 'summarySelected' : 'summary'}
              className={cn(partly && 'opacity-60')}
            />
          </div>
        )
      })}
    </>
  )
}

function LayerTrack({ row }: { row: FlatRow }) {
  const ctl = useController()
  const { ip, ppf } = useMetrics()
  const selected = useNodeSelected(row.model.path)
  const locked = useNodeLocked(row.model.path)
  const soloHidden = useSoloState(row.model.path) === 'hidden'
  const map = row.map
  if (!map) return null
  const layer = row.model.layer
  const a = frameToX(map.toRoot(layer.ip), ip, ppf)
  const b = frameToX(map.toRoot(layer.op), ip, ppf)
  const hidden = !!layer.hd
  const color = LABEL_VAR[row.model.kind]
  const width = Math.max(2, b - a)
  const handle = Math.min(6, width / 3)
  const editable = map.linear && !locked
  return (
    <>
      <div
        data-ctx="layer"
        data-row={row.key}
        className={cn(
          'group/bar absolute top-[5px] bottom-[5px] rounded-[3px]',
          selected && 'shadow-[inset_0_0_0_1px_var(--le-accent)]',
          hidden && 'border border-dashed',
          // Not in the preview while another layer is soloed.
          soloHidden && 'opacity-40',
        )}
        style={{
          left: a,
          width,
          background: hidden
            ? 'transparent'
            : `color-mix(in oklab, ${color} ${selected ? 36 : 20}%, transparent)`,
          borderColor: hidden ? `color-mix(in oklab, ${color} 55%, transparent)` : undefined,
          boxShadow:
            selected || hidden
              ? undefined
              : `inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)`,
        }}
        onPointerDown={(e) => ctl.onBarPointerDown(e, row, 'move')}
        onDoubleClick={() => ctl.zoomToRange(map.toRoot(layer.ip), map.toRoot(layer.op))}
        onPointerEnter={() => hoverOn(row.model.path)}
        onPointerLeave={() => hoverOff(row.model.path)}
      >
        {editable &&
          (['in', 'out'] as const).map((edge) => (
            <div
              key={edge}
              className={cn(
                'group/edge absolute inset-y-0 cursor-ew-resize',
                edge === 'in' ? 'left-0' : 'right-0',
              )}
              style={{ width: handle }}
              onPointerDown={(e) => ctl.onBarPointerDown(e, row, edge)}
            >
              {/* Trim grip: appears when hovering the bar, solid on the edge itself. */}
              <span
                className={cn(
                  'absolute inset-y-[3px] w-[2px] rounded-full opacity-0 transition-opacity duration-100',
                  'group-hover/bar:opacity-50 group-hover/edge:opacity-100',
                  edge === 'in' ? 'left-[2px]' : 'right-[2px]',
                )}
                style={{ background: color }}
              />
            </div>
          ))}
      </div>
      {!row.expanded && <SummaryKeys row={row} props={row.model.props} owner={row.model.path} />}
      <WindowShade row={row} />
    </>
  )
}

function GroupTrack({ row }: { row: FlatRow }) {
  const node = row.node
  if (!node || node.kind !== 'group' || row.expanded) return <WindowShade row={row} />
  return (
    <>
      <SummaryKeys row={row} props={node.props} owner={node.owner} />
      <WindowShade row={row} />
    </>
  )
}

function PropertyTrack({ row }: { row: FlatRow }) {
  const ctl = useController()
  const { ip, ppf } = useMetrics()
  const node = row.node as PropNode
  const signature = useSelectedIndices(node.path)
  const selected = useMemo(
    () => (signature ? new Set(signature.split(',').map(Number)) : undefined),
    [signature],
  )
  const map = row.map
  if (!map) return null
  const kfs = getKeyframes(node.prop) ?? []
  const xs = kfs.map((kf) => frameToX(map.toRoot(kf.t), ip, ppf))
  const refs = (i: number): KeyRef[] => [{ path: node.path, index: i }]
  return (
    <>
      {kfs.slice(0, -1).map((kf, i) => {
        const x1 = xs[i]
        const x2 = xs[i + 1]
        const width = x2 - x1 - 10
        if (width < 2) return null
        const both = !!selected?.has(i) && !!selected?.has(i + 1)
        const hold = kf.h === 1 || node.textKeys
        const glyph = width >= 34 && !node.textKeys
        return (
          <div
            key={`s${i}`}
            data-ctx="segment"
            data-row={row.key}
            data-index={i}
            // A band around the line, not the full row: a drag from the row's top or bottom
            // edge still starts a marquee between dense keys.
            className="group/seg absolute top-1/2 flex h-3 -translate-y-1/2 items-center justify-center"
            style={{ left: x1 + 5, width }}
            onPointerDown={(e) =>
              ctl.onKeysPointerDown(e, row, [...refs(i), ...refs(i + 1)], map.toRoot(kf.t), {
                focus: node.path,
              })
            }
          >
            <div
              className={cn(
                'absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full transition-colors duration-100',
                both ? 'h-3 bg-accent-subtle' : 'h-2 bg-transparent group-hover/seg:bg-hover',
              )}
            />
            {(glyph ? [0, 1] : [-1]).map((part) => (
              <div
                key={part}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2',
                  hold ? 'border-t border-dashed' : 'h-px',
                  both
                    ? hold
                      ? 'border-accent'
                      : 'bg-accent'
                    : hold
                      ? 'border-line-strong group-hover/seg:border-fg-faint'
                      : 'bg-line-strong group-hover/seg:bg-fg-faint',
                )}
                // With a curve glyph in the middle the line stops short of it on both sides.
                style={
                  part === -1
                    ? { left: 0, right: 0 }
                    : part === 0
                      ? { left: 0, right: '50%', marginRight: 13 }
                      : { left: '50%', right: 0, marginLeft: 13 }
                }
              />
            ))}
            {glyph && (
              <span
                className={cn(
                  'relative',
                  both ? 'text-accent-text' : 'text-fg-faint group-hover/seg:text-fg-subtle',
                )}
              >
                <EasingGlyph curve={curveOf(kf)} />
              </span>
            )}
          </div>
        )
      })}
      {kfs.map((kf, i) => {
        const root = map.toRoot(kf.t)
        const isSelected = !!selected?.has(i)
        return (
          <div
            key={`k${i}`}
            data-ctx="key"
            data-row={row.key}
            data-index={i}
            className="group/key absolute top-0 z-[1] flex h-full w-3.5 -translate-x-1/2 items-center justify-center"
            style={{ left: xs[i] }}
            onPointerDown={(e) =>
              ctl.onKeysPointerDown(e, row, refs(i), root, { focus: node.path })
            }
            onDoubleClick={() => setFrame(root, { allowSubframe: !Number.isInteger(root) })}
          >
            <KeyGlyph
              sides={keySides(kfs, i, node.textKeys)}
              tone={isSelected ? 'selected' : map.linear ? 'normal' : 'muted'}
            />
          </div>
        )
      })}
      <WindowShade row={row} />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                                     Row                                    */
/* -------------------------------------------------------------------------- */

export const TimelineRow = memo(function TimelineRow({
  row,
  first,
}: {
  row: FlatRow
  first: boolean
}) {
  const ctl = useController()
  const { namesWidth, contentWidth } = useMetrics()
  const selected = useNodeSelected(row.model.path)
  // The graph editor covers the tracks: no need to render them underneath.
  const graph = useTimelinePrefs((s) => s.graph)
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={row.kind === 'layer' ? selected : undefined}
      className={cn(
        'absolute inset-x-0 flex',
        row.kind === 'layer' && !first && 'border-t border-line-subtle',
      )}
      style={{ top: row.top, height: row.height }}
    >
      <div className="flex h-full shrink-0 border-r border-line" style={{ width: namesWidth }}>
        {row.kind === 'layer' ? (
          <LayerName row={row} />
        ) : row.kind === 'group' ? (
          <GroupName row={row} />
        ) : (
          <PropertyName row={row} />
        )}
      </div>
      <div
        data-ctx="track"
        data-row={row.key}
        className="relative h-full min-w-0 flex-1 overflow-hidden"
        onPointerDown={(e) => ctl.onTrackPointerDown(e)}
      >
        {!graph && (
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: contentWidth, transform: 'translateX(var(--sx))' }}
          >
            {row.kind === 'layer' ? (
              <LayerTrack row={row} />
            ) : row.kind === 'group' ? (
              <GroupTrack row={row} />
            ) : (
              <PropertyTrack row={row} />
            )}
          </div>
        )}
      </div>
    </div>
  )
})
