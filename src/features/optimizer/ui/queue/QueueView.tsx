/**
 * The queue: settings for every file on top, the totals, and one row per file. More files can be
 * dropped at any time (the window-wide drop target adds them here).
 */
import { Check, Download, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Spinner,
  Tooltip,
} from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { hasOutput } from '../../model/output'
import { setOptimizerSettings, useOptimizerSettings } from '../../model/settings'
import { useOptimizer } from '../../model/store'
import { queueTotals, savedShare } from '../../model/summary'
import type { OutputChoice } from '../../model/types'
import { chooseFiles, clearQueue, downloadAll, setQueuePreset } from '../actions'
import { PresetControl, ProgressBar } from '../common'
import { useFormat } from '../format'
import { useQueueSettings, useReturnToRow } from '../hooks'
import { SettingsPanel } from '../settings/SettingsPanel'
import { JobRow, ROW_COLUMNS } from './JobRow'

function OutputSelect() {
  const t = useT()
  const output = useOptimizerSettings((s) => s.output)
  return (
    <Select<OutputChoice>
      value={output}
      onValueChange={(value) => setOptimizerSettings({ output: value })}
      aria-label={t.optimizer.output.label}
      className="w-[136px]"
      options={[
        { value: 'same', label: t.optimizer.output.same },
        { value: 'json', label: t.optimizer.output.json },
        { value: 'lottie', label: t.optimizer.output.lottie },
      ]}
    />
  )
}

function Toolbar() {
  const t = useT()
  const options = useOptimizerSettings((s) => s.options)
  const ready = useOptimizer((s) => s.jobs.some(hasOutput))
  const count = useOptimizer((s) => s.jobs.length)
  // Files without a result yet (the ZIP holds the ones that are ready).
  const busy = useOptimizer(
    (s) => s.jobs.filter((j) => j.phase !== 'error' && !hasOutput(j)).length,
  )
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-surface-1">
      <div className="mx-auto flex h-11 w-full max-w-[1120px] items-center gap-3 px-6">
        <span className="shrink-0 text-xs whitespace-nowrap text-fg-subtle max-lg:hidden">
          {t.optimizer.presets.label}
        </span>
        <PresetControl options={options} onPreset={setQueuePreset} />
        <Popover>
          <Tooltip content={t.optimizer.queue.settings}>
            <PopoverTrigger asChild>
              <IconButton
                icon={SlidersHorizontal}
                label={t.optimizer.queue.settings}
                tooltip={false}
                data-testid="opt-queue-settings"
              />
            </PopoverTrigger>
          </Tooltip>
          {/* Wide enough for the three preset names side by side in every language. */}
          <PopoverContent align="start" className="w-[372px] p-0">
            <SettingsPanel scope="queue" />
          </PopoverContent>
        </Popover>
        <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />
        <span className="shrink-0 text-xs whitespace-nowrap text-fg-subtle max-lg:hidden">
          {t.optimizer.output.label}
        </span>
        <OutputSelect />
        <div className="flex-1" />
        {/* Labelled on wide screens; icons with tooltips where the toolbar needs the room. */}
        <Tooltip content={t.optimizer.queue.addFiles} shortcut="mod+o">
          <Button variant="ghost" icon={Plus} onClick={chooseFiles} data-testid="opt-add">
            <span className="max-xl:sr-only">{t.optimizer.queue.addFiles}</span>
          </Button>
        </Tooltip>
        <Tooltip content={t.optimizer.queue.clear}>
          <Button
            variant="ghost"
            icon={Trash2}
            onClick={clearQueue}
            disabled={!count}
            data-testid="opt-clear"
          >
            <span className="max-xl:sr-only">{t.optimizer.queue.clear}</span>
          </Button>
        </Tooltip>
        <Tooltip
          content={
            busy ? t.optimizer.queue.downloadAllPartial(busy) : t.optimizer.queue.downloadAllHint
          }
        >
          <Button
            variant="primary"
            icon={Download}
            onClick={() => void downloadAll()}
            disabled={!ready}
            data-testid="opt-download-all"
          >
            {t.optimizer.queue.downloadAll}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

function Stat({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-xs text-fg-subtle">{label}</span>
      <span className="flex min-w-0 items-baseline gap-2">{children}</span>
    </div>
  )
}

function Summary() {
  const t = useT()
  const f = useFormat()
  const jobs = useOptimizer((s) => s.jobs)
  const settings = useQueueSettings()
  const totals = queueTotals(jobs, settings)
  const { sizes } = totals
  const share = savedShare(sizes.beforeRaw, sizes.afterRaw)
  const gzipShare = savedShare(sizes.beforeGzip, sizes.afterGzip)
  const done = totals.files - totals.busy
  const measured = totals.measured > 0
  return (
    <section
      aria-label={t.optimizer.result.title}
      data-testid="opt-summary"
      className="mb-4 flex min-w-0 flex-wrap items-baseline gap-x-10 gap-y-3 px-1"
    >
      <Stat
        label={
          totals.busy > 0
            ? t.optimizer.queue.progress(done, totals.files)
            : t.optimizer.queue.files(totals.files)
        }
      >
        <span className="text-2xl font-semibold text-fg" data-testid="opt-total-saving">
          {measured ? f.saving(share) : '—'}
        </span>
      </Stat>
      {measured && (
        <Stat label={t.optimizer.result.json}>
          <Tooltip content={t.optimizer.queue.totalsHint}>
            <span className="text-base text-fg tabular-nums">
              <span className="text-fg-muted">{f.bytes(sizes.beforeRaw)}</span>
              <span className="px-1.5 text-fg-faint">→</span>
              {f.bytes(sizes.afterRaw)}
            </span>
          </Tooltip>
        </Stat>
      )}
      {measured && (
        <Stat label={t.optimizer.queue.gzip}>
          <span className="text-base text-fg tabular-nums">
            <span className="text-fg-muted">{f.bytes(sizes.beforeGzip)}</span>
            <span className="px-1.5 text-fg-faint">→</span>
            {f.bytes(sizes.afterGzip)}
          </span>
          <span className="text-sm text-fg-muted tabular-nums">{f.saving(gzipShare)}</span>
        </Stat>
      )}
      <div className="ml-auto flex min-w-0 items-center gap-3 self-end pb-1 text-sm">
        {totals.busy > 0 && (
          <span className="flex items-center gap-2 text-fg-subtle">
            <Spinner size={12} />
            <ProgressBar value={totals.files ? done / totals.files : 0} className="w-24" />
          </span>
        )}
        {totals.busy === 0 && totals.identical > 0 && totals.different === 0 && (
          <span className="flex items-center gap-1 text-success" data-testid="opt-all-identical">
            <Check size={14} strokeWidth={2.25} />
            {t.optimizer.queue.identical(totals.identical)}
          </span>
        )}
        {totals.different > 0 && (
          <span className="text-warning">{t.optimizer.queue.toReview(totals.different)}</span>
        )}
        {totals.failed > 0 && (
          <span className="text-danger">{t.optimizer.queue.failed(totals.failed)}</span>
        )}
      </div>
    </section>
  )
}

export function QueueView() {
  const t = useT()
  const jobs = useOptimizer((s) => s.jobs)
  useReturnToRow()
  return (
    <div className="flex min-h-full flex-col" data-testid="opt-queue">
      <Toolbar />
      <div className="mx-auto w-full max-w-[1120px] animate-fade-in px-6 pt-6 pb-16">
        <Summary />
        <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
          <div
            aria-hidden
            className={cn(ROW_COLUMNS, 'h-8 border-b border-line px-3 text-xs text-fg-subtle')}
          >
            <span className="pl-[46px]">{t.optimizer.queue.columns.file}</span>
            <span>{t.optimizer.queue.columns.size}</span>
            <span>{t.optimizer.queue.columns.saved}</span>
            <span>{t.optimizer.queue.columns.check}</span>
            <span />
          </div>
          <ul aria-label={t.optimizer.queue.label} data-testid="opt-list">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        </div>
        <p className="mt-3 text-center text-xs text-fg-subtle">{t.optimizer.queue.dropMore}</p>
      </div>
    </div>
  )
}
