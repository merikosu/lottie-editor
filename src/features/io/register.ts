/**
 * Registers the io feature: file commands, dialogs, the file/paste handlers, autosave, the
 * startup restore and the "leave page?" guard. Called once by the app on startup; returns a
 * cleanup function.
 */
import {
  Download,
  FilePlus2,
  FolderOpen,
  HardDriveDownload,
  Layers,
  Link2,
  RotateCcw,
  Shapes,
  Trash2,
  X,
} from 'lucide-react'
import { registerDialog } from '@/commands/dialogs'
import { registerFileHandler } from '@/commands/files'
import { registerPasteHandler } from '@/commands/paste'
import { registerCommands, type Command } from '@/commands/registry'
import { getT } from '@/i18n'
import { closeDocument, replaceDoc, useDocument } from '@/store/document'
import { setPrefs, usePrefs } from '@/store/prefs'
import { openDialog } from '@/store/ui'
import { flushAutosave, hasUnsavedWork, installAutosave, isEditedSinceOpen } from './autosave'
import { installCleanTracking, markCleanIfOriginal } from './clean'
import { DIALOG, type PickerProps } from './dialog-ids'
import { ConfirmDialog } from './dialogs/ConfirmDialog'
import { NewDocumentDialog } from './dialogs/NewDocumentDialog'
import { OpenUrlDialog } from './dialogs/OpenUrlDialog'
import { PickerDialog } from './dialogs/PickerDialog'
import { SamplesDialog } from './dialogs/SamplesDialog'
import { downloadCurrent } from './download'
import { askConfirm, confirmReplace } from './confirm'
import { explainUnhandledFiles, openFiles, pickFiles, routeImageFiles } from './open'
import { handlePaste } from './paste'
import { showOpenUrl } from './urlDownload'
import { clearAllRecents, openRecent, restoreLastSession } from './session'
import { containerOf } from './source'
import { clearSession } from './storage'
import { SAMPLES_SECTION_ID } from './SamplesSection'
import { useIo } from './store'

const hasDoc = () => useDocument.getState().doc !== null

async function closeCurrent(): Promise<void> {
  if (!(await confirmReplace())) return
  await flushAutosave()
  closeDocument()
  void clearSession().catch(() => undefined)
}

async function revertToOriginal(): Promise<void> {
  const t = getT()
  const choice = await askConfirm({
    title: t.io.confirm.revertTitle,
    description: t.io.confirm.revertDescription,
    confirmLabel: t.io.confirm.revert,
    tone: 'primary',
  })
  const original = useDocument.getState().original
  if (choice !== 'confirm' || !original) return
  replaceDoc(t.io.history.revert, original)
  markCleanIfOriginal()
}

/** Scrolls to the samples of the start page on screen, or shows them in a dialog. */
function showSamples(): void {
  const section = document.getElementById(SAMPLES_SECTION_ID)
  if (!section) {
    openDialog(DIALOG.samples)
    return
  }
  section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  section.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
}

function fileCommands(): Command[] {
  return [
    {
      id: 'file.new',
      title: (t) => t.io.commands.new,
      category: 'file',
      icon: FilePlus2,
      shortcut: 'mod+alt+n',
      keywords: ['create', 'blank', 'создать'],
      run: () => openDialog(DIALOG.newDocument),
    },
    {
      id: 'file.open',
      title: (t) => t.io.commands.open,
      category: 'file',
      icon: FolderOpen,
      shortcut: 'mod+o',
      allowInInput: true,
      keywords: ['import', 'json', 'lottie', 'tgs', 'открыть'],
      run: () => pickFiles(),
    },
    {
      id: 'file.openUrl',
      title: (t) => t.io.commands.openUrl,
      category: 'file',
      icon: Link2,
      keywords: ['url', 'link', 'fetch', 'ссылка'],
      run: () => showOpenUrl(),
    },
    {
      id: 'file.samples',
      title: (t) => t.io.commands.samples,
      category: 'file',
      icon: Shapes,
      keywords: ['examples', 'demo', 'примеры'],
      run: showSamples,
    },
    {
      id: 'file.download',
      title: (t) => t.io.commands.download,
      category: 'file',
      icon: Download,
      shortcut: 'mod+s',
      allowInInput: true,
      keywords: ['save', 'сохранить'],
      enabled: hasDoc,
      run: () => void downloadCurrent(),
    },
    {
      id: 'file.switchAnimation',
      title: (t) => t.io.commands.switchAnimation,
      category: 'file',
      icon: Layers,
      keywords: ['dotlottie', 'animation'],
      enabled: () =>
        (containerOf(useDocument.getState().meta?.dotLottie)?.animations.length ?? 0) > 1,
      run: () => openDialog(DIALOG.picker, { mode: 'switch' } satisfies PickerProps),
    },
    {
      id: 'file.revert',
      title: (t) => t.io.commands.revert,
      category: 'file',
      icon: RotateCcw,
      // Identity alone is not enough: undoing every edit builds an equal but new document.
      enabled: () => {
        const s = useDocument.getState()
        return s.doc !== null && s.original !== null && s.doc !== s.original && isEditedSinceOpen()
      },
      run: revertToOriginal,
    },
    {
      id: 'file.close',
      title: (t) => t.io.commands.close,
      category: 'file',
      icon: X,
      enabled: hasDoc,
      run: closeCurrent,
    },
    {
      id: 'file.toggleAutosave',
      title: (t) => t.io.commands.autosave,
      category: 'file',
      icon: HardDriveDownload,
      checked: () => usePrefs.getState().autosave,
      run: () => setPrefs((p) => ({ autosave: !p.autosave })),
    },
    {
      id: 'file.clearRecents',
      title: (t) => t.io.commands.clearRecents,
      category: 'file',
      icon: Trash2,
      enabled: () => (useIo.getState().recents?.length ?? 0) > 0,
      run: clearAllRecents,
    },
  ]
}

/** "Open recent: …" commands for the command palette, kept in sync with the recent list. */
const noop = () => {}

function installRecentCommands(): () => void {
  let unregister: () => void = noop
  let signature = ''
  const sync = () => {
    const currentId = useDocument.getState().meta?.id
    const entries = (useIo.getState().recents ?? []).filter((r) => r.id !== currentId)
    const next = entries.map((r) => `${r.id}:${r.fileName}`).join('|')
    if (next === signature) return
    signature = next
    unregister()
    unregister = registerCommands(
      entries.map<Command>((entry) => ({
        id: `file.openRecent.${entry.id}`,
        title: (t) => t.io.commands.openRecent(entry.fileName),
        category: 'file',
        icon: FolderOpen,
        keywords: ['recent', 'недавние'],
        run: () => openRecent(entry),
      })),
    )
  }
  const unsubscribeIo = useIo.subscribe(sync)
  const unsubscribeDoc = useDocument.subscribe((s) => s.meta?.id, sync)
  sync()
  return () => {
    unsubscribeIo()
    unsubscribeDoc()
    unregister()
  }
}

/** Prompts before leaving only when work could be lost (pending/failed autosave, or autosave off). */
function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (!hasUnsavedWork()) return
  void flushAutosave()
  e.preventDefault()
  // Older browsers need returnValue set to show the prompt.
  e.returnValue = ''
}

function installLeaveGuard(): () => void {
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => window.removeEventListener('beforeunload', onBeforeUnload)
}

let restoreStarted = false

const DEV_HANDLE = '__leIo'

/** Development handle for scripted screenshots and e2e checks: `window.__leIo`. */
function installDevHandle(): () => void {
  if (!import.meta.env.DEV) return noop
  const w = window as unknown as Record<string, unknown>
  w[DEV_HANDLE] = { useIo, flushAutosave, showOpenUrl, openFiles, pickFiles }
  return () => {
    delete w[DEV_HANDLE]
  }
}

/** Installs everything above; returns the cleanup. */
export function register(): () => void {
  const disposers = [
    registerCommands(fileCommands()),
    registerDialog(DIALOG.newDocument, NewDocumentDialog),
    registerDialog(DIALOG.openUrl, OpenUrlDialog),
    registerDialog(DIALOG.picker, PickerDialog),
    registerDialog(DIALOG.samples, SamplesDialog),
    registerDialog(DIALOG.confirm, ConfirmDialog),
    // Before the assets feature (5): animation files, with the images of an export folder.
    registerFileHandler(openFiles, 10),
    // Then images, before assets adds them to the animation: only where it is on screen.
    registerFileHandler(routeImageFiles, 7),
    // Last: explains files nobody could use.
    registerFileHandler(explainUnhandledFiles, -100),
    registerPasteHandler(handlePaste, 0),
    installAutosave(),
    installCleanTracking(),
    installRecentCommands(),
    installLeaveGuard(),
    installDevHandle(),
  ]
  // Once per page load (React StrictMode mounts twice in development).
  if (!restoreStarted) {
    restoreStarted = true
    void restoreLastSession()
  }
  return () => disposers.forEach((dispose) => dispose())
}
