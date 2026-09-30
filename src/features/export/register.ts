/**
 * Registers the export feature: the export dialog, "Export as …" commands for every format,
 * and the quick frame/JSON commands (also used by the canvas context menu).
 * The dialog and the encoders load on first use.
 */
import { Copy, Download, FileCode2, ImageDown } from 'lucide-react'
import { lazy } from 'react'
import { registerDialog } from '@/commands/dialogs'
import { registerCommands, type Command } from '@/commands/registry'
import { toast } from '@/components/ui'
import { getT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { getDoc, useDocument } from '@/store/document'
import { usePlayback } from '@/store/playback'
import { usePrefs } from '@/store/prefs'
import { openDialog } from '@/store/ui'
import { FORMATS, defaultBaseName, formatExtension, isStillFormat, joinFileName } from './formats'
import type { ExportInput } from './run'
import {
  isExporting,
  setExportFormat,
  useExportJob,
  useExportPrefs,
  type ExportFormat,
} from './store'

const EXPORT_DIALOG = 'export'

const ExportDialog = lazy(() =>
  import('./dialog/ExportDialog').then((m) => ({ default: m.ExportDialog })),
)
const loadActions = () => import('./actions')

const hasDoc = () => getDoc() !== null
const canExport = () => hasDoc() && !isExporting()

/**
 * Opens the export dialog, on `format` or the last one used. `still`: start with one frame as
 * the content of the Lottie formats.
 */
export function openExport(format?: ExportFormat, opts: { still?: boolean } = {}): void {
  if (format) setExportFormat(format)
  openDialog(EXPORT_DIALOG, opts.still ? { still: true } : undefined)
}

/** Export input for commands run outside the dialog (current frame, remembered options). */
function currentInput(format: ExportFormat): ExportInput | null {
  const { doc, meta } = useDocument.getState()
  if (!doc || !meta) return null
  const prefs = useExportPrefs.getState()
  const view = usePrefs.getState()
  const playback = usePlayback.getState()
  const frame = Math.round(playback.frame)
  return {
    doc,
    meta,
    prefs,
    workArea: playback.workArea,
    frame,
    fileName: joinFileName(
      defaultBaseName(format, meta.fileName, frame),
      formatExtension(format, prefs, doc),
    ),
    runExpressions: view.runExpressions,
    renderer: prefs.renderer === 'auto' ? view.renderer : prefs.renderer,
  }
}

async function copyFrame(format: 'framePng' | 'frameSvg'): Promise<void> {
  const input = currentInput(format)
  if (!input) return
  const { copyExport } = await loadActions()
  await copyExport(format, input)
}

async function saveFramePng(): Promise<void> {
  const input = currentInput('framePng')
  if (!input) return
  const { describeError, downloadOutput, notifyDone } = await loadActions()
  const { runExport } = await import('./run')
  try {
    const output = await runExport('framePng', input)
    downloadOutput('framePng', output, input)
    notifyDone('framePng', output)
  } catch (err) {
    toast.error(getT().export.errors.failed, { description: describeError(err) })
  }
}

async function copyJson(): Promise<void> {
  const doc = getDoc()
  if (!doc) return
  if (!(await copyText(JSON.stringify(doc)))) toast.error(getT().export.errors.clipboard)
}

const FORMAT_COMMANDS: {
  id: string
  format: ExportFormat
  title: (t: ReturnType<typeof getT>) => string
  keywords: string[]
}[] = [
  {
    id: 'export.gif',
    format: 'gif',
    title: (t) => t.export.commands.exportGif,
    keywords: ['gif', 'animated', 'гиф'],
  },
  {
    id: 'export.mp4',
    format: 'mp4',
    title: (t) => t.export.commands.exportMp4,
    keywords: ['video', 'mp4', 'h264', 'видео'],
  },
  {
    id: 'export.webm',
    format: 'webm',
    title: (t) => t.export.commands.exportWebm,
    keywords: ['video', 'webm', 'vp9', 'alpha', 'видео'],
  },
  {
    id: 'export.json',
    format: 'json',
    title: (t) => t.export.commands.exportJson,
    keywords: ['json', 'lottie', 'minify', 'сжать'],
  },
  {
    id: 'export.dotlottie',
    format: 'dotlottie',
    title: (t) => t.export.commands.exportDotLottie,
    keywords: ['dotlottie', 'lottie', 'zip'],
  },
  {
    id: 'export.tgs',
    format: 'tgs',
    title: (t) => t.export.commands.exportTgs,
    keywords: ['telegram', 'sticker', 'tgs', 'телеграм', 'стикер'],
  },
  {
    id: 'export.pngSequence',
    format: 'png',
    title: (t) => t.export.commands.exportPngSequence,
    keywords: ['png', 'frames', 'sequence', 'кадры'],
  },
  {
    id: 'export.embed',
    format: 'embed',
    title: (t) => t.export.commands.exportEmbed,
    keywords: ['embed', 'html', 'react', 'code', 'встроить', 'код'],
  },
]

const DEV_HANDLE = '__leExport'

/** Development handle for scripted screenshots: `window.__leExport`. */
function installDevHandle(): () => void {
  if (!import.meta.env.DEV) return () => undefined
  const w = window as unknown as Record<string, unknown>
  w[DEV_HANDLE] = { useExportPrefs, useExportJob, openExport, setExportFormat }
  return () => {
    delete w[DEV_HANDLE]
  }
}

/**
 * Registers this feature's commands and dialogs. Called once by the app on startup;
 * returns a cleanup function.
 */
export function register(): () => void {
  const commands: Command[] = [
    {
      id: 'file.export',
      title: (t) => t.export.commands.export,
      category: 'file',
      icon: Download,
      shortcut: 'mod+shift+e',
      keywords: ['export', 'save as', 'gif', 'video', 'mp4', 'экспорт', 'сохранить как'],
      enabled: canExport,
      run: () => openExport(),
    },
    ...FORMAT_COMMANDS.map<Command>((c) => ({
      id: c.id,
      title: c.title,
      category: 'file',
      icon: FORMATS[c.format].icon,
      keywords: ['export', 'экспорт', ...c.keywords],
      enabled: canExport,
      run: () => openExport(c.format),
    })),
    {
      id: 'export.frameLottie',
      title: (t) => t.export.commands.exportFrameLottie,
      category: 'file',
      icon: FORMATS.json.icon,
      keywords: [
        'export',
        'frame',
        'still',
        'static',
        'sticker',
        'экспорт',
        'кадр',
        'статичный',
        'стикер',
      ],
      enabled: canExport,
      // The last Lottie format used (a sticker pack keeps choosing Telegram), else JSON.
      run: () => {
        const last = useExportPrefs.getState().format
        openExport(isStillFormat(last) ? last : 'json', { still: true })
      },
    },
    {
      id: 'export.copyFramePng',
      title: (t) => t.export.commands.copyFramePng,
      category: 'file',
      icon: Copy,
      shortcut: 'mod+shift+c',
      keywords: ['copy', 'image', 'png', 'screenshot', 'копировать', 'кадр'],
      enabled: hasDoc,
      run: () => copyFrame('framePng'),
    },
    {
      id: 'export.copyFrameSvg',
      title: (t) => t.export.commands.copyFrameSvg,
      category: 'file',
      icon: FileCode2,
      keywords: ['copy', 'svg', 'vector', 'figma', 'копировать', 'вектор'],
      enabled: hasDoc,
      run: () => copyFrame('frameSvg'),
    },
    {
      id: 'export.saveFramePng',
      title: (t) => t.export.commands.saveFramePng,
      category: 'file',
      icon: ImageDown,
      keywords: ['save', 'image', 'png', 'snapshot', 'сохранить', 'кадр'],
      enabled: hasDoc,
      run: saveFramePng,
    },
    {
      id: 'export.copyJson',
      title: (t) => t.export.commands.copyJson,
      category: 'file',
      icon: Copy,
      keywords: ['copy', 'json', 'clipboard', 'копировать'],
      enabled: hasDoc,
      run: copyJson,
    },
  ]
  const disposers = [
    registerCommands(commands),
    registerDialog(EXPORT_DIALOG, ExportDialog),
    installDevHandle(),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
