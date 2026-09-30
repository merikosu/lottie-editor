/**
 * The export dialog: formats on the left, options and a live preview on the right, and a
 * sticky footer with the file name, a summary, and Copy / Export (progress while rendering).
 */
import { Check, CircleAlert, Copy, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Dialog, TextInput, Tooltip } from '@/components/ui'
import type { ExportRenderer } from '@/export/render'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { hasModKey } from '@/lib/platform'
import type { Animation } from '@/lottie/types'
import { useDocument, type DocumentMeta } from '@/store/document'
import { usePlayback } from '@/store/playback'
import { usePrefs } from '@/store/prefs'
import { copyExport, downloadOutput, notifyDone, startExport } from '../actions'
import { documentHasExpressions } from '../expressions'
import { useFormatter } from '../format'
import { FORMATS, defaultBaseName, formatExtension, joinFileName } from '../formats'
import type { ExportInput } from '../run'
import {
  cancelExport,
  clearExportError,
  isExporting,
  setExportFormat,
  useExportJob,
  useExportPrefs,
  type ExportFormat,
} from '../store'
import { FormatList } from './FormatList'
import { summaryParts, useExportModel } from './model'
import { EmbedPanel } from './panels/EmbedPanel'
import { FramePanel } from './panels/FramePanel'
import { DotLottiePanel, JsonPanel } from './panels/LottiePanels'
import { GifPanel, PngSequencePanel, VideoPanel } from './panels/RasterPanels'
import { TelegramPanel } from './panels/TelegramPanel'
import type { PanelProps } from './panels/types'
import { Preview } from './Preview'
import { ProgressBar, ProgressLabel } from './Progress'

export const EXPORT_DIALOG = 'export'

/** Copy button with a short "Copied" confirmation (no toast: copying is routine). */
function CopyAction({
  label,
  onCopy,
  primary,
  disabled,
}: {
  label: string
  onCopy: () => Promise<boolean>
  primary?: boolean
  disabled?: boolean
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      icon={copied ? Check : Copy}
      disabled={disabled}
      className="min-w-[88px]"
      data-testid="export-copy"
      onClick={async () => {
        if (!(await onCopy())) return
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1400)
      }}
    >
      {copied ? t.export.copied : label}
    </Button>
  )
}

function Panel({
  format,
  props,
  onCopyCode,
}: {
  format: ExportFormat
  props: PanelProps
  onCopyCode: () => Promise<boolean>
}) {
  switch (format) {
    case 'json':
      return <JsonPanel {...props} />
    case 'dotlottie':
      return <DotLottiePanel {...props} />
    case 'tgs':
      return <TelegramPanel {...props} />
    case 'gif':
      return <GifPanel {...props} />
    case 'mp4':
    case 'webm':
      return <VideoPanel {...props} format={format} />
    case 'png':
      return <PngSequencePanel {...props} />
    case 'framePng':
    case 'frameSvg':
      return <FramePanel {...props} format={format} />
    case 'embed':
      return <EmbedPanel {...props} onCopyCode={onCopyCode} />
  }
}

interface BodyProps {
  doc: Animation
  meta: DocumentMeta
  close: () => void
}

function ExportDialogBody({ doc, meta, close }: BodyProps) {
  const t = useT()
  const fmt = useFormatter()
  const prefs = useExportPrefs()
  const format = prefs.format
  const workArea = usePlayback((s) => s.workArea)
  const viewRenderer = usePrefs((s) => s.renderer)
  const runExpressions = usePrefs((s) => s.runExpressions)
  const running = useExportJob((s) => s.status === 'running')
  // A failure message only applies to the options it happened with.
  const error = useExportJob((s) => (s.error && s.errorFor === prefs ? s.error : null))
  const listRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState(() => Math.round(usePlayback.getState().frame))
  // null: follow the document name; otherwise the name the user typed.
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  const renderer: ExportRenderer = prefs.renderer === 'auto' ? viewRenderer : prefs.renderer
  const baseName = nameDraft ?? defaultBaseName(format, meta.fileName, frame)
  const expressionsOff = useMemo(
    () => !runExpressions && documentHasExpressions(doc),
    [doc, runExpressions],
  )

  // The extension depends on options (JSON with images as files becomes a .zip); snippets
  // reference the final name.
  const fileName = joinFileName(baseName, formatExtension(format, prefs, doc))
  const input: ExportInput = {
    doc,
    meta,
    prefs,
    workArea,
    frame,
    fileName,
    runExpressions,
    renderer,
  }
  const model = useExportModel({
    busy: running,
    format,
    doc,
    meta,
    prefs,
    workArea,
    frame,
    fileName,
    input,
  })
  const info = FORMATS[format]
  const summary = summaryParts(model, t, fmt, doc, prefs, frame)

  const onExport = () => {
    if (running || !model.canExport) return
    void startExport(format, input).then((result) => {
      if (!result) return
      downloadOutput(format, result, input)
      notifyDone(format, result)
      // The embed file goes with the code: stay open so the snippet can still be copied.
      if (format !== 'embed') close()
    })
  }
  const onCopy = () => copyExport(format, input, model)
  const onDownloadEmbedFile = onExport

  // ⌘↩ / Ctrl+Enter runs the primary action from anywhere in the dialog.
  const primaryRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    primaryRef.current = format === 'embed' ? () => void onCopy() : onExport
  })
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.repeat) return
      // Escape stops a running export. The dialog cannot close meanwhile, so it has already
      // prevented the default of this key: check before `defaultPrevented`.
      if (e.key === 'Escape' && isExporting()) {
        e.preventDefault()
        cancelExport()
        return
      }
      if (e.defaultPrevented || e.key !== 'Enter' || !hasModKey(e)) return
      e.preventDefault()
      primaryRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [primaryRef])

  const panelProps: PanelProps = {
    doc,
    prefs,
    model,
    workArea,
    frame,
    onFrame: setFrame,
    viewRenderer,
    fileName,
    expressionsOff,
  }

  const footerStart = running ? (
    <ProgressLabel />
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <TextInput
        aria-label={t.export.fileName}
        value={baseName}
        size="md"
        containerClassName="w-[220px] shrink-0"
        suffix={<span className="text-xs text-fg-subtle">.{model.ext}</span>}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={() => {
          if (nameDraft !== null && !nameDraft.trim()) setNameDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (format === 'embed') void onCopy()
            else onExport()
          }
        }}
        data-testid="export-filename"
      />
      {error ? (
        <Tooltip content={error} side="top">
          <span
            className="flex min-w-0 items-center gap-1.5 text-xs text-danger"
            data-testid="export-error"
          >
            <CircleAlert size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{error}</span>
          </span>
        </Tooltip>
      ) : (
        <Tooltip content={summary.join(' · ')} side="top">
          <span
            className="min-w-0 truncate text-xs text-fg-subtle tabular-nums"
            data-testid="export-summary"
          >
            {summary.join(' · ')}
          </span>
        </Tooltip>
      )}
    </div>
  )

  const footer = running ? (
    <Tooltip content={t.export.cancelHint} shortcut="escape" side="top">
      <Button variant="secondary" onClick={cancelExport} data-testid="export-cancel">
        {t.export.cancel}
      </Button>
    </Tooltip>
  ) : format === 'embed' ? (
    <>
      <Button
        variant="secondary"
        icon={Download}
        onClick={onDownloadEmbedFile}
        data-testid="export-download"
      >
        {t.export.download(fileName)}
      </Button>
      <CopyAction label={t.export.copyCode} onCopy={onCopy} primary />
    </>
  ) : (
    <>
      {info.copy && (
        <CopyAction label={t.export.copy} onCopy={onCopy} disabled={!model.canExport} />
      )}
      <Tooltip content={t.export.export} shortcut="mod+enter" side="top">
        <Button
          variant="primary"
          icon={Download}
          disabled={!model.canExport}
          onClick={onExport}
          className="min-w-[96px]"
          data-testid="export-submit"
        >
          {t.export.export}
        </Button>
      </Tooltip>
    </>
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !running && close()}
      // The close button hides while exporting: the title keeps the header height.
      title={<span className="block min-h-[26px]">{t.export.title}</span>}
      size="xl"
      className="w-[960px]"
      bodyClassName="p-0 overflow-hidden"
      dismissable={!running}
      footerStart={footerStart}
      footer={footer}
      onOpenAutoFocus={(e) => {
        // Start on the selected format (arrow keys switch formats), not on the close button.
        const selected = listRef.current?.querySelector<HTMLInputElement>('input:checked')
        if (!selected) return
        e.preventDefault()
        selected.focus({ preventScroll: true })
      }}
    >
      <div
        // Short windows: the body shrinks (lists and options scroll) instead of overflowing.
        className="relative flex h-[544px] max-h-[calc(88vh-108px)] min-h-0 border-t border-line"
        data-testid="export-dialog"
        data-format={format}
      >
        <div
          ref={listRef}
          className="w-[216px] shrink-0 overflow-y-auto border-r border-line bg-surface-0"
        >
          <FormatList
            value={format}
            onChange={(f) => {
              setExportFormat(f)
              clearExportError()
            }}
            unavailable={model.unavailable}
            disabled={running}
          />
        </div>
        <div
          className={cn('flex min-w-0 flex-1', running && 'pointer-events-none')}
          aria-busy={running}
        >
          <div
            className={cn(
              'min-w-0 flex-1 overflow-y-auto px-5 py-4',
              format === 'embed' && 'flex flex-col',
              running && 'opacity-60',
            )}
            key={format}
          >
            <Panel format={format} props={panelProps} onCopyCode={onCopy} />
          </div>
          {model.preview && (
            <div className="flex w-[276px] shrink-0 flex-col items-center py-4 pr-5">
              <Preview
                doc={model.preview.doc}
                width={model.preview.width}
                height={model.preview.height}
                background={model.preview.background}
                mode={model.preview.mode}
                paused={running}
              />
            </div>
          )}
        </div>
        <ProgressBar />
      </div>
    </Dialog>
  )
}

/** Registered dialog: renders nothing without a document. */
export function ExportDialog({ close }: DialogComponentProps) {
  const doc = useDocument((s) => s.doc)
  const meta = useDocument((s) => s.meta)
  if (!doc || !meta) return null
  return <ExportDialogBody doc={doc} meta={meta} close={close} />
}
