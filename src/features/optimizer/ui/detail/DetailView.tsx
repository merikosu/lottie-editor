/**
 * One file in detail: the A/B comparison on the left; the result, where the savings came from,
 * this file's settings and what it contains on the right; downloads at the bottom.
 */
import {
  AlertCircle,
  Columns2,
  Diff,
  Grid2x2,
  Moon,
  SquareSplitHorizontal,
  Sun,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button, SegmentedControl, Switch, TabPanel, Tabs, Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import type { Animation } from '@/lottie/types'
import {
  setOptimizerSettings,
  useOptimizerSettings,
  type CompareMode,
  type DetailTab,
  type StageBackground,
} from '../../model/settings'
import { jobMatch, jobStatus } from '../../model/summary'
import type { Job } from '../../model/types'
import { removeFromQueue } from '../actions'
import { useFormat } from '../format'
import { useJob, usePolicy, useRememberDetail } from '../hooks'
import { SettingsPanel } from '../settings/SettingsPanel'
import { FrameClock } from './clock'
import { Compare } from './Compare'
import { DetailHeader } from './DetailHeader'
import { DetailsTab } from './DetailsTab'
import { Downloads } from './Downloads'
import { ResultSummary } from './ResultSummary'
import { SavingsTab } from './SavingsTab'
import { Transport } from './Transport'
import { useDetailKeys } from './keys'
import { FIT_VIEW, type View } from './layout'

function parse(json: string | undefined): Animation | null {
  if (!json) return null
  try {
    return JSON.parse(json) as Animation
  } catch {
    return null
  }
}

function CompareToolbar({
  clock,
  worstFrame,
  different,
  checkedFrames,
}: {
  clock: FrameClock
  worstFrame: number | null
  /** The check found a visible difference (otherwise its worst frame is not worth a visit). */
  different: boolean
  checkedFrames: number
}) {
  const t = useT()
  const mode = useOptimizerSettings((s) => s.compareMode)
  const background = useOptimizerSettings((s) => s.background)
  const amplify = useOptimizerSettings((s) => s.amplify)
  const C = t.optimizer.compare
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-2">
      <SegmentedControl<CompareMode>
        value={mode}
        onValueChange={(compareMode) => setOptimizerSettings({ compareMode })}
        aria-label={C.label}
        options={[
          { value: 'side', icon: Columns2, label: C.side },
          { value: 'swipe', icon: SquareSplitHorizontal, label: C.swipe },
          { value: 'difference', icon: Diff, label: C.difference },
        ]}
      />
      {mode === 'difference' && (
        <div className="flex min-w-0 items-center gap-3 pl-2">
          <label className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
            <Switch
              checked={amplify}
              onCheckedChange={(v) => setOptimizerSettings({ amplify: v })}
              aria-label={C.amplify}
            />
            {C.amplify}
          </label>
          {worstFrame !== null && different ? (
            <Tooltip content={C.worstFrameHint}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clock.pause()
                  clock.seek(worstFrame)
                }}
                data-testid="opt-worst-frame"
              >
                {C.worstFrame(Math.round(worstFrame))}
              </Button>
            </Tooltip>
          ) : (
            checkedFrames > 0 && (
              <span className="truncate text-xs text-fg-subtle">
                {C.noDifference(checkedFrames)}
              </span>
            )
          )}
        </div>
      )}
      <div className="flex-1" />
      <SegmentedControl<StageBackground>
        value={background}
        onValueChange={(value) => setOptimizerSettings({ background: value })}
        aria-label={C.background}
        options={[
          { value: 'checker', icon: Grid2x2, title: C.backgrounds.checker },
          { value: 'dark', icon: Moon, title: C.backgrounds.dark },
          { value: 'light', icon: Sun, title: C.backgrounds.light },
        ]}
      />
    </div>
  )
}

function Failed({ job }: { job: Job }) {
  const t = useT()
  const error = job.error ?? job.parts.find((p) => p.error)?.error ?? null
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center"
      data-testid="opt-detail-error"
    >
      <AlertCircle size={20} className="mb-1 text-danger" />
      <p className="text-sm font-medium text-fg">{error?.title ?? t.optimizer.status.error}</p>
      {error?.lines.map((line, i) => (
        <p key={i} className="selectable max-w-[440px] text-xs text-fg-muted">
          {line}
        </p>
      ))}
      <Button variant="secondary" icon={X} className="mt-3" onClick={() => removeFromQueue(job.id)}>
        {t.optimizer.row.remove}
      </Button>
    </div>
  )
}

export function DetailView({ jobId }: { jobId: string }) {
  const t = useT()
  const f = useFormat()
  const job = useJob(jobId)
  const policy = usePolicy(job)
  const mode = useOptimizerSettings((s) => s.compareMode)
  const background = useOptimizerSettings((s) => s.background)
  const amplify = useOptimizerSettings((s) => s.amplify)
  const tab = useOptimizerSettings((s) => s.detailTab)
  const [view, setView] = useState<View>(FIT_VIEW)
  const clock = useMemo(() => new FrameClock(), [])
  useEffect(() => () => clock.dispose(), [clock])

  const part = job?.parts[job.active]
  const original = useMemo(() => parse(part?.source), [part?.source])
  const optimized = useMemo(() => parse(part?.result?.json), [part?.result?.json])
  const info = part?.info
  useEffect(() => {
    if (info) clock.setRange({ ip: info.ip, op: info.op, fps: info.fps })
  }, [clock, info])

  const visual = part?.verify.visual
  const worstFrame = visual && visual.worstShare > 0 ? visual.worstFrame : null
  const [atWorst, setAtWorst] = useState(false)
  useEffect(
    () =>
      clock.subscribe((frame, playing) =>
        setAtWorst(!playing && worstFrame !== null && Math.abs(frame - worstFrame) < 0.5),
      ),
    [clock, worstFrame],
  )

  useDetailKeys(clock, setView)
  useRememberDetail(jobId)

  if (!job || !policy) return null
  const status = jobStatus(job, policy)
  const match = jobMatch(job, policy)
  const report = part?.result?.report
  const busy = status === 'reading' || status === 'queued' || status === 'optimizing'
  const S = t.optimizer.status
  const relaxing = !!part?.result && part.verify.visual?.match === false && status !== 'done'
  const statusText =
    status === 'reading'
      ? S.reading
      : status === 'verifying'
        ? part?.verify.status === 'running'
          ? S.verifying
          : S.checkQueued
        : relaxing
          ? S.adjusting
          : status === 'queued' && !job.parts.some((p) => p.run)
            ? S.queued
            : S.optimizing

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="opt-detail" data-status={status}>
      <DetailHeader job={job} status={status} />
      {job.phase === 'error' ? (
        <Failed job={job} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <CompareToolbar
              clock={clock}
              worstFrame={worstFrame}
              different={visual?.match === false}
              checkedFrames={visual?.frames.length ?? 0}
            />
            <Compare
              key={part?.id ?? 'none'}
              original={original}
              optimized={optimized}
              originalSize={report ? f.bytes(report.before.raw) : undefined}
              optimizedSize={report ? f.bytes(report.after.raw) : undefined}
              mode={mode}
              background={background}
              amplify={amplify}
              view={view}
              onView={setView}
              clock={clock}
              visual={visual}
              showHeatmap={atWorst}
              pending={optimized ? null : statusText}
            />
            <Transport
              clock={clock}
              range={info ? { ip: info.ip, op: info.op, fps: info.fps } : { ip: 0, op: 1, fps: 30 }}
              visual={visual}
            />
          </div>
          <aside
            className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface-1"
            data-opt-sidebar
            aria-label={job.name}
          >
            <ResultSummary job={job} part={part} match={match} busy={busy} status={statusText} />
            <Tabs<DetailTab>
              value={tab}
              onValueChange={(detailTab) => setOptimizerSettings({ detailTab })}
              className="min-h-0 flex-1"
              items={[
                { value: 'savings', label: t.optimizer.tabs.savings },
                { value: 'settings', label: t.optimizer.tabs.settings },
                { value: 'details', label: t.optimizer.tabs.details },
              ]}
            >
              <TabPanel value="savings" className="overflow-y-auto">
                <SavingsTab report={report} />
              </TabPanel>
              <TabPanel value="settings" className="overflow-y-auto">
                <SettingsPanel scope="file" jobId={job.id} />
              </TabPanel>
              <TabPanel value="details" className="overflow-y-auto">
                <DetailsTab part={part} version={original?.v} />
              </TabPanel>
            </Tabs>
            <Downloads job={job} />
          </aside>
        </div>
      )}
    </div>
  )
}
