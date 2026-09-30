/**
 * Registers this feature's commands and dialogs. Called once by the app on startup;
 * returns a cleanup function.
 */
import { Braces, Check, FileJson, LocateFixed, RotateCcw, Search } from 'lucide-react'
import { registerCommands, type Command } from '@/commands/registry'
import { on, emit } from '@/lib/events'
import { isEditableTarget } from '@/lib/platform'
import type { NodePath } from '@/lottie/path'
import { getDoc, primaryNode, useDocument } from '@/store/document'
import { setPrefs, usePrefs } from '@/store/prefs'
import {
  canFormat,
  getCodeController,
  requestReveal,
  toggleFollowSelection,
  useCodePrefs,
  useCodeStatus,
} from './store'

/**
 * Shortcuts shared with text fields (⌘↩, ⇧⌥F) act only when focus is in the JSON editor or
 * not in any text field, so they never fire from the inspector's inputs.
 */
function inEditorContext(): boolean {
  const active = document.activeElement
  return !isEditableTarget(active) || getCodeController()?.hasFocus() === true
}

/** What "Show in JSON" reveals: a selected keyframe, else the focused property, else the node. */
function revealTarget(): NodePath | null {
  const sel = useDocument.getState().selection
  const kf = sel.keyframes[sel.keyframes.length - 1]
  if (kf) return [...kf.path, 'k', kf.index]
  if (sel.property) return sel.property
  return primaryNode(sel)
}

const ready = () => useCodeStatus.getState().ready

/** An unapplied JSON draft is not part of the document (nor its autosave): ask before leaving. */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!useCodeStatus.getState().dirty) return
  e.preventDefault()
  e.returnValue = ''
}

export function register(): () => void {
  const commands: Command[] = [
    {
      id: 'code.apply',
      title: (t) => t.code.commands.apply,
      category: 'edit',
      icon: Check,
      shortcut: 'mod+enter',
      allowInInput: true,
      // Keyboard Apply re-validates on the spot, so a just-fixed error doesn't block it.
      enabled: () => ready() && useCodeStatus.getState().dirty && inEditorContext(),
      run: () => void getCodeController()?.apply(),
    },
    {
      id: 'code.format',
      title: (t) => t.code.commands.format,
      category: 'edit',
      icon: Braces,
      shortcut: 'shift+alt+f',
      allowInInput: true,
      keywords: ['prettify', 'indent', 'json'],
      enabled: () => canFormat() && inEditorContext(),
      run: () => void getCodeController()?.format(),
    },
    {
      id: 'code.revert',
      title: (t) => t.code.commands.revert,
      category: 'edit',
      icon: RotateCcw,
      enabled: () => ready() && useCodeStatus.getState().dirty,
      run: () => getCodeController()?.revert(),
    },
    {
      id: 'code.find',
      title: (t) => t.code.commands.find,
      category: 'edit',
      icon: Search,
      shortcut: 'mod+f',
      enabled: ready,
      run: () => getCodeController()?.openSearch(),
    },
    {
      id: 'code.followSelection',
      title: (t) => t.code.commands.followSelection,
      category: 'view',
      icon: LocateFixed,
      checked: () => useCodePrefs.getState().followSelection,
      run: toggleFollowSelection,
    },
    {
      id: 'edit.revealInCode',
      title: (t) => t.code.commands.revealInCode,
      category: 'edit',
      icon: FileJson,
      keywords: ['json', 'code', 'source'],
      enabled: () => getDoc() !== null && revealTarget() !== null,
      run: () => {
        const path = revealTarget()
        if (path) emit('reveal-code', { path })
      },
    },
  ]

  const offReveal = on('reveal-code', ({ path }) => {
    if (!getDoc()) return
    if (usePrefs.getState().centerView === 'canvas') setPrefs({ centerView: 'code' })
    requestReveal(path, true)
  })

  window.addEventListener('beforeunload', onBeforeUnload)

  const unregister = registerCommands(commands)
  return () => {
    unregister()
    offReveal()
    window.removeEventListener('beforeunload', onBeforeUnload)
  }
}
