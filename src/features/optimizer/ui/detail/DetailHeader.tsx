/**
 * Header of the detail view: back to all files, previous / next file, the file's name and format,
 * the animation shown (for files with several), and its main actions.
 */
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  PenTool,
} from 'lucide-react'
import { Button, IconButton, Select, Tooltip } from '@/components/ui'
import { TruncatedText } from '@/features/io'
import { useT } from '@/i18n'
import { useDocument } from '@/store/document'
import { hasOutput } from '../../model/output'
import { useOptimizerSettings } from '../../model/settings'
import { selectJob, setActivePart, stepSelection, useOptimizer } from '../../model/store'
import { outputFormat } from '../../model/summary'
import type { Job, JobStatus } from '../../model/types'
import { downloadJob, optimizeCurrentVersion, replaceInEditor } from '../actions'
import { FormatChip } from '../common'

function EditorActions({ job }: { job: Job }) {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  if (job.origin.kind !== 'editor') return null
  const D = t.optimizer.detail
  const same = doc !== null && doc === job.origin.doc
  if (same && job.origin.replaced) {
    return (
      <Tooltip content={D.replacedHint}>
        <span
          className="flex h-7 items-center gap-1.5 px-2 text-sm text-success"
          data-testid="opt-replaced"
        >
          <Check size={14} strokeWidth={2.25} />
          {D.replaced}
        </span>
      </Tooltip>
    )
  }
  if (!same) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Tooltip content={D.staleHint}>
          <span className="truncate text-xs text-warning">{D.stale}</span>
        </Tooltip>
        <Button
          variant="secondary"
          icon={RefreshCw}
          onClick={optimizeCurrentVersion}
          disabled={!doc}
        >
          {D.optimizeCurrent}
        </Button>
      </span>
    )
  }
  return (
    <Tooltip content={D.replaceHint}>
      <Button
        variant="secondary"
        icon={PenTool}
        onClick={() => replaceInEditor(job.id)}
        disabled={!hasOutput(job)}
        data-testid="opt-replace"
      >
        {D.replace}
      </Button>
    </Tooltip>
  )
}

export function DetailHeader({ job, status }: { job: Job; status: JobStatus }) {
  const t = useT()
  const D = t.optimizer.detail
  const index = useOptimizer((s) => s.jobs.findIndex((j) => j.id === job.id))
  const total = useOptimizer((s) => s.jobs.length)
  const output = useOptimizerSettings((s) => s.output)
  const format = outputFormat(job, output)
  const ready = hasOutput(job) && status !== 'reading'
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-surface-1 px-2">
      <Tooltip content={t.optimizer.commands.back} shortcut="escape">
        <Button
          variant="ghost"
          icon={ArrowLeft}
          onClick={() => selectJob(null)}
          data-testid="opt-back"
        >
          {D.back}
        </Button>
      </Tooltip>
      <span className="flex shrink-0 items-center">
        <IconButton
          icon={ChevronUp}
          label={D.previous}
          shortcut="up"
          disabled={index <= 0}
          onClick={() => stepSelection(-1)}
        />
        <IconButton
          icon={ChevronDown}
          label={D.next}
          shortcut="down"
          disabled={index < 0 || index >= total - 1}
          onClick={() => stepSelection(1)}
        />
        <span className="px-1 text-xs text-fg-subtle tabular-nums">
          {D.position(index + 1, total)}
        </span>
      </span>
      <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-line-strong" />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <TruncatedText text={job.name} className="text-sm font-medium text-fg" />
        <FormatChip job={job} />
        {job.parts.length > 1 && (
          <Select<string>
            value={String(job.active)}
            onValueChange={(v) => setActivePart(job.id, Number(v))}
            options={job.parts.map((p, i) => ({ value: String(i), label: p.name || p.id }))}
            aria-label={D.animation}
            className="w-auto max-w-[220px] min-w-[120px]"
          />
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <EditorActions job={job} />
        {/* A file that could not be read has nothing to download. */}
        {job.phase !== 'error' && (
          <Button
            variant="primary"
            icon={Download}
            disabled={!ready}
            onClick={() => downloadJob(job)}
            data-testid="opt-download"
          >
            {t.optimizer.row.download(t.optimizer.downloads[format])}
          </Button>
        )}
      </span>
    </header>
  )
}
