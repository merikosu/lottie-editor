import { useState, type ReactNode } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Checkbox, Dialog, Tooltip } from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatDecimal } from '@/lib/format'
import { roundTo } from '@/lib/math'
import type { Animation } from '@/lottie/types'
import { useDocument } from '@/store/document'
import { applyTiming } from '../actions'
import { planTiming } from '../plan'
import { formatFps, formatPercent, formatSeconds } from '../format'
import { FPS_PRESETS, SPEED_PRESETS } from '../presets'
import { useConfirmKey, useInitialFocus } from '../hooks'
import { setDocopsPrefs, useDocopsPrefs, useSpeed } from '../store'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const text = <div className="w-fit text-xs text-fg-muted">{label}</div>
  return (
    <div className="flex flex-col gap-1.5">
      {hint ? (
        <Tooltip content={hint} side="top" align="start">
          {text}
        </Tooltip>
      ) : (
        text
      )}
      {children}
    </div>
  )
}

function Chips<V extends number>({
  values,
  current,
  format,
  onPick,
}: {
  values: readonly V[]
  current: number
  format: (v: V) => string
  onPick: (v: V) => void
}) {
  return (
    <div className="-ml-1.5 flex flex-wrap gap-0.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className={cn(
            'h-5 rounded-sm px-1.5 text-xs tabular-nums transition-colors duration-100',
            Math.abs(v - current) < 1e-6
              ? 'bg-accent-subtle text-accent-text'
              : 'text-fg-muted hover:bg-hover hover:text-fg',
          )}
        >
          {format(v)}
        </button>
      ))}
    </div>
  )
}

/** "Speed & frame rate…": the timing controls staged in a dialog, with before → after. */
export function TimingDialog({ close }: DialogComponentProps) {
  const doc = useDocument((s) => s.doc)
  return doc ? <TimingDialogBody doc={doc} close={close} /> : null
}

function TimingDialogBody({ doc, close }: { doc: Animation; close: () => void }) {
  const t = useT()
  const speed0 = useSpeed()
  const [fps, setFps] = useState(doc.fr)
  const [keep, setKeep] = useState(() => useDocopsPrefs.getState().keepDuration)
  // Speed change on top of what the frame rate change does by itself.
  const [relative, setRelative] = useState(1)
  const { ref: fields, onOpenAutoFocus } = useInitialFocus<HTMLDivElement>()

  const frames0 = doc.op - doc.ip
  const seconds0 = frames0 / doc.fr
  const plan = planTiming(doc, fps, keep, relative)
  const baseFrames = plan.base.op - plan.base.ip
  const frames = plan.frames
  const seconds = frames / fps
  const speed = speed0 * plan.speedFactor
  const fpsChanged = Math.abs(fps - doc.fr) > 1e-9
  const changed = fpsChanged || frames !== baseFrames

  // Without "Keep duration" the frame rate change alone plays the frames faster or slower.
  const fpsFactor = keep ? 1 : fps / doc.fr
  const setSpeedValue = (value: number) => {
    if (value > 0 && speed0 > 0) setRelative(value / speed0 / fpsFactor)
  }
  const setSeconds = (value: number) => {
    if (value > 0) setRelative(baseFrames / (value * fps))
  }

  const apply = () => {
    if (!changed) return
    setDocopsPrefs({ keepDuration: keep })
    if (applyTiming(fps, keep, relative)) close()
  }
  useConfirmKey(fields, apply, true)

  const rows: { label: string; before: string; after: string; changed: boolean }[] = [
    {
      label: t.docops.timing.duration,
      before: formatSeconds(t, seconds0),
      after: formatSeconds(t, seconds),
      changed: Math.abs(seconds - seconds0) > 1e-6,
    },
    {
      label: t.docops.dialogs.frames,
      before: formatDecimal(frames0, 2),
      after: formatDecimal(frames, 2),
      changed: frames !== frames0,
    },
    {
      label: t.docops.timing.frameRate,
      before: formatFps(t, doc.fr),
      after: formatFps(t, fps),
      changed: fpsChanged,
    },
    {
      label: t.docops.timing.speed,
      before: formatPercent(speed0),
      after: formatPercent(speed),
      changed: Math.abs(speed - speed0) > 1e-6,
    },
  ]

  return (
    <Dialog
      open
      onOpenAutoFocus={onOpenAutoFocus}
      onOpenChange={(open) => !open && close()}
      title={t.docops.dialogs.timingTitle}
      description={t.docops.dialogs.timingDescription}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Tooltip content={t.common.apply} shortcut="mod+enter">
            <Button
              variant="primary"
              disabled={!changed}
              onClick={apply}
              data-testid="docops-timing-apply"
            >
              {t.common.apply}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div ref={fields} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.docops.timing.speed} hint={t.docops.timing.speedHint}>
            <NumberField
              value={roundTo(speed * 100, 2)}
              min={1}
              max={10000}
              step={5}
              precision={1}
              suffix="%"
              size="md"
              onChange={(v) => setSpeedValue(v / 100)}
              aria-label={t.docops.timing.speed}
            />
          </Field>
          <Field label={t.docops.timing.duration} hint={t.docops.timing.durationHint}>
            <NumberField
              value={roundTo(seconds, 3)}
              min={0.01}
              max={3600}
              step={0.1}
              precision={2}
              scrubSpeed={0.01}
              suffix={t.common.secondsShort}
              size="md"
              onChange={setSeconds}
              aria-label={t.docops.timing.duration}
            />
          </Field>
        </div>
        <Chips
          values={SPEED_PRESETS}
          current={roundTo(speed, 4)}
          format={(v) => formatPercent(v)}
          onPick={setSpeedValue}
        />

        <Field label={t.docops.timing.frameRate} hint={t.docops.timing.frameRateHint}>
          <div className="flex items-center gap-3">
            <NumberField
              value={fps}
              min={1}
              max={240}
              step={1}
              precision={2}
              suffix={t.common.fps}
              size="md"
              onChange={(v) => setFps(roundTo(v, 3))}
              aria-label={t.docops.timing.frameRate}
              className="w-28"
            />
            <Tooltip content={t.docops.timing.keepDurationHint} side="top">
              <label className="flex cursor-default items-center gap-2 text-sm text-fg">
                <Checkbox checked={keep} onCheckedChange={setKeep} />
                {t.docops.timing.keepDuration}
              </label>
            </Tooltip>
          </div>
          <Chips
            values={FPS_PRESETS}
            current={fps}
            format={(v) => formatFps(t, v)}
            onPick={setFps}
          />
        </Field>

        <div className="rounded-md bg-surface-2 px-3 py-2" data-testid="docops-timing-summary">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_16px_auto] items-center gap-x-2 gap-y-1 text-sm tabular-nums">
            <span />
            <span className="text-right text-xs text-fg-subtle">{t.docops.dialogs.before}</span>
            <span />
            <span className="text-right text-xs text-fg-subtle">{t.docops.dialogs.after}</span>
            {rows.map((r) => (
              <Row key={r.label} {...r} />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function Row({
  label,
  before,
  after,
  changed,
}: {
  label: string
  before: string
  after: string
  changed: boolean
}) {
  return (
    <>
      <span className="truncate text-xs text-fg-muted">{label}</span>
      <span className="text-right text-fg-subtle">{before}</span>
      <span className={cn('text-center text-xs', changed ? 'text-fg-subtle' : 'text-fg-faint')}>
        →
      </span>
      <span className={cn('text-right', changed ? 'font-medium text-fg' : 'text-fg-subtle')}>
        {after}
      </span>
    </>
  )
}
