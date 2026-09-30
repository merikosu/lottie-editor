/**
 * Registers the customize feature: the Replace dialog, the editor commands built on the remix
 * engine (replace the selected element, import an SVG or another animation as a layer) and the
 * drop handler that sends images dropped on the Customize page to the Replace dialog.
 */
import { Import, Replace, Spline } from 'lucide-react'
import { currentRoute } from '@/app/router'
import { registerDialog } from '@/commands/dialogs'
import { registerFileHandler } from '@/commands/files'
import { registerCommands, type Command } from '@/commands/registry'
import { getDoc } from '@/store/document'
import { importLottieLayer, importSvgLayer, replaceableSelection, replaceSelected } from './actions'
import { topSuggestion } from './panel/useElements'
import { REPLACE_DIALOG, openReplace } from './replace/open'
import { ReplaceDialog } from './replace/ReplaceDialog'
import { isReplaceFile } from './replace/source'

const hasDoc = () => getDoc() !== null

function commands(): Command[] {
  return [
    {
      id: 'layer.replaceContent',
      title: (t) => t.customize.commands.replaceContent,
      category: 'layer',
      icon: Replace,
      keywords: ['replace', 'swap', 'logo', 'svg', 'image', 'заменить', 'логотип', 'картинка'],
      enabled: () => replaceableSelection() !== null,
      run: () => void replaceSelected(),
    },
    {
      id: 'layer.new.svg',
      title: (t) => t.customize.commands.newSvg,
      category: 'layer',
      icon: Spline,
      keywords: ['svg', 'vector', 'import', 'logo', 'icon', 'вектор', 'импорт', 'логотип'],
      enabled: hasDoc,
      run: () => importSvgLayer().then(() => undefined),
    },
    {
      id: 'file.importAsLayer',
      title: (t) => t.customize.commands.importAsLayer,
      category: 'file',
      icon: Import,
      keywords: ['import', 'lottie', 'precomp', 'merge', 'combine', 'импорт', 'объединить'],
      enabled: hasDoc,
      run: () => importLottieLayer().then(() => undefined),
    },
  ]
}

/**
 * On the Customize page an SVG or image dropped (or pasted) replaces the selected element, or
 * the top suggestion when nothing is selected. Elsewhere, and when there is nothing to replace,
 * the files go on to the next handler (the assets feature adds images as layers).
 */
function handleReplaceFiles(files: File[]): boolean {
  if (currentRoute() !== 'customize' || files.length !== 1 || !isReplaceFile(files[0])) return false
  const doc = getDoc()
  if (!doc) return false
  const target = replaceableSelection() ?? topSuggestion(doc)
  if (!target) return false
  openReplace(target, files[0])
  return true
}

/** Registers the customize feature's commands and dialogs; returns a cleanup function. */
export function register(): () => void {
  const disposers = [
    registerCommands(commands()),
    registerDialog(REPLACE_DIALOG, ReplaceDialog),
    // Before io's image routing (7) and the assets feature (5); after animation files (10).
    registerFileHandler(handleReplaceFiles, 8),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
