/**
 * Registers this feature's commands and dialogs. Called once by the app on startup;
 * returns a cleanup function.
 */
import { Eraser, ImageDown, Replace, Shapes } from 'lucide-react'
import { layout } from '@/app/layout'
import { registerDialog } from '@/commands/dialogs'
import { registerFileHandler } from '@/commands/files'
import { registerCommands, type Command } from '@/commands/registry'
import { missingImages, unusedAssets } from '@/lottie/assets'
import { getAt, isLayerPath } from '@/lottie/path'
import { getDoc, primaryNode, useDocument } from '@/store/document'
import { setPrefs } from '@/store/prefs'
import {
  chooseMissingImages,
  chooseReplacement,
  handleImageFiles,
  removeUnused,
  REPLACE_DIALOG,
  targetImageAssetId,
} from './actions'
import { ReplaceImageDialog } from './ReplaceImageDialog'
import { resetAssetsUi, selectAsset } from './store'

/** Keeps the panel's highlighted asset in step with the selected image / precomp layer. */
function followLayerSelection(): () => void {
  return useDocument.subscribe(
    (s) => s.selection,
    (sel) => {
      const doc = getDoc()
      const path = primaryNode(sel)
      if (!doc || !path || !isLayerPath(path)) return
      const layer = getAt<{ ty?: number; refId?: unknown }>(doc, path)
      if (!layer || typeof layer.refId !== 'string') return
      if (layer.ty === 2) selectAsset({ kind: 'image', id: layer.refId })
      else if (layer.ty === 0) selectAsset({ kind: 'comp', id: layer.refId })
    },
  )
}

const hasDoc = () => getDoc() !== null

export function register(): () => void {
  const commands: Command[] = [
    {
      id: 'assets.replaceImage',
      title: (t) => t.assets.commands.replaceImage,
      category: 'layer',
      icon: Replace,
      keywords: ['image', 'picture', 'swap'],
      enabled: () => targetImageAssetId() !== null,
      run: async () => {
        const id = targetImageAssetId()
        if (id) await chooseReplacement(id)
      },
    },
    {
      id: 'assets.embedMissing',
      title: (t) => t.assets.commands.embedMissing,
      category: 'file',
      icon: ImageDown,
      keywords: ['image', 'locate', 'missing'],
      enabled: () => {
        const doc = getDoc()
        return !!doc && missingImages(doc).length > 0
      },
      run: chooseMissingImages,
    },
    {
      id: 'assets.removeUnused',
      title: (t) => t.assets.commands.removeUnused,
      category: 'animation',
      icon: Eraser,
      keywords: ['clean', 'optimize', 'unused', 'assets'],
      enabled: () => {
        const doc = getDoc()
        return !!doc && unusedAssets(doc).length > 0
      },
      run: () => void removeUnused(),
    },
    {
      id: 'assets.show',
      title: (t) => t.assets.commands.show,
      category: 'view',
      icon: Shapes,
      keywords: ['images', 'fonts', 'precomp'],
      enabled: hasDoc,
      run: () => {
        setPrefs({ leftTab: 'assets' })
        if (layout().isLeftCollapsed()) layout().toggleLeft()
      },
    },
  ]

  const disposers = [
    registerCommands(commands),
    registerDialog(REPLACE_DIALOG, ReplaceImageDialog),
    // Before the io handler (priority 0): images go into the open document.
    registerFileHandler(handleImageFiles, 5),
    followLayerSelection(),
    useDocument.subscribe(
      (s) => s.meta?.id,
      () => resetAssetsUi(),
    ),
  ]
  return () => disposers.forEach((d) => d())
}
