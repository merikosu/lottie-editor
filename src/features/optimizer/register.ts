/**
 * Registers the optimizer: the editor's "Optimize…" command, the optimizer page's commands, the
 * file handler that turns files dropped on the page into jobs, and the runner that works through
 * the queue. Returns the cleanup function.
 */
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Columns2,
  Diff,
  Download,
  FolderOpen,
  Gauge,
  PenTool,
  SquareSplitHorizontal,
  Trash2,
} from 'lucide-react'
import { currentRoute } from '@/app/router'
import { registerFileHandler } from '@/commands/files'
import { registerCommands, type Command } from '@/commands/registry'
import { useDocument } from '@/store/document'
import { handleFiles, optimizeEditorDocument } from './model/intake'
import { hasOutput, pruneOutputs } from './model/output'
import { startRunner } from './model/runner'
import { presetOf, setOptimizerSettings, useOptimizerSettings } from './model/settings'
import { getJob, selectJob, stepSelection, useOptimizer } from './model/store'
import {
  canDownloadAll,
  chooseFiles,
  clearQueue,
  downloadAll,
  downloadJob,
  editorHasJobDocument,
  replaceInEditor,
  setQueuePreset,
} from './ui/actions'
import * as intake from './model/intake'
import * as output from './model/output'
import * as store from './model/store'
import * as settings from './model/settings'

const onPage = () => currentRoute() === 'optimize'
const selected = () => {
  const { selectedId } = useOptimizer.getState()
  return selectedId ? getJob(selectedId) : undefined
}
const inDetail = () => onPage() && !!selected()

function commands(): Command[] {
  return [
    {
      id: 'anim.optimize',
      title: (t) => t.optimizer.commands.optimize,
      category: 'animation',
      icon: Gauge,
      keywords: ['compress', 'minify', 'smaller', 'size', 'сжать', 'уменьшить'],
      enabled: () => useDocument.getState().doc !== null,
      run: optimizeEditorDocument,
    },
    {
      id: 'optimizer.chooseFiles',
      title: (t) => t.optimizer.commands.chooseFiles,
      category: 'file',
      icon: FolderOpen,
      // ⌘O opens files everywhere; on this page they become jobs (see the file handler).
      displayShortcut: 'mod+o',
      keywords: ['add', 'open', 'добавить'],
      run: chooseFiles,
    },
    {
      id: 'optimizer.downloadAll',
      title: (t) => t.optimizer.commands.downloadAll,
      category: 'file',
      icon: Download,
      keywords: ['zip', 'save', 'скачать'],
      enabled: canDownloadAll,
      run: downloadAll,
    },
    {
      id: 'optimizer.clear',
      title: (t) => t.optimizer.commands.clear,
      category: 'edit',
      icon: Trash2,
      enabled: () => useOptimizer.getState().jobs.length > 0,
      run: clearQueue,
    },
    ...(['safe', 'balanced', 'maximum'] as const).map<Command>((id) => ({
      id: `optimizer.preset.${id}`,
      title: (t) =>
        id === 'safe'
          ? t.optimizer.commands.presetSafe
          : id === 'balanced'
            ? t.optimizer.commands.presetBalanced
            : t.optimizer.commands.presetMaximum,
      category: 'edit',
      icon: Gauge,
      checked: () => presetOf(useOptimizerSettings.getState().options) === id,
      run: () => setQueuePreset(id),
    })),
    {
      id: 'optimizer.back',
      title: (t) => t.optimizer.commands.back,
      category: 'view',
      icon: ArrowLeft,
      displayShortcut: 'escape',
      enabled: inDetail,
      run: () => selectJob(null),
    },
    {
      id: 'optimizer.previous',
      title: (t) => t.optimizer.commands.previous,
      category: 'view',
      icon: ChevronUp,
      displayShortcut: 'up',
      enabled: () => {
        const { jobs, selectedId } = useOptimizer.getState()
        return inDetail() && jobs.findIndex((j) => j.id === selectedId) > 0
      },
      run: () => stepSelection(-1),
    },
    {
      id: 'optimizer.next',
      title: (t) => t.optimizer.commands.next,
      category: 'view',
      icon: ChevronDown,
      displayShortcut: 'down',
      enabled: () => {
        const { jobs, selectedId } = useOptimizer.getState()
        const i = jobs.findIndex((j) => j.id === selectedId)
        return inDetail() && i >= 0 && i < jobs.length - 1
      },
      run: () => stepSelection(1),
    },
    {
      id: 'optimizer.compare.side',
      title: (t) => t.optimizer.commands.compareSide,
      category: 'view',
      icon: Columns2,
      displayShortcut: '1',
      checked: () => useOptimizerSettings.getState().compareMode === 'side',
      run: () => setOptimizerSettings({ compareMode: 'side' }),
    },
    {
      id: 'optimizer.compare.swipe',
      title: (t) => t.optimizer.commands.compareSwipe,
      category: 'view',
      icon: SquareSplitHorizontal,
      displayShortcut: '2',
      checked: () => useOptimizerSettings.getState().compareMode === 'swipe',
      run: () => setOptimizerSettings({ compareMode: 'swipe' }),
    },
    {
      id: 'optimizer.compare.difference',
      title: (t) => t.optimizer.commands.compareDifference,
      category: 'view',
      icon: Diff,
      displayShortcut: '3',
      checked: () => useOptimizerSettings.getState().compareMode === 'difference',
      run: () => setOptimizerSettings({ compareMode: 'difference' }),
    },
    {
      id: 'optimizer.download',
      title: (t) => t.optimizer.commands.download,
      category: 'file',
      icon: Download,
      enabled: () => {
        const job = selected()
        return inDetail() && !!job && hasOutput(job)
      },
      run: () => {
        const job = selected()
        if (job) downloadJob(job)
      },
    },
    {
      id: 'optimizer.replace',
      title: (t) => t.optimizer.commands.replace,
      category: 'file',
      icon: PenTool,
      enabled: () => {
        const job = selected()
        return inDetail() && !!job && hasOutput(job) && editorHasJobDocument(job)
      },
      run: () => {
        const job = selected()
        if (job) replaceInEditor(job.id)
      },
    },
  ]
}

/** Forgets cached output files of removed jobs. */
function installOutputPruning(): () => void {
  return useOptimizer.subscribe((s, prev) => {
    if (s.jobs !== prev.jobs) pruneOutputs(new Set(s.jobs.map((j) => j.id)))
  })
}

const DEV_HANDLE = '__leOpt'

/** Development handle for e2e scripts: `window.__leOpt`. */
function installDevHandle(): () => void {
  if (!import.meta.env.DEV) return () => {}
  const w = window as unknown as Record<string, unknown>
  w[DEV_HANDLE] = { ...store, ...settings, ...intake, ...output }
  return () => {
    delete w[DEV_HANDLE]
  }
}

export function register(): () => void {
  const disposers = [
    registerCommands(commands()),
    // Before the io feature (10): on the optimizer page, files become jobs instead of documents.
    registerFileHandler(handleFiles, 50),
    startRunner(),
    installOutputPruning(),
    installDevHandle(),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
