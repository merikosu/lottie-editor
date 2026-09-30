/**
 * Registers the workspace feature: help commands (shortcuts sheet, settings, about), the
 * History panel command and the history tracker. Called once by the app on startup; returns
 * a cleanup function.
 */
import { History, Info, Keyboard, Settings } from 'lucide-react'
import { layout } from '@/app/layout'
import { registerDialog } from '@/commands/dialogs'
import { registerCommands, type Command } from '@/commands/registry'
import { getDoc } from '@/store/document'
import { setPrefs } from '@/store/prefs'
import { openDialog } from '@/store/ui'
import { AboutDialog } from './about/AboutDialog'
import { installHistoryTracker } from './history/tracker'
import { DIALOG } from './ids'
import { runOnRoute } from './navigation'
import { SettingsDialog } from './settings/SettingsDialog'
import { ShortcutsDialog } from './shortcuts/ShortcutsDialog'

/**
 * Shows the History tab of the editor's left sidebar, opening the editor (from another page)
 * and the sidebar (when collapsed) as needed.
 */
export function showHistory(): void {
  setPrefs({ leftTab: 'history' })
  // The panel layout exists only while the editor is on screen.
  runOnRoute('edit', () => {
    if (layout().isLeftCollapsed()) layout().toggleLeft()
  })
}

function commands(): Command[] {
  return [
    {
      id: 'help.shortcuts',
      title: (t) => t.workspace.commands.shortcuts,
      category: 'help',
      icon: Keyboard,
      shortcut: ['?', 'mod+/'],
      run: () => openDialog(DIALOG.shortcuts),
    },
    {
      id: 'help.settings',
      title: (t) => t.workspace.commands.settings,
      category: 'help',
      icon: Settings,
      shortcut: 'mod+,',
      allowInInput: true,
      run: () => openDialog(DIALOG.settings),
    },
    {
      id: 'help.about',
      title: (t) => t.workspace.commands.about,
      category: 'help',
      icon: Info,
      run: () => openDialog(DIALOG.about),
    },
    {
      id: 'edit.history',
      title: (t) => t.workspace.commands.history,
      category: 'edit',
      icon: History,
      enabled: () => getDoc() !== null,
      run: showHistory,
    },
  ]
}

export function register(): () => void {
  const disposers = [
    registerCommands(commands()),
    registerDialog(DIALOG.shortcuts, ShortcutsDialog),
    registerDialog(DIALOG.settings, SettingsDialog),
    registerDialog(DIALOG.about, AboutDialog),
    installHistoryTracker(),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
