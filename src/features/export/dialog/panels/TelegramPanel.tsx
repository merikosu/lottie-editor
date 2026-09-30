/** Telegram sticker: requirements checklist, fixes applied on export, size budget. */
import { CircleCheck, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { SegmentedControl, Tooltip } from '@/components/ui'
import { TGS_RULES, type TgsOptions } from '@/export/lottie-files'
import { TGS_FEATURES, type TgsCheck, type TgsCheckStatus } from '@/export/telegram'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useFormatter } from '../../format'
import { updateFormatPrefs } from '../../store'
import { Note, OptionDivider, OptionHeading, OptionRow, OptionStack } from '../fields'
import { SwitchField } from './common'
import { TransformRows } from './LottiePanels'
import type { PanelProps } from './types'

function StatusIcon({ status }: { status: TgsCheckStatus }) {
  if (status === 'pending')
    return <LoaderCircle size={14} className="shrink-0 animate-spin text-fg-faint" aria-hidden />
  return status === 'pass' ? (
    <CircleCheck size={14} className="shrink-0 text-success" aria-hidden />
  ) : (
    <CircleX size={14} className="shrink-0 text-danger" aria-hidden />
  )
}

function CheckRow({
  status,
  label,
  value,
  tooltip,
  children,
}: {
  status: TgsCheckStatus
  label: ReactNode
  value?: ReactNode
  /** Details on hover (e.g. the layers that use a feature). */
  tooltip?: string
  children?: ReactNode
}) {
  const line = (
    <div className="flex items-center gap-2">
      <StatusIcon status={status} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          status === 'fail' ? 'text-fg' : 'text-fg-muted',
        )}
      >
        {label}
      </span>
      {value !== undefined && (
        <span
          className={cn(
            'shrink-0 text-sm tabular-nums',
            status === 'fail' ? 'text-danger' : 'text-fg-subtle',
          )}
        >
          {value}
        </span>
      )}
    </div>
  )
  return (
    <li className="flex min-h-7 flex-col justify-center gap-1 px-3 py-1" data-status={status}>
      {tooltip ? (
        <Tooltip content={tooltip} side="left">
          {line}
        </Tooltip>
      ) : (
        line
      )}
      {children}
    </li>
  )
}

/** Share of the 64 KB budget, as a thin bar. */
function Budget({ bytes }: { bytes: number }) {
  const ratio = bytes / TGS_RULES.maxBytes
  return (
    <div className="ml-[22px] h-1 overflow-hidden rounded-full bg-line" aria-hidden>
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-150',
          ratio > 1 ? 'bg-danger' : ratio > 0.85 ? 'bg-warning' : 'bg-success',
        )}
        style={{ width: `${Math.min(100, ratio * 100)}%` }}
      />
    </div>
  )
}

const set = (patch: Partial<TgsOptions>) => updateFormatPrefs('tgs', patch)

export function TelegramPanel({ doc, prefs, model }: PanelProps) {
  const t = useT()
  const fmt = useFormatter()
  const o = prefs.tgs
  const stats = model.tgs.value
  const report = stats?.report
  const out = stats?.doc
  const check = (id: TgsCheck['id']): TgsCheck | undefined =>
    report?.checks.find((c) => c.id === id)
  const statusOf = (id: TgsCheck['id']): TgsCheckStatus =>
    model.tgs.pending || !report ? 'pending' : (check(id)?.status ?? 'pending')
  const failing =
    report?.checks.filter((c) => c.status === 'fail' && TGS_FEATURES.includes(c.id)) ?? []
  const seconds = doc.fr > 0 ? (doc.op - doc.ip) / doc.fr : 0

  return (
    <OptionStack>
      {report && !model.tgs.pending && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
            report.failures === 0
              ? 'bg-success-subtle text-success'
              : 'bg-warning-subtle text-warning',
          )}
          data-testid="export-tgs-status"
        >
          {report.failures === 0 ? (
            <CircleCheck size={14} aria-hidden />
          ) : (
            <TriangleAlert size={14} aria-hidden />
          )}
          <span className="min-w-0">
            {report.failures === 0 ? t.export.tgs.ready : t.export.tgs.issues(report.failures)}
          </span>
        </div>
      )}
      <OptionHeading>{t.export.tgs.requirements}</OptionHeading>
      <ul
        className="flex flex-col divide-y divide-line rounded-md shadow-[inset_0_0_0_1px_var(--le-line)]"
        data-testid="export-tgs-checklist"
      >
        <CheckRow
          status={statusOf('size')}
          label={t.export.tgs.checks.size}
          value={out ? t.export.tgs.sizeValue(out.w, out.h) : undefined}
        />
        <CheckRow
          status={statusOf('fps')}
          label={t.export.tgs.checks.fps}
          value={out ? t.export.tgs.fpsValue(fmt.decimal(out.fr)) : undefined}
        />
        <CheckRow
          status={statusOf('duration')}
          label={t.export.tgs.checks.duration}
          value={
            out ? t.export.tgs.durationValue(fmt.decimal((out.op - out.ip) / out.fr)) : undefined
          }
        />
        <CheckRow
          status={statusOf('fileSize')}
          label={t.export.tgs.checks.fileSize}
          value={
            stats
              ? t.export.summary.of(fmt.size(stats.bytes), fmt.size(TGS_RULES.maxBytes, 0))
              : undefined
          }
        >
          {stats && <Budget bytes={stats.bytes} />}
        </CheckRow>
        {failing.length === 0 ? (
          <CheckRow
            status={report && !model.tgs.pending ? 'pass' : 'pending'}
            label={t.export.tgs.unsupportedFeatures}
            value={t.export.tgs.noFeatures}
          />
        ) : (
          failing.map((c) => (
            <CheckRow
              key={c.id}
              status={model.tgs.pending ? 'pending' : 'fail'}
              label={t.export.tgs.checks[c.id]}
              value={t.export.tgs.count(c.count)}
              tooltip={c.layers.length ? t.export.tgs.usedIn(c.layers.join(', ')) : undefined}
            />
          ))
        )}
      </ul>

      <OptionDivider />
      <OptionHeading>{t.export.tgs.fixes}</OptionHeading>
      {(doc.w !== TGS_RULES.width || doc.h !== TGS_RULES.height) && (
        <OptionRow label={t.export.fields.size}>
          <SwitchField
            checked={o.fitSize}
            onChange={(fitSize) => set({ fitSize })}
            testId="export-tgs-fit"
          >
            {t.export.tgs.fitSize}
          </SwitchField>
        </OptionRow>
      )}
      {Math.abs(doc.fr - TGS_RULES.fps) > 1e-6 && (
        <OptionRow label={t.export.fields.frameRate}>
          <SwitchField
            checked={o.fixFps}
            onChange={(fixFps) => set({ fixFps })}
            testId="export-tgs-fps"
          >
            {t.export.tgs.fixFps}
          </SwitchField>
        </OptionRow>
      )}
      {seconds > TGS_RULES.maxSeconds + 1e-6 && (
        <OptionRow label={t.export.tgs.longer}>
          <SegmentedControl<TgsOptions['duration']>
            value={o.duration}
            onValueChange={(duration) => set({ duration })}
            size="md"
            aria-label={t.export.tgs.longer}
            options={[
              { value: 'keep', label: t.export.tgs.keep },
              { value: 'trim', label: t.export.tgs.trim },
              { value: 'speed', label: t.export.tgs.speedUp },
            ]}
          />
        </OptionRow>
      )}
      <TransformRows
        precision={o.precision}
        stripNames={o.stripNames}
        onChange={(patch) => set(patch)}
      />
      <Note>{t.export.tgs.fixesHint}</Note>
    </OptionStack>
  )
}
