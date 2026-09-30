/**
 * Menu contents of the layer tree: new layers, new shape items and the row context menu.
 * Items run registered commands where one exists, so labels, shortcuts and enabled states
 * match the app menus and the command palette.
 */
import {
  ArrowDownToLine,
  ArrowUpDown,
  ArrowUpFromLine,
  Braces,
  Circle,
  CircleDot,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crosshair,
  Eye,
  EyeOff,
  Focus,
  Group,
  Hexagon,
  Image,
  LayersArrowUp,
  Link2,
  Lock,
  LockOpen,
  PaintBucket,
  PenLine,
  Plus,
  RectangleHorizontal,
  Repeat2,
  Scissors,
  Spline,
  Square,
  SquareDashed,
  Star,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react'
import type { ComponentType } from 'react'
import {
  isCommandEnabled,
  primaryShortcut,
  runCommand,
  useCommands,
  type IconProps,
} from '@/commands/registry'
import {
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  type MenuKind,
} from '@/components/ui'
import { LayerKindIcon } from '@/components/lottie/icons'
import { useT } from '@/i18n'
import { getAt, isLayerPath, isShapePath, type NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'
import { useDocument } from '@/store/document'
import {
  addShapeItemTo,
  labelOf,
  parentCandidates,
  selectedNodes,
  setParentOf,
  shapeContainer,
  showInJson,
  ungroupState,
  zoomToNode,
  type ShapeItemKind,
} from './actions'
import { nodeKeyOf } from './keys'
import { releaseBlockerLabel, releaseState } from './precompose'
import { collapseAll, useLayersView } from './state'

/** Menu item bound to a registered command (hidden when the command is not registered). */
function CommandItem({
  id,
  kind,
  icon,
  label,
  shortcut,
}: {
  id: string
  kind: MenuKind
  icon?: ComponentType<IconProps>
  label?: string
  /** Shortcut to display when the command has none of its own (native events such as paste). */
  shortcut?: string
}) {
  const t = useT()
  const cmd = useCommands().get(id)
  if (!cmd) return null
  return (
    <MenuItem
      kind={kind}
      icon={icon ?? cmd.icon}
      shortcut={primaryShortcut(cmd) ?? shortcut}
      disabled={!isCommandEnabled(cmd)}
      onSelect={() => runCommand(id)}
    >
      {label ?? cmd.title(t)}
    </MenuItem>
  )
}

type NewLayerKey = 'rect' | 'ellipse' | 'star' | 'polygon' | 'text' | 'solid' | 'null' | 'image'

const NEW_LAYER_ITEMS: Array<
  { id: string; icon: ComponentType<IconProps>; key: NewLayerKey } | '-'
> = [
  { id: 'layer.new.rect', icon: RectangleHorizontal, key: 'rect' },
  { id: 'layer.new.ellipse', icon: Circle, key: 'ellipse' },
  { id: 'layer.new.star', icon: Star, key: 'star' },
  { id: 'layer.new.polygon', icon: Hexagon, key: 'polygon' },
  '-',
  { id: 'layer.new.text', icon: Type, key: 'text' },
  { id: 'layer.new.image', icon: Image, key: 'image' },
  '-',
  { id: 'layer.new.solid', icon: Square, key: 'solid' },
  { id: 'layer.new.null', icon: Crosshair, key: 'null' },
]

/** "New layer" items (Rectangle, Ellipse, …, Image…). */
export function NewLayerItems({ kind }: { kind: MenuKind }) {
  const t = useT()
  return (
    <>
      {NEW_LAYER_ITEMS.map((item, i) =>
        item === '-' ? (
          <MenuSeparator kind={kind} key={`sep-${i}`} />
        ) : (
          <CommandItem
            key={item.id}
            id={item.id}
            kind={kind}
            icon={item.icon}
            label={t.layers.newLayer[item.key]}
          />
        ),
      )}
    </>
  )
}

const SHAPE_ITEMS: Array<{ kind: ShapeItemKind; icon: ComponentType<IconProps> } | '-'> = [
  { kind: 'rect', icon: Square },
  { kind: 'ellipse', icon: Circle },
  { kind: 'star', icon: Star },
  { kind: 'polygon', icon: Hexagon },
  '-',
  { kind: 'fill', icon: PaintBucket },
  { kind: 'stroke', icon: Spline },
  { kind: 'gradientFill', icon: PaintBucket },
  '-',
  { kind: 'trimPaths', icon: Scissors },
  { kind: 'repeater', icon: Repeat2 },
  { kind: 'roundCorners', icon: Circle },
  '-',
  { kind: 'group', icon: SquareDashed },
]

/** Items adding shape content (paths, fill, stroke, modifiers, group) to `container`. */
export function ShapeItemItems({ kind, container }: { kind: MenuKind; container: NodePath }) {
  const t = useT()
  return (
    <>
      {SHAPE_ITEMS.map((item, i) =>
        item === '-' ? (
          <MenuSeparator kind={kind} key={`sep-${i}`} />
        ) : (
          <MenuItem
            key={item.kind}
            kind={kind}
            icon={item.icon}
            onSelect={() => addShapeItemTo(container, item.kind)}
          >
            {t.layers.shapeItems[item.kind]}
          </MenuItem>
        ),
      )}
    </>
  )
}

/** Content of the "+" menu: new layers, plus shape content for the selected shape. */
export function AddMenuItems({ kind }: { kind: MenuKind }) {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const selection = useDocument((s) => s.selection)
  const container = shapeContainer(doc, selection)
  return (
    <>
      <MenuLabel kind={kind}>{t.layers.newLayer.section}</MenuLabel>
      <NewLayerItems kind={kind} />
      {container && doc && (
        <>
          <MenuSeparator kind={kind} />
          <MenuSub kind={kind} icon={Plus} label={t.layers.addToShape(labelOf(doc, container))}>
            <ShapeItemItems kind={kind} container={container} />
          </MenuSub>
        </>
      )}
    </>
  )
}

function hasKey(doc: Animation, path: NodePath, record: Record<string, true>): boolean {
  const key = nodeKeyOf(doc, path)
  return !!key && !!record[key]
}

/**
 * Parent ▸ submenu (context menus). Layers are numbered like After Effects' parent picker
 * (1 = top): files often repeat names ("Splash 2" × 8). The trigger shows the current parent;
 * layers keep their place on screen when re-parented.
 */
export function ParentMenu({ doc, layers }: { doc: Animation; layers: NodePath[] }) {
  const t = useT()
  const candidates = parentCandidates(doc, layers)
  const current = layers.map((p) => getAt<Layer>(doc, p)?.parent)
  const same = current.every((c) => c === current[0])
  const currentName =
    same && current[0] !== undefined
      ? candidates.find((c) => c.ind === current[0])?.name
      : undefined
  return (
    <MenuSub
      kind="context"
      icon={Link2}
      label={
        <span className="flex min-w-0 items-center gap-4">
          <span className="shrink-0">{t.layers.menu.setParent}</span>
          {currentName && (
            <span className="ml-auto min-w-0 truncate text-xs text-fg-subtle group-data-[highlighted]:text-accent-fg/75">
              {currentName}
            </span>
          )}
        </span>
      }
      disabled={!candidates.length && current.every((c) => c === undefined)}
    >
      <MenuCheckboxItem
        kind="context"
        checked={same && current[0] === undefined}
        onSelect={() => setParentOf(layers, null)}
      >
        {t.layers.menu.noParent}
      </MenuCheckboxItem>
      {candidates.length > 0 && <MenuSeparator kind="context" />}
      {/* Long names truncate instead of stretching the submenu. */}
      <div className="max-w-80">
        {candidates.map((c) => (
          <MenuCheckboxItem
            key={c.ind}
            kind="context"
            checked={same && current[0] === c.ind}
            disabled={!c.valid}
            onSelect={() => setParentOf(layers, c.ind)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="w-5 shrink-0 text-right text-xs text-fg-subtle tabular-nums group-data-[highlighted]:text-accent-fg/75"
              >
                {c.index + 1}
              </span>
              <LayerKindIcon kind={c.kind} className="group-data-[highlighted]:text-accent-fg" />
              <span className="min-w-0 truncate">{c.name}</span>
            </span>
          </MenuCheckboxItem>
        ))}
      </div>
    </MenuSub>
  )
}

/**
 * Hide/Show, Lock/Unlock and Solo for the selection, labelled by its state (shared by the layer
 * tree, canvas and timeline menus so the three read the same).
 */
export function NodeStateItems({ kind }: { kind: MenuKind }) {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const selection = useDocument((s) => s.selection)
  const locked = useLayersView((s) => s.locked)
  const solo = useLayersView((s) => s.solo)
  if (!doc) return null
  const { layers, all } = selectedNodes(selection)
  if (!all.length) return null
  const anyVisible = all.some((p) => !getAt<{ hd?: boolean }>(doc, p)?.hd)
  const anyUnlocked = all.some((p) => !hasKey(doc, p, locked))
  const allSoloed = layers.length > 0 && layers.every((p) => hasKey(doc, p, solo))
  return (
    <>
      <CommandItem
        id="layer.toggleVisibility"
        kind={kind}
        icon={anyVisible ? EyeOff : Eye}
        label={anyVisible ? t.layers.row.hide : t.layers.row.show}
      />
      <CommandItem
        id="layer.toggleLock"
        kind={kind}
        icon={anyUnlocked ? Lock : LockOpen}
        label={anyUnlocked ? t.layers.row.lock : t.layers.row.unlock}
      />
      {layers.length > 0 && (
        <CommandItem
          id="layer.toggleSolo"
          kind={kind}
          icon={CircleDot}
          label={allSoloed ? t.layers.menu.unsolo : t.layers.menu.solo}
        />
      )}
    </>
  )
}

/**
 * "Precompose…" and "Release precomp layers" for the selected layers. Release is listed when
 * precomp layers are selected, disabled with the reason when none of them can be released.
 */
export function PrecomposeItems({ kind }: { kind: MenuKind }) {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const selection = useDocument((s) => s.selection)
  const release = releaseState(doc, selection)
  return (
    <>
      <CommandItem id="layer.precompose" kind={kind} />
      {release.targets.length > 0 && (
        <MenuItem
          kind={kind}
          icon={LayersArrowUp}
          disabled={release.blocker !== null}
          onSelect={() => runCommand('layer.unprecompose')}
        >
          {/* The action stays readable; a long reason (Russian) gives way first. */}
          <span className="flex min-w-0 items-center gap-4">
            <span className="shrink-0">{t.layers.commands.unprecompose}</span>
            {release.blocker && (
              <span className="ml-auto min-w-0 truncate text-xs">
                {releaseBlockerLabel(release.blocker, t)}
              </span>
            )}
          </span>
        </MenuItem>
      )}
    </>
  )
}

/** Arrange ▸ (bring to front … send to back) for the selection. */
export function ArrangeMenu({ kind }: { kind: MenuKind }) {
  const t = useT()
  return (
    <MenuSub kind={kind} icon={ArrowUpDown} label={t.layers.menu.arrange}>
      <CommandItem id="layer.bringToFront" kind={kind} />
      <CommandItem id="layer.bringForward" kind={kind} />
      <CommandItem id="layer.sendBackward" kind={kind} />
      <CommandItem id="layer.sendToBack" kind={kind} />
    </MenuSub>
  )
}

/** Context menu of the layer tree for the current selection (or the empty area). */
export function LayerContextMenuItems() {
  const t = useT()
  const commands = useCommands()
  const doc = useDocument((s) => s.doc)
  const selection = useDocument((s) => s.selection)
  if (!doc) return null
  const { layers, shapes, primary, all } = selectedNodes(selection)

  if (!primary) {
    return (
      <>
        <MenuSub kind="context" icon={Plus} label={t.layers.menu.newLayer}>
          <NewLayerItems kind="context" />
        </MenuSub>
        <MenuSeparator kind="context" />
        <CommandItem id="edit.paste" kind="context" icon={ClipboardPaste} shortcut="mod+v" />
        <CommandItem id="edit.selectAll" kind="context" />
        <MenuSeparator kind="context" />
        <MenuItem kind="context" onSelect={collapseAll}>
          {t.layers.commands.collapseAll}
        </MenuItem>
      </>
    )
  }

  const node = getAt<Layer | ShapeItem>(doc, primary)
  const onlyShapes = shapes.length > 0 && layers.length === 0
  const blocker = onlyShapes ? ungroupState() : 'not-group'
  const canAddShapes =
    (isShapePath(primary) && node?.ty === 'gr') || (isLayerPath(primary) && node?.ty === 4)
  const container = canAddShapes ? shapeContainer(doc, selection) : null

  return (
    <>
      {all.length === 1 && (
        <CommandItem id="layer.rename" kind="context" icon={PenLine} label={t.layers.menu.rename} />
      )}
      <CommandItem id="edit.duplicate" kind="context" icon={CopyPlus} />
      <MenuSeparator kind="context" />
      <CommandItem id="edit.copy" kind="context" icon={Copy} />
      <CommandItem id="edit.cut" kind="context" icon={Scissors} />
      <CommandItem id="edit.paste" kind="context" icon={ClipboardPaste} shortcut="mod+v" />
      <MenuSeparator kind="context" />
      <NodeStateItems kind="context" />
      {layers.length > 0 && !shapes.length && (
        <>
          <MenuSeparator kind="context" />
          <PrecomposeItems kind="context" />
        </>
      )}
      {onlyShapes && (
        <>
          <MenuSeparator kind="context" />
          <CommandItem id="layer.group" kind="context" icon={Group} />
          {blocker !== 'not-group' && (
            <MenuItem
              kind="context"
              icon={Ungroup}
              disabled={blocker !== null}
              shortcut={blocker === null ? 'mod+shift+g' : undefined}
              onSelect={() => runCommand('layer.ungroup')}
            >
              <span className="flex min-w-0 items-center gap-4">
                <span className="truncate">{t.layers.commands.ungroup}</span>
                {blocker && (
                  <span className="ml-auto shrink-0 text-xs">
                    {blocker === 'transform'
                      ? t.layers.menu.ungroupBlocked.transform
                      : t.layers.menu.ungroupBlocked.styles}
                  </span>
                )}
              </span>
            </MenuItem>
          )}
        </>
      )}
      <MenuSeparator kind="context" />
      <ArrangeMenu kind="context" />
      {layers.length > 0 && !shapes.length && <ParentMenu doc={doc} layers={layers} />}
      {container && (
        <MenuSub kind="context" icon={Plus} label={t.layers.menu.add}>
          <ShapeItemItems kind="context" container={container} />
        </MenuSub>
      )}
      <MenuSeparator kind="context" />
      <CommandItem id="layer.selectParent" kind="context" icon={ArrowUpFromLine} />
      <CommandItem id="layer.selectChildren" kind="context" icon={ArrowDownToLine} />
      <MenuSeparator kind="context" />
      <MenuItem
        kind="context"
        icon={Focus}
        // ⇧2 (zoom to selection) frames the same node from the canvas.
        shortcut={commands.has('view.zoomSelection') ? 'shift+2' : undefined}
        onSelect={() => zoomToNode(primary)}
      >
        {t.layers.menu.zoomTo}
      </MenuItem>
      <MenuItem kind="context" icon={Braces} onSelect={() => showInJson(primary)}>
        {t.layers.menu.showInJson}
      </MenuItem>
      <MenuSeparator kind="context" />
      <CommandItem id="edit.delete" kind="context" icon={Trash2} />
    </>
  )
}
