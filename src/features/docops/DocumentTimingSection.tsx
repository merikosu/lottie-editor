import { ChevronDown, Gauge, Scissors, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  FieldRow,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Section,
  Tooltip,
  type ChangeGesture,
} from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { useT } from '@/i18n'
import { roundTo } from '@/lib/math'
import { useDocument } from '@/store/document'
import { usePlayback } from '@/store/playback'
import { openDialog } from '@/store/ui'
import {
  addPause,
  applyDuration,
  applyFrameRate,
  applyInPoint,
  applyOutPoint,
  applySpeed,
  bakePingPong,
  reverse,
  trimRangeOf,
  trimToWorkArea,
  type ActionOptions,
} from './actions'
import { PauseForm } from './components/PauseForm'
import { PresetMenu } from './components/PresetMenu'
import { ResultNote } from './components/ResultNote'
import { expressionCount } from './expressions'
import { formatFps, formatPercent } from './format'
import { useConfirmKey } from './hooks'
import { FPS_PRESETS, SPEED_PRESETS } from './presets'
import { setDocopsPrefs, useDocopsPrefs, useSpeed } from './store'

type LiveField = 'fps' | 'duration' | 'speed' | 'in' | 'out'

/** Inspector section (nothing selected): frame rate, speed ⇄ duration, in/out points, loop tools. */
export function DocumentTimingSection() {
  const t = useT()
  const hasDoc = useDocument((s) => s.doc !== null)
  const fr = useDocument((s) => s.doc?.fr ?? 30)
  const ip = useDocument((s) => s.doc?.ip ?? 0)
  const op = useDocument((s) => s.doc?.op ?? 1)
  const expressions = useDocument((s) => (s.doc ? expressionCount(s.doc) : 0))
  const workArea = usePlayback((s) => s.workArea)
  const speed = useSpeed()
  const keepDuration = useDocopsPrefs((s) => s.keepDuration)
  // Value shown while a field is being scrubbed; applied once, on release.
  const [live, setLive] = useState<{ field: LiveField; value: number } | null>(null)

  if (!hasDoc) return null

  const seconds = fr > 0 ? (op - ip) / fr : 0
  const shown = (field: LiveField, value: number) => (live?.field === field ? live.value : value)
  // Retiming the whole document on every scrub step would be slow and noisy: preview the value
  // in the field and apply it on release. Arrow-key nudges share their gesture key, so a burst
  // of nudges is one undo step.
  const commitOnRelease =
    (field: LiveField, apply: (value: number, opts: ActionOptions) => void) =>
    (value: number, gesture: ChangeGesture) => {
      if (!gesture.final) {
        setLive({ field, value })
        return
      }
      setLive(null)
      apply(value, { coalesceKey: gesture.key, final: gesture.final })
    }
  const trim = trimRangeOf({ ip, op }, workArea)

  return (
    <Section
      id="docops.timing"
      title={t.docops.timing.title}
      actions={
        <IconButton
          icon={Gauge}
          label={t.docops.commands.timing}
          onClick={() => openDialog('timing')}
        />
      }
    >
      <div className="flex flex-col gap-1.5" data-testid="docops-timing">
        <FieldRow label={t.docops.timing.frameRateShort} hint={t.docops.timing.frameRateHint}>
          <NumberField
            value={shown('fps', fr)}
            min={1}
            max={240}
            step={1}
            precision={2}
            suffix={t.common.fps}
            onChange={commitOnRelease('fps', (v, opts) =>
              applyFrameRate(roundTo(v, 3), keepDuration, opts),
            )}
            aria-label={t.docops.timing.frameRate}
            className="flex-1"
          />
          <PresetMenu
            label={t.docops.timing.fpsPresets}
            icon={ChevronDown}
            options={FPS_PRESETS.map((f) => ({ value: String(f), label: formatFps(t, f) }))}
            value={String(fr)}
            onSelect={(v) => applyFrameRate(Number(v), keepDuration)}
          />
        </FieldRow>
        <FieldRow label="">
          <Tooltip content={t.docops.timing.keepDurationHint} side="left">
            <label className="flex min-h-5 cursor-default items-start gap-2 py-0.5 text-xs text-fg-muted">
              <Checkbox
                checked={keepDuration}
                onCheckedChange={(v) => setDocopsPrefs({ keepDuration: v })}
                className="mt-px"
              />
              <span className="min-w-0">{t.docops.timing.keepDuration}</span>
            </label>
          </Tooltip>
        </FieldRow>

        <FieldRow label={t.docops.timing.duration} hint={t.docops.timing.durationHint}>
          <NumberField
            value={shown('duration', seconds)}
            min={0.01}
            max={3600}
            step={0.1}
            precision={2}
            scrubSpeed={0.01}
            suffix={t.common.secondsShort}
            onChange={commitOnRelease('duration', applyDuration)}
            aria-label={t.docops.timing.duration}
            className="flex-1"
          />
          {/* Keeps the field aligned with its neighbours' preset buttons. */}
          <span className="size-6 shrink-0" aria-hidden />
        </FieldRow>

        <FieldRow label={t.docops.timing.speed} hint={t.docops.timing.speedHint}>
          <NumberField
            value={shown('speed', roundTo(speed * 100, 2))}
            min={1}
            max={10000}
            step={5}
            precision={1}
            suffix="%"
            onChange={commitOnRelease('speed', (v, opts) => applySpeed(v / 100, opts))}
            aria-label={t.docops.timing.speed}
            className="flex-1"
          />
          <PresetMenu
            label={t.docops.timing.speedPresets}
            icon={ChevronDown}
            options={SPEED_PRESETS.map((s) => ({
              value: String(s),
              label: formatPercent(s),
              hint: `${s}×`,
            }))}
            value={SPEED_PRESETS.find((s) => Math.abs(s - speed) < 1e-3)?.toString()}
            onSelect={(v) => applySpeed(Number(v))}
          />
        </FieldRow>

        <FieldRow label={t.docops.timing.range}>
          <NumberField
            value={shown('in', ip)}
            step={1}
            precision={0}
            max={op - 1}
            suffix={t.common.framesShort}
            aria-label={t.docops.timing.inPoint}
            onChange={commitOnRelease('in', applyInPoint)}
            className="min-w-0 flex-1"
          />
          <NumberField
            value={shown('out', op)}
            step={1}
            precision={0}
            min={ip + 1}
            suffix={t.common.framesShort}
            aria-label={t.docops.timing.outPoint}
            onChange={commitOnRelease('out', applyOutPoint)}
            className="min-w-0 flex-1"
          />
          {trim ? (
            <IconButton
              icon={Scissors}
              label={t.docops.timing.trimHint(trim.start, trim.end)}
              shortcut="mod+shift+x"
              onClick={trimToWorkArea}
              data-testid="docops-trim"
            />
          ) : (
            // Disabled buttons get no pointer events: the wrapper keeps the explanation reachable.
            <Tooltip content={t.docops.timing.trimDisabled} side="bottom">
              <span className="inline-flex shrink-0" tabIndex={-1}>
                <IconButton
                  icon={Scissors}
                  label={t.docops.timing.trim}
                  tooltip={false}
                  disabled
                  data-testid="docops-trim"
                />
              </span>
            </Tooltip>
          )}
        </FieldRow>

        <div className="mt-1 grid grid-cols-3 gap-1">
          <Tooltip content={t.docops.timing.reverseHint}>
            <Button
              size="sm"
              variant="secondary"
              onClick={reverse}
              className="min-w-0 px-1"
              data-testid="docops-reverse"
            >
              {t.docops.timing.reverse}
            </Button>
          </Tooltip>
          <Tooltip content={t.docops.timing.pingPongHint}>
            <Button
              size="sm"
              variant="secondary"
              onClick={bakePingPong}
              className="min-w-0 px-1"
              data-testid="docops-pingpong"
            >
              {t.docops.timing.pingPong}
            </Button>
          </Tooltip>
          <PausePopover />
        </div>

        {expressions > 0 && (
          <Tooltip content={t.docops.timing.expressionsHint} side="left">
            <div className="flex items-start gap-1.5 text-xs text-fg-muted">
              <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" />
              <span className="min-w-0">{t.docops.timing.expressions(expressions)}</span>
            </div>
          </Tooltip>
        )}
        <ResultNote scope="timing" fallback={t.docops.timing.note} />
      </div>
    </Section>
  )
}

/** "Pause…" button with the pause length popover (Enter adds the pause). */
function PausePopover() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  // Closed with the mouse: focus is not sent back to the trigger, whose tooltip would then
  // cover the result line (keyboard users keep their place on the trigger).
  const closedByPointer = useRef(false)
  const apply = (byPointer: boolean) => {
    if (!addPause(useDocopsPrefs.getState().pauseSeconds)) return
    closedByPointer.current = byPointer
    setOpen(false)
  }
  useConfirmKey(content, () => apply(false))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={t.docops.timing.pauseHint}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="secondary" className="min-w-0 px-1" data-testid="docops-pause">
            {t.docops.timing.pause}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-72"
        onCloseAutoFocus={(e) => {
          if (closedByPointer.current) e.preventDefault()
          closedByPointer.current = false
        }}
      >
        <div ref={content} className="flex flex-col gap-3">
          <div>
            <div className="text-sm font-semibold text-fg">{t.docops.pause.title}</div>
            <div className="mt-0.5 text-xs text-fg-subtle">{t.docops.pause.description}</div>
          </div>
          <PauseForm />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              onClick={(e) => apply(e.detail > 0)}
              data-testid="docops-pause-add"
            >
              {t.docops.pause.add}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
