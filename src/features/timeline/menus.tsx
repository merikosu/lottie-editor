/**
 * Right-click menus of the timeline. One Radix context menu wraps the whole timeline; what
 * was clicked (key, segment, layer, property, marker, ruler, empty track) decides the items.
 * Items reuse registered commands (same titles, shortcuts and enabled rules as the menus
 * and the palette); commands from other features appear only when they are registered.
 */
import { Braces, Copy, Pencil, Play, Scissors, Trash2, type LucideIcon } from 'lucide-react'
import { useState, type ComponentType, type MouseEvent, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
} from '@/components/ui'
import {
  getCommand,
  isCommandEnabled,
  primaryShortcut,
  runCommand,
  useCommands,
  type IconProps,
} from '@/commands/registry'
import { ArrangeMenu, NodeStateItems, ParentMenu } from '@/features/layers'
import { useT } from '@/i18n'
import { emit } from '@/lib/events'
import { EASING_PRESETS, matchPreset, type BezierCurve } from '@/lottie/easing'
import { makeStatic } from '@/lottie/keyframes'
import {
  getMarkers,
  markerDuration,
  markerEnd,
  nextMarkerIndex,
  setMarkerDuration,
  removeMarkers,
} from '@/lottie/markers'
import { getAt, isLayerPath, pathKey, setAt, type NodePath } from '@/lottie/path'
import { getKeyframes, type AnyProperty } from '@/lottie/property'
import { allKeyRefs, normalizeLegacyKeys, type KeyRef } from '@/lottie/timeline-ops'
import {
  focusProperty,
  getDoc,
  isNodeSelected,
  selectNodes,
  updateDoc,
  useDocument,
} from '@/store/document'
import {
  play,
  setFrame,
  setWorkArea,
  setWorkAreaEnd,
  setWorkAreaStart,
  usePlayback,
} from '@/store/playback'
import { addMarkerAt, pasteKeys, toggleGraphFit, toggleGraphNormalize } from './actions'
import { hasKeyClipboard, useKeyClipboard } from './clipboard'
import { useController } from './context'
import { getGraphRuntime } from './graph/runtime'
import { asGraphSelection } from './graph/state'
import { curveOf, easingPath } from './interp'
import { summaryKeys, type FlatRow, type PropNode } from './model'
import { indexSelection, isRefSelected, selectFromTimeline, selectKeys } from './selection'
import {
  setTimelinePrefs,
  setTimelineView,
  useTimelinePrefs,
  useTimelineView,
  type GraphMode,
} from './store'

type Target =
  /** `clicked`: the key (or summary time) under the pointer, in `row`'s time. */
  | { kind: 'key'; row: FlatRow; refs: KeyRef[]; clicked: number | null }
  | { kind: 'layer'; row: FlatRow }
  | { kind: 'property'; row: FlatRow }
  | { kind: 'group'; row: FlatRow }
  | { kind: 'marker'; index: number }
  | { kind: 'ruler'; frame: number }
  | { kind: 'empty'; frame: number }
  /** Graph editor: a key or segment (`clicked`: the key's root frame) or empty space. */
  | { kind: 'graphKey'; path: NodePath; clicked: number | null }
  | { kind: 'graph'; frame: number }

/* -------------------------------------------------------------------------- */
/*                                  Item kinds                                */
/* -------------------------------------------------------------------------- */

/** A menu item bound to a registered command (hidden when the command is not registered). */
function CommandItem({ id, label, icon }: { id: string; label?: string; icon?: LucideIcon }) {
  const t = useT()
  const cmd = getCommand(id)
  if (!cmd) return null
  return (
    <MenuItem
      kind="context"
      icon={icon ?? cmd.icon}
      shortcut={primaryShortcut(cmd)}
      disabled={!isCommandEnabled(cmd)}
      onSelect={() => runCommand(id)}
    >
      {label ?? cmd.title(t)}
    </MenuItem>
  )
}

function Item({
  children,
  onSelect,
  icon,
  shortcut,
  disabled,
}: {
  children: ReactNode
  onSelect: () => void
  icon?: LucideIcon
  shortcut?: string
  disabled?: boolean
}) {
  return (
    <MenuItem
      kind="context"
      icon={icon}
      shortcut={shortcut}
      disabled={disabled}
      onSelect={onSelect}
    >
      {children}
    </MenuItem>
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Keyframes                                 */
/* -------------------------------------------------------------------------- */

function makeCurveIcon(curve: BezierCurve | null): ComponentType<IconProps> {
  function CurveIcon({ size = 14, className }: IconProps) {
    const s = typeof size === 'number' ? size : 14
    return (
      <svg width={s} height={s} viewBox="-2 -2 18 18" aria-hidden className={className}>
        <path
          d={easingPath(curve, 14, 14)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return CurveIcon
}

/** Menu icons of the easing presets (created once, by preset id). */
const PRESET_ICONS: Record<string, ComponentType<IconProps>> = Object.fromEntries(
  EASING_PRESETS.map((p) => [p.id, makeCurveIcon(p.curve)]),
)

/** The preset every selected easing matches, if they all agree. */
function currentPresetId(): string | null {
  const doc = getDoc()
  const refs = useDocument.getState().selection.keyframes
  if (!doc || refs.length === 0) return null
  let id: string | null | undefined
  for (const ref of refs) {
    const kfs = getKeyframes(getAt<AnyProperty>(doc, ref.path))
    if (!kfs || ref.index >= kfs.length - 1) continue
    const preset = matchPreset(curveOf(kfs[ref.index]))?.id ?? null
    if (id === undefined) id = preset
    else if (id !== preset) return null
  }
  return id ?? null
}

function EasingMenu() {
  const t = useT()
  const current = currentPresetId()
  const names = t.timeline.easing as Record<string, string>
  return (
    <MenuSub kind="context" label={t.timeline.menu.easing}>
      {EASING_PRESETS.map((preset) => (
        <MenuItem
          key={preset.id}
          kind="context"
          icon={PRESET_ICONS[preset.id]}
          onSelect={() => runCommand(`keyframes.easing.${preset.id}`)}
        >
          <span className="flex items-center justify-between gap-3">
            {names[preset.id] ?? preset.id}
            {current === preset.id && (
              <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
            )}
          </span>
        </MenuItem>
      ))}
    </MenuSub>
  )
}

function KeyMenu({ target }: { target: Extract<Target, { kind: 'key' }> }) {
  const t = useT()
  const m = t.timeline.menu
  const node = target.row.node?.kind === 'property' ? target.row.node : null
  // "Go to key": the key that was right-clicked, in the instance whose row it was clicked in.
  const map = target.row.map
  const clicked = target.clicked
  return (
    <>
      <EasingMenu />
      <CommandItem id="keyframes.easyEase" label={m.easyEase} />
      <CommandItem id="keyframes.easeIn" label={m.easyEaseIn} />
      <CommandItem id="keyframes.easeOut" label={m.easyEaseOut} />
      <CommandItem id="keyframes.toggleHold" label={m.toggleHold} />
      <MenuSeparator kind="context" />
      <CommandItem id="keyframes.copy" label={m.copy} icon={Copy} />
      <CommandItem id="keyframes.cut" label={m.cut} icon={Scissors} />
      <CommandItem id="keyframes.paste" label={m.paste} />
      <CommandItem id="keyframes.delete" label={m.delete} icon={Trash2} />
      <MenuSeparator kind="context" />
      {node && (
        <Item
          onSelect={() =>
            selectKeys(allKeyRefs(getDoc()!, [node.path]), 'replace', { focus: node.path })
          }
        >
          {m.selectAllOnProperty}
        </Item>
      )}
      {clicked !== null && map && (
        <Item
          onSelect={() => {
            const root = map.toRoot(clicked)
            setFrame(root, { allowSubframe: !Number.isInteger(root) })
          }}
        >
          {m.goToKey}
        </Item>
      )}
      <CommandItem id="keyframes.reverse" label={m.reverse} />
      <CommandItem id="keyframes.distribute" label={m.distribute} />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                               Layers and rows                              */
/* -------------------------------------------------------------------------- */

const ARRANGE = [
  'layer.bringToFront',
  'layer.bringForward',
  'layer.sendBackward',
  'layer.sendToBack',
]

function LayerMenu({ target }: { target: Extract<Target, { kind: 'layer' }> }) {
  const t = useT()
  const m = t.timeline.menu
  const doc = useDocument((s) => s.doc)
  const selectedLayers = useDocument((s) => s.selection.nodes)
  const path = target.row.model.path
  const hasKeys = target.row.model.props.length > 0
  // Parent ▸ acts on the selected layers of the clicked layer's composition (same as the tree).
  const comp = pathKey(path.slice(0, -1))
  const parentable = selectedLayers.filter(
    (p) => isLayerPath(p) && pathKey(p.slice(0, -1)) === comp,
  )
  return (
    <>
      <Item icon={Pencil} onSelect={() => setTimelineView({ renaming: target.row.key })}>
        {m.rename}
      </Item>
      <CommandItem id="edit.duplicate" />
      <CommandItem id="edit.delete" icon={Trash2} />
      {/* Same items as the layer panel and the canvas: labels follow the selection's state. */}
      <NodeStateItems kind="context" />
      {ARRANGE.some((id) => getCommand(id)) && <ArrangeMenu kind="context" />}
      {doc && parentable.length > 0 && <ParentMenu doc={doc} layers={parentable} />}
      <MenuSeparator kind="context" />
      <CommandItem id="layer.revealKeyframes" label={m.revealKeys} />
      {hasKeys && (
        <Item
          onSelect={() =>
            selectKeys(
              allKeyRefs(
                getDoc()!,
                target.row.model.props.map((p) => p.path),
              ),
              'replace',
              { focus: null, nodes: [path] },
            )
          }
        >
          {m.selectLayerKeys}
        </Item>
      )}
      <MenuSeparator kind="context" />
      <CommandItem id="timeline.moveInPoint" label={m.moveInToPlayhead} />
      <CommandItem id="timeline.moveOutPoint" label={m.moveOutToPlayhead} />
      <CommandItem id="timeline.trimInPoint" label={m.trimInToPlayhead} />
      <CommandItem id="timeline.trimOutPoint" label={m.trimOutToPlayhead} />
      <MenuSeparator kind="context" />
      <Item icon={Braces} onSelect={() => emit('reveal-code', { path })}>
        {m.showInJson}
      </Item>
    </>
  )
}

function PropertyMenu({ target }: { target: Extract<Target, { kind: 'property' }> }) {
  const t = useT()
  const m = t.timeline.menu
  const node = target.row.node as PropNode
  const map = target.row.map
  const clip = useKeyClipboard((s) => s.clip)
  const removeAnimation = () => {
    const doc = getDoc()
    const original = doc ? getAt<AnyProperty>(doc, node.path) : undefined
    if (!original || !map) return
    const frame = map.toLocal(Math.round(usePlayback.getState().frame))
    // Evaluated on a plain copy: keyframe helpers must not clone draft values.
    const copy = structuredClone(original)
    normalizeLegacyKeys(copy)
    makeStatic(copy, frame)
    updateDoc(t.timeline.history.removeAnimation, (d) => setAt(d, node.path, copy))
  }
  return (
    <>
      <Item
        onSelect={() =>
          selectKeys(allKeyRefs(getDoc()!, [node.path]), 'replace', { focus: node.path })
        }
      >
        {m.selectAllOnProperty}
      </Item>
      <Item
        icon={Copy}
        onSelect={() => {
          selectKeys(allKeyRefs(getDoc()!, [node.path]), 'replace', { focus: node.path })
          runCommand('keyframes.copy')
        }}
      >
        {m.copy}
      </Item>
      <Item
        disabled={!clip || node.textKeys}
        onSelect={() => {
          focusProperty(node.path)
          pasteKeys()
        }}
      >
        {m.paste}
      </Item>
      <MenuSeparator kind="context" />
      <Item disabled={!map || node.textKeys} onSelect={removeAnimation}>
        {m.removeAnimation}
      </Item>
      <MenuSeparator kind="context" />
      <Item icon={Braces} onSelect={() => emit('reveal-code', { path: node.path })}>
        {m.showInJson}
      </Item>
    </>
  )
}

function GroupMenu({ target }: { target: Extract<Target, { kind: 'group' }> }) {
  const t = useT()
  const m = t.timeline.menu
  const node = target.row.node
  if (!node || node.kind !== 'group') return null
  return (
    <>
      <Item
        onSelect={() =>
          selectKeys(
            allKeyRefs(
              getDoc()!,
              node.props.map((p) => p.path),
            ),
            'replace',
            { focus: null, nodes: [node.owner] },
          )
        }
      >
        {m.selectLayerKeys}
      </Item>
      <MenuSeparator kind="context" />
      <Item icon={Braces} onSelect={() => emit('reveal-code', { path: node.owner })}>
        {m.showInJson}
      </Item>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                           Markers, ruler, empty track                      */
/* -------------------------------------------------------------------------- */

function MarkerMenu({ index }: { index: number }) {
  const t = useT()
  const m = t.timeline.menu
  const marker = useDocument((s) => (s.doc ? getMarkers(s.doc)[index] : undefined))
  if (!marker) return null
  const markers = getMarkers(getDoc()!)
  const next = nextMarkerIndex(markers, marker.tm)
  const dr = markerDuration(marker)
  return (
    <>
      <Item icon={Pencil} onSelect={() => setTimelineView({ renamingMarker: index })}>
        {m.renameMarker}
      </Item>
      <Item onSelect={() => setFrame(marker.tm)}>{m.goToMarker}</Item>
      <Item
        icon={Play}
        disabled={dr <= 0}
        onSelect={() => {
          setWorkArea({ start: marker.tm, end: markerEnd(marker) })
          setFrame(marker.tm)
          play()
        }}
      >
        {m.playSegment}
      </Item>
      {next >= 0 && (
        <Item
          onSelect={() =>
            updateDoc(t.timeline.history.markerDuration, (d) =>
              setMarkerDuration(d, index, markers[next].tm - marker.tm),
            )
          }
        >
          {m.extendToNext}
        </Item>
      )}
      <MenuSeparator kind="context" />
      <Item
        icon={Trash2}
        onSelect={() =>
          updateDoc(t.timeline.history.deleteMarker, (d) => removeMarkers(d, [index]))
        }
      >
        {m.deleteMarker}
      </Item>
    </>
  )
}

function RulerMenu({ frame }: { frame: number }) {
  const t = useT()
  const m = t.timeline.menu
  const workArea = usePlayback((s) => s.workArea)
  return (
    <>
      <Item
        onSelect={() => setWorkAreaStart(frame)}
        shortcut={primaryShortcut(getCommand('playback.setWorkStart'))}
      >
        {t.commands.setWorkStart}
      </Item>
      <Item
        onSelect={() => setWorkAreaEnd(frame)}
        shortcut={primaryShortcut(getCommand('playback.setWorkEnd'))}
      >
        {t.commands.setWorkEnd}
      </Item>
      <Item
        icon={Play}
        disabled={!workArea}
        onSelect={() => {
          if (!workArea) return
          setFrame(workArea.start)
          play()
        }}
      >
        {m.playWorkArea}
      </Item>
      <CommandItem id="playback.clearWorkArea" label={m.clearWorkArea} />
      <CommandItem id="anim.trim" />
      <MenuSeparator kind="context" />
      <Item onSelect={() => addMarkerAt(frame)}>{m.addMarkerHere}</Item>
    </>
  )
}

function EmptyMenu({ frame }: { frame: number }) {
  const t = useT()
  const m = t.timeline.menu
  useKeyClipboard((s) => s.clip)
  return (
    <>
      <Item disabled={!hasKeyClipboard()} onSelect={() => pasteKeys()}>
        {m.paste}
      </Item>
      <CommandItem id="keyframes.selectAll" />
      <MenuSeparator kind="context" />
      <Item onSelect={() => addMarkerAt(frame)}>{m.addMarkerHere}</Item>
      <CommandItem id="layer.revealKeyframes" label={m.revealKeys} />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                                 Graph editor                               */
/* -------------------------------------------------------------------------- */

function GraphViewItems() {
  const t = useT()
  const g = t.timeline.graph
  const mode = useTimelinePrefs((s) => s.graphMode)
  const normalize = useTimelinePrefs((s) => s.graphNormalize)
  const fit = useTimelineView((s) => s.graphFit)
  return (
    <>
      <MenuRadioGroup
        kind="context"
        value={mode}
        onValueChange={(v) => setTimelinePrefs({ graphMode: v as GraphMode })}
      >
        <MenuRadioItem kind="context" value="value">
          {g.valueGraph}
        </MenuRadioItem>
        <MenuRadioItem kind="context" value="speed">
          {g.speedGraph}
        </MenuRadioItem>
      </MenuRadioGroup>
      <MenuSeparator kind="context" />
      <MenuCheckboxItem kind="context" checked={normalize} onCheckedChange={toggleGraphNormalize}>
        {g.normalizeMenu}
      </MenuCheckboxItem>
      <MenuCheckboxItem kind="context" checked={fit} onCheckedChange={toggleGraphFit}>
        {g.fit}
      </MenuCheckboxItem>
    </>
  )
}

function GraphKeyMenu({ target }: { target: Extract<Target, { kind: 'graphKey' }> }) {
  const t = useT()
  const m = t.timeline.menu
  const clicked = target.clicked
  return (
    <>
      <EasingMenu />
      <CommandItem id="keyframes.easyEase" label={m.easyEase} />
      <CommandItem id="keyframes.easeIn" label={m.easyEaseIn} />
      <CommandItem id="keyframes.easeOut" label={m.easyEaseOut} />
      <CommandItem id="keyframes.toggleHold" label={m.toggleHold} />
      <MenuSeparator kind="context" />
      <CommandItem id="keyframes.copy" label={m.copy} icon={Copy} />
      <CommandItem id="keyframes.cut" label={m.cut} icon={Scissors} />
      <CommandItem id="keyframes.paste" label={m.paste} />
      <CommandItem id="keyframes.delete" label={m.delete} icon={Trash2} />
      <MenuSeparator kind="context" />
      <Item
        onSelect={() =>
          // The other curves stay on screen: this is a selection made in the graph.
          asGraphSelection(() =>
            selectKeys(allKeyRefs(getDoc()!, [target.path]), 'replace', { focus: target.path }),
          )
        }
      >
        {m.selectAllOnProperty}
      </Item>
      {clicked !== null && (
        <Item onSelect={() => setFrame(clicked, { allowSubframe: !Number.isInteger(clicked) })}>
          {m.goToKey}
        </Item>
      )}
      <CommandItem id="keyframes.reverse" label={m.reverse} />
      <CommandItem id="keyframes.distribute" label={m.distribute} />
      <MenuSeparator kind="context" />
      <GraphViewItems />
    </>
  )
}

function GraphMenu({ frame }: { frame: number }) {
  const t = useT()
  const m = t.timeline.menu
  useKeyClipboard((s) => s.clip)
  return (
    <>
      <Item disabled={!hasKeyClipboard()} onSelect={() => pasteKeys()}>
        {m.paste}
      </Item>
      <CommandItem id="keyframes.selectAll" />
      <Item onSelect={() => addMarkerAt(frame)}>{m.addMarkerHere}</Item>
      <MenuSeparator kind="context" />
      <GraphViewItems />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Wrapper                                  */
/* -------------------------------------------------------------------------- */

/** Resolves what was right-clicked and adjusts the selection like a left click would. */
function resolveTarget(
  el: HTMLElement | null,
  rowsByKey: Map<string, FlatRow>,
  frame: number,
  notePreferred: (row: FlatRow) => void,
  client: { x: number; y: number },
): Target {
  const hit = el?.closest<HTMLElement>('[data-ctx]')
  const kind = hit?.dataset.ctx
  if (kind === 'graph') {
    const key = getGraphRuntime()?.contextTarget(client.x, client.y)
    return key
      ? { kind: 'graphKey', path: key.path, clicked: key.clicked }
      : { kind: 'graph', frame }
  }
  const row = hit?.dataset.row ? rowsByKey.get(hit.dataset.row) : undefined
  const index = hit?.dataset.index !== undefined ? Number(hit.dataset.index) : -1
  const sel = indexSelection(useDocument.getState().selection)
  const doc = getDoc()
  // Commands of the menu (paste, trims at the playhead…) use the timing of this instance.
  if (row) notePreferred(row)

  if (row && (kind === 'key' || kind === 'segment') && row.node?.kind === 'property') {
    const path = row.node.path
    const refs: KeyRef[] =
      kind === 'key'
        ? [{ path, index }]
        : [
            { path, index },
            { path, index: index + 1 },
          ]
    if (!refs.every((r) => isRefSelected(sel, r))) selectKeys(refs, 'replace', { focus: path })
    const kf = getKeyframes(row.node.prop)?.[index]
    return {
      kind: 'key',
      row,
      refs: useDocument.getState().selection.keyframes,
      clicked: kf ? kf.t : null,
    }
  }
  if (row && kind === 'summary') {
    const time = Number(hit?.dataset.time)
    const props =
      row.kind === 'layer' ? row.model.props : row.node?.kind === 'group' ? row.node.props : []
    const refs = summaryKeys(props).find((s) => s.t === time)?.refs ?? []
    if (refs.length && !refs.every((r) => isRefSelected(sel, r))) {
      selectKeys(refs, 'replace', { focus: null, nodes: [row.node?.owner ?? row.model.path] })
    }
    return {
      kind: 'key',
      row,
      refs: useDocument.getState().selection.keyframes,
      clicked: Number.isFinite(time) ? time : null,
    }
  }
  if (row && kind === 'layer') {
    const path = row.model.path
    if (!isNodeSelected(useDocument.getState().selection, path))
      selectFromTimeline(() => selectNodes([path], 'replace'))
    return { kind: 'layer', row }
  }
  if (row && kind === 'property' && row.node?.kind === 'property') {
    focusProperty(row.node.path)
    return { kind: 'property', row }
  }
  if (row && kind === 'group') return { kind: 'group', row }
  if (kind === 'marker' && index >= 0 && doc && getMarkers(doc)[index])
    return { kind: 'marker', index }
  if (kind === 'ruler' || kind === 'workarea' || kind === 'markers') return { kind: 'ruler', frame }
  return { kind: 'empty', frame }
}

export function TimelineContextMenu({ children }: { children: ReactNode }) {
  const ctl = useController()
  const [target, setTarget] = useState<Target | null>(null)
  // Menus read the registry: re-render when commands are (un)registered.
  useCommands()
  const onContextMenuCapture = (e: MouseEvent) => {
    const doc = getDoc()
    if (!doc) return
    const frame = Math.round(ctl.clientXToFrame(e.clientX))
    const clamped = Math.min(Math.max(frame, doc.ip), Math.ceil(doc.op) - 1)
    setTarget(
      resolveTarget(
        e.target as HTMLElement,
        ctl.rows().byKey,
        clamped,
        (row) => ctl.notePreferred(row),
        { x: e.clientX, y: e.clientY },
      ),
    )
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="contents" onContextMenuCapture={onContextMenuCapture}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[232px]">
        {target?.kind === 'key' && <KeyMenu target={target} />}
        {target?.kind === 'layer' && <LayerMenu target={target} />}
        {target?.kind === 'property' && <PropertyMenu target={target} />}
        {target?.kind === 'group' && <GroupMenu target={target} />}
        {target?.kind === 'marker' && <MarkerMenu index={target.index} />}
        {target?.kind === 'ruler' && <RulerMenu frame={target.frame} />}
        {target?.kind === 'empty' && <EmptyMenu frame={target.frame} />}
        {target?.kind === 'graphKey' && <GraphKeyMenu target={target} />}
        {target?.kind === 'graph' && <GraphMenu frame={target.frame} />}
      </ContextMenuContent>
    </ContextMenu>
  )
}
