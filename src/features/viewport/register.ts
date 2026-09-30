/**
 * Viewport commands (zoom, preview background, artboard outline, compare) and the
 * `zoom-to-node` event.
 */
import {
  Maximize,
  ScanSearch,
  SquareDashed,
  SquareFunction,
  SquareSplitHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { registerCommands, type Command } from '@/commands/registry'
import { on } from '@/lib/events'
import type { NodePath } from '@/lottie/path'
import { getDoc, useDocument } from '@/store/document'
import { setPrefs, usePrefs, type CanvasBackground } from '@/store/prefs'
import { BACKGROUNDS, nextBackground } from './backgrounds'
import {
  isViewportMounted,
  requestZoomToNodes,
  toggleCompare,
  useViewport,
  zoomStep,
  zoomTo,
  zoomToFit,
  zoomToNodes,
} from './store'

const hasDoc = () => getDoc() !== null
const canZoom = () => hasDoc() && isViewportMounted()
const selectedNodes = (): readonly NodePath[] => useDocument.getState().selection.nodes

/**
 * Registers this feature's commands and dialogs. Called once by the app on startup;
 * returns a cleanup function.
 */
export function register(): () => void {
  const backgroundCommands = BACKGROUNDS.map<Command>((bg: CanvasBackground) => ({
    id: `view.bg.${bg}`,
    title: (t) => t.viewport.backgroundCommands[bg],
    category: 'view',
    keywords: ['background', 'canvas', 'фон'],
    checked: () => usePrefs.getState().canvasBackground === bg,
    run: () => setPrefs({ canvasBackground: bg }),
  }))

  const commands: Command[] = [
    {
      id: 'view.zoomIn',
      title: (t) => t.viewport.zoomIn,
      category: 'view',
      icon: ZoomIn,
      shortcut: ['=', 'shift+='],
      repeat: true,
      enabled: canZoom,
      run: () => zoomStep(1),
    },
    {
      id: 'view.zoomOut',
      title: (t) => t.viewport.zoomOut,
      category: 'view',
      icon: ZoomOut,
      shortcut: '-',
      repeat: true,
      enabled: canZoom,
      run: () => zoomStep(-1),
    },
    {
      id: 'view.zoomFit',
      title: (t) => t.viewport.zoomFit,
      category: 'view',
      icon: Maximize,
      shortcut: 'shift+1',
      keywords: ['fit', 'вписать'],
      enabled: canZoom,
      run: zoomToFit,
    },
    {
      id: 'view.zoom100',
      title: (t) => t.viewport.zoom100,
      category: 'view',
      shortcut: 'shift+0',
      keywords: ['actual size', 'реальный размер'],
      enabled: canZoom,
      run: () => zoomTo(1),
    },
    {
      id: 'view.zoomSelection',
      title: (t) => t.viewport.zoomSelection,
      category: 'view',
      icon: ScanSearch,
      shortcut: 'shift+2',
      enabled: () => canZoom() && selectedNodes().length > 0,
      run: () => void zoomToNodes(selectedNodes()),
    },
    {
      id: 'view.toggleBounds',
      title: (t) => t.viewport.showBounds,
      category: 'view',
      icon: SquareDashed,
      keywords: ['artboard', 'bounds', 'outline', 'рамка'],
      enabled: hasDoc,
      checked: () => usePrefs.getState().showBounds,
      run: () => setPrefs((p) => ({ showBounds: !p.showBounds })),
    },
    {
      id: 'view.compare',
      title: (t) => t.viewport.compare,
      category: 'view',
      icon: SquareSplitHorizontal,
      keywords: ['diff', 'before', 'after', 'original', 'сравнить', 'до', 'после'],
      enabled: () => hasDoc() && useDocument.getState().original !== null,
      checked: () => useViewport.getState().compare,
      run: () => {
        toggleCompare()
        // Compare lives in the canvas: bring it back when the JSON view is shown alone.
        if (useViewport.getState().compare && usePrefs.getState().centerView === 'code') {
          setPrefs({ centerView: 'canvas' })
        }
      },
    },
    {
      id: 'view.runExpressions',
      title: (t) => t.viewport.expressionsEnable,
      category: 'view',
      icon: SquareFunction,
      keywords: ['expressions', 'javascript', 'eval', 'выражения'],
      checked: () => usePrefs.getState().runExpressions,
      run: () => setPrefs((p) => ({ runExpressions: !p.runExpressions })),
    },
    ...backgroundCommands,
    {
      id: 'view.bg.cycle',
      title: (t) => t.viewport.backgroundCycle,
      category: 'view',
      shortcut: 'shift+b',
      keywords: ['background', 'фон'],
      enabled: hasDoc,
      run: () => setPrefs((p) => ({ canvasBackground: nextBackground(p.canvasBackground) })),
    },
  ]

  const disposers = [
    registerCommands(commands),
    on('zoom-to-node', ({ path }) => {
      if (!hasDoc()) return
      if (isViewportMounted() && zoomToNodes([path])) return
      // The canvas is not on screen (JSON view): show it and frame the node once it renders.
      if (usePrefs.getState().centerView === 'code') setPrefs({ centerView: 'canvas' })
      requestZoomToNodes([path])
    }),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
