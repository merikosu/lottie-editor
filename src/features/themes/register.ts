/**
 * Registers the themes feature: its commands (menus and the command palette pick them up by id),
 * the history tracking that keeps theme values in step with undo/redo, and the slot sync that
 * keeps theme colors consistent whoever edits them. No UI is imported here: the Themes section
 * lives in the lazily loaded editor workspace.
 */
import { EyeOff, FileArchive, Plus, SwatchBook } from 'lucide-react'
import { registerCommands, type Command } from '@/commands/registry'
import { listSlots } from '@/lottie/slots'
import { getDoc, useDocument } from '@/store/document'
import { currentPackage, exportWithThemes, revealThemesSection, selectTheme } from './actions'
import { installPackageHistory } from './history'
import { installSlotSync } from './sync'
import { canHoldThemes, listThemes } from './model'
import { getSelectedThemeId, setThemesUi } from './store'

const KEYWORDS = [
  'theme',
  'themes',
  'slot',
  'slots',
  'dark mode',
  'light mode',
  'palette',
  'dotlottie',
  'тема',
  'темы',
  'слот',
  'слоты',
  'тёмная тема',
  'светлая тема',
]

const hasDoc = () => getDoc() !== null
const hasSlots = () => {
  const doc = getDoc()
  return !!doc && listSlots(doc).length > 0
}

/** Registers the feature once on startup; returns the cleanup function. */
export function register(): () => void {
  const commands: Command[] = [
    {
      id: 'themes.show',
      title: (t) => t.themes.commands.show,
      category: 'animation',
      icon: SwatchBook,
      keywords: KEYWORDS,
      enabled: hasDoc,
      run: revealThemesSection,
    },
    {
      id: 'themes.newTheme',
      title: (t) => t.themes.commands.newTheme,
      category: 'animation',
      icon: Plus,
      keywords: KEYWORDS,
      enabled: () => hasDoc() && canHoldThemes(useDocument.getState().meta?.dotLottie),
      run: () => {
        // A theme needs theme colors to hold values: without any, the section explains that.
        if (hasSlots()) setThemesUi({ renamingTheme: 'new' })
        revealThemesSection()
      },
    },
    {
      id: 'themes.stopPreview',
      title: (t) => t.themes.commands.stopPreview,
      category: 'animation',
      icon: EyeOff,
      keywords: KEYWORDS,
      enabled: () => hasDoc() && getSelectedThemeId() !== null,
      run: () => selectTheme(null),
    },
    {
      id: 'themes.export',
      title: (t) => t.themes.commands.export,
      category: 'file',
      icon: FileArchive,
      keywords: [...KEYWORDS, 'export', 'экспорт'],
      enabled: () => hasDoc() && listThemes(currentPackage()).length > 0,
      run: exportWithThemes,
    },
  ]
  const disposers = [registerCommands(commands), installPackageHistory(), installSlotSync()]
  return () => disposers.forEach((dispose) => dispose())
}
