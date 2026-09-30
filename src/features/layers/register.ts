/**
 * Registers the layers feature: commands (new layers, edit operations on layers and shape
 * items, arrange, group, visibility/lock/solo, parent navigation), the paste handler for
 * copied layers, event listeners and the view-state sync.
 */
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BringToFront,
  ChevronsDownUp,
  Circle,
  CircleDot,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crosshair,
  Eye,
  Group,
  Hexagon,
  Image,
  LayersArrowDown,
  LayersArrowUp,
  Lock,
  MoveDown,
  MoveUp,
  ListTree,
  PenLine,
  RectangleHorizontal,
  Scissors,
  SendToBack,
  Square,
  Star,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react'
import { lazy } from 'react'
import { registerDialog } from '@/commands/dialogs'
import { registerPasteHandler } from '@/commands/paste'
import { registerCommands, type Command } from '@/commands/registry'
import { isMac } from '@/lib/platform'
import { on } from '@/lib/events'
import { getDoc, useDocument } from '@/store/document'
import {
  addImageLayer,
  addLayer,
  arrangeSelection,
  beginRename,
  canArrange,
  canGroupSelection,
  childrenOf,
  duplicateNodes,
  deleteNodes,
  focusLayerTree,
  groupSelection,
  parentOf,
  revealInTree,
  selectAllLayers,
  selectAllSiblings,
  selectChildren,
  selectParent,
  selectedNodes,
  toggleNodesHidden,
  toggleNodesLocked,
  toggleNodesSolo,
  ungroupSelection,
  ungroupState,
  type NewLayerKind,
} from './actions'
import { copySelection, cutSelection, layersPasteHandler, pasteFromMenu } from './clipboard'
import {
  canPrecompose,
  canRelease,
  openPrecompose,
  PRECOMPOSE_DIALOG,
  releaseSelection,
} from './precompose'
import { collapseAll, installLayersSync, isNodeSoloed } from './state'
import type { Dict } from '@/i18n'

// The dialog is a separate chunk: this module loads with the app shell.
const PrecomposeDialog = lazy(() =>
  import('./PrecomposeDialog').then((m) => ({ default: m.PrecomposeDialog })),
)

const hasDoc = () => getDoc() !== null
const hasNodes = () => selectedNodes().all.length > 0
/** Node commands share keys with keyframe commands (Delete, ⌘C, ⌘X): only one side is enabled. */
const nodesWithoutKeyframes = () =>
  hasNodes() && useDocument.getState().selection.keyframes.length === 0

function primaryParent() {
  const doc = getDoc()
  const primary = selectedNodes().primary
  return doc && primary ? parentOf(doc, primary) : null
}

function primaryChildren() {
  const doc = getDoc()
  const primary = selectedNodes().primary
  return doc && primary ? childrenOf(doc, primary) : []
}

const NEW_LAYERS: Array<{ kind: NewLayerKind; icon: Command['icon']; title: (t: Dict) => string }> =
  [
    { kind: 'rect', icon: RectangleHorizontal, title: (t) => t.layers.commands.newRect },
    { kind: 'ellipse', icon: Circle, title: (t) => t.layers.commands.newEllipse },
    { kind: 'star', icon: Star, title: (t) => t.layers.commands.newStar },
    { kind: 'polygon', icon: Hexagon, title: (t) => t.layers.commands.newPolygon },
    { kind: 'text', icon: Type, title: (t) => t.layers.commands.newText },
    { kind: 'solid', icon: Square, title: (t) => t.layers.commands.newSolid },
    { kind: 'null', icon: Crosshair, title: (t) => t.layers.commands.newNull },
  ]

function commands(): Command[] {
  return [
    ...NEW_LAYERS.map<Command>(({ kind, icon, title }) => ({
      id: `layer.new.${kind}`,
      title,
      category: 'layer',
      icon,
      keywords: ['add', 'create', 'layer', 'добавить', 'создать', 'слой'],
      enabled: hasDoc,
      run: () => void addLayer(kind),
    })),
    {
      id: 'layer.new.image',
      title: (t) => t.layers.commands.newImage,
      category: 'layer',
      icon: Image,
      keywords: ['add', 'import', 'picture', 'png', 'добавить', 'картинка'],
      enabled: hasDoc,
      run: () => addImageLayer().then(() => undefined),
    },

    /* --------------------------------- Edit --------------------------------- */
    {
      id: 'edit.duplicate',
      title: (t) => t.layers.commands.duplicate,
      category: 'edit',
      icon: CopyPlus,
      shortcut: 'mod+d',
      enabled: hasNodes,
      run: () => void duplicateNodes(),
    },
    {
      id: 'edit.delete',
      title: (t) => t.layers.commands.delete,
      category: 'edit',
      icon: Trash2,
      shortcut: isMac ? ['backspace', 'delete'] : ['delete', 'backspace'],
      enabled: nodesWithoutKeyframes,
      run: () => void deleteNodes(),
    },
    {
      id: 'edit.copy',
      title: (t) => t.layers.commands.copy,
      category: 'edit',
      icon: Copy,
      shortcut: 'mod+c',
      enabled: nodesWithoutKeyframes,
      run: () => copySelection().then(() => undefined),
    },
    {
      id: 'edit.cut',
      title: (t) => t.layers.commands.cut,
      category: 'edit',
      icon: Scissors,
      shortcut: 'mod+x',
      enabled: nodesWithoutKeyframes,
      run: () => cutSelection().then(() => undefined),
    },
    {
      // ⌘V arrives as a native paste event (registry handler below); this is for menus.
      id: 'edit.paste',
      title: (t) => t.layers.commands.paste,
      category: 'edit',
      icon: ClipboardPaste,
      // Shown only: ⌘V stays a native paste event handled by the paste registry.
      displayShortcut: 'mod+v',
      enabled: hasDoc,
      run: pasteFromMenu,
    },
    {
      id: 'edit.selectAll',
      title: (t) => t.layers.commands.selectAll,
      category: 'edit',
      shortcut: 'mod+a',
      enabled: () =>
        !!getDoc()?.layers?.length && useDocument.getState().selection.keyframes.length === 0,
      // In the layer tree ⌘A selects within the current scope (Figma); elsewhere all root layers.
      run: () =>
        document.activeElement?.closest('[role="tree"][data-testid="layer-tree"]')
          ? selectAllSiblings()
          : selectAllLayers(),
    },

    /* --------------------------------- Layer -------------------------------- */
    {
      id: 'layer.rename',
      title: (t) => t.layers.commands.rename,
      category: 'layer',
      icon: PenLine,
      shortcut: 'f2',
      enabled: () => selectedNodes().primary !== null,
      run: () => {
        const primary = selectedNodes().primary
        if (primary) beginRename(primary)
      },
    },
    {
      id: 'layer.toggleVisibility',
      title: (t) => t.layers.commands.toggleVisibility,
      category: 'layer',
      icon: Eye,
      shortcut: 'mod+shift+h',
      keywords: ['hide', 'show', 'visible', 'скрыть', 'показать'],
      enabled: hasNodes,
      run: () => void toggleNodesHidden(),
    },
    {
      id: 'layer.toggleLock',
      title: (t) => t.layers.commands.toggleLock,
      category: 'layer',
      icon: Lock,
      shortcut: 'mod+shift+l',
      enabled: hasNodes,
      run: () => toggleNodesLocked(),
    },
    {
      id: 'layer.toggleSolo',
      title: (t) => t.layers.commands.toggleSolo,
      category: 'layer',
      icon: CircleDot,
      enabled: () => selectedNodes().layers.length > 0,
      checked: () => {
        const { layers } = selectedNodes()
        return layers.length > 0 && layers.every((p) => isNodeSoloed(p))
      },
      run: () => toggleNodesSolo(),
    },
    {
      id: 'layer.bringToFront',
      title: (t) => t.layers.commands.bringToFront,
      category: 'layer',
      icon: BringToFront,
      shortcut: 'mod+shift+]',
      enabled: canArrange,
      run: () => void arrangeSelection('front'),
    },
    {
      id: 'layer.bringForward',
      title: (t) => t.layers.commands.bringForward,
      category: 'layer',
      icon: MoveUp,
      shortcut: 'mod+]',
      enabled: canArrange,
      run: () => void arrangeSelection('forward'),
    },
    {
      id: 'layer.sendBackward',
      title: (t) => t.layers.commands.sendBackward,
      category: 'layer',
      icon: MoveDown,
      shortcut: 'mod+[',
      enabled: canArrange,
      run: () => void arrangeSelection('backward'),
    },
    {
      id: 'layer.sendToBack',
      title: (t) => t.layers.commands.sendToBack,
      category: 'layer',
      icon: SendToBack,
      shortcut: 'mod+shift+[',
      enabled: canArrange,
      run: () => void arrangeSelection('back'),
    },
    {
      id: 'layer.group',
      title: (t) => t.layers.commands.group,
      category: 'layer',
      icon: Group,
      shortcut: 'mod+g',
      enabled: canGroupSelection,
      run: () => void groupSelection(),
    },
    {
      id: 'layer.ungroup',
      title: (t) => t.layers.commands.ungroup,
      category: 'layer',
      icon: Ungroup,
      shortcut: 'mod+shift+g',
      enabled: () => ungroupState() === null,
      run: () => void ungroupSelection(),
    },
    {
      // After Effects' ⇧⌘C is Copy frame as PNG here and ⌥⌘C shows the canvas: no shortcut.
      id: 'layer.precompose',
      title: (t) => t.layers.commands.precompose,
      category: 'layer',
      icon: LayersArrowDown,
      keywords: [
        'precomp',
        'pre-compose',
        'nest',
        'nested composition',
        'composition',
        'group layers',
        'прекомпоз',
        'прекомп',
        'вложить',
        'композиция',
        'сгруппировать слои',
      ],
      enabled: canPrecompose,
      run: openPrecompose,
    },
    {
      id: 'layer.unprecompose',
      title: (t) => t.layers.commands.unprecompose,
      category: 'layer',
      icon: LayersArrowUp,
      keywords: [
        'unprecompose',
        'un-precompose',
        'release',
        'explode',
        'flatten',
        'extract',
        'precomp',
        'разобрать',
        'распаковать',
        'развернуть',
        'прекомпозиция',
      ],
      enabled: canRelease,
      run: () => void releaseSelection(),
    },
    {
      id: 'layer.selectParent',
      title: (t) => t.layers.commands.selectParent,
      category: 'layer',
      icon: ArrowUpFromLine,
      enabled: () => primaryParent() !== null,
      run: selectParent,
    },
    {
      id: 'layer.selectChildren',
      title: (t) => t.layers.commands.selectChildren,
      category: 'layer',
      icon: ArrowDownToLine,
      enabled: () => primaryChildren().length > 0,
      run: selectChildren,
    },
    {
      id: 'layers.focus',
      title: (t) => t.layers.commands.focusTree,
      category: 'view',
      icon: ListTree,
      keywords: ['layers', 'tree', 'keyboard', 'focus', 'слои', 'клавиатура'],
      enabled: hasDoc,
      run: focusLayerTree,
    },
    {
      id: 'layers.collapseAll',
      title: (t) => t.layers.commands.collapseAll,
      category: 'view',
      icon: ChevronsDownUp,
      enabled: hasDoc,
      run: collapseAll,
    },
  ]
}

/**
 * Registers this feature's commands and dialogs. Called once by the app on startup;
 * returns a cleanup function.
 */
export function register(): () => void {
  const disposers = [
    installLayersSync(),
    registerCommands(commands()),
    registerPasteHandler(layersPasteHandler, 10),
    registerDialog(PRECOMPOSE_DIALOG, PrecomposeDialog),
    on('rename-node', ({ path }) => beginRename(path)),
    on('reveal-node', ({ path }) => revealInTree(path)),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
