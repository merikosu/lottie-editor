/**
 * Optimization settings: a preset, then every technique with its parameters, grouped by what
 * they may change. The same panel edits the settings for all files (queue toolbar) and one
 * file's own settings (detail view); changes re-run the affected files after a short pause.
 */
import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  Button,
  Checkbox,
  IconButton,
  NumberField,
  Select,
  Slider,
  Switch,
  Tooltip,
} from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type {
  ImageFormat,
  NameScope,
  OptimizeOptions,
  PresetId,
  TechniqueId,
} from '@/lottie/optimizer'
import {
  presetOf,
  presetOptions,
  setOptimizerSettings,
  useOptimizerSettings,
} from '../../model/settings'
import { setJobOptions } from '../../model/store'
import { optionsKey } from '../../model/summary'
import { useJob } from '../hooks'
import { PresetControl } from '../common'

type Scope = { scope: 'queue' } | { scope: 'file'; jobId: string }

type Patch = (o: OptimizeOptions) => OptimizeOptions

const setTechnique =
  (id: TechniqueId, on: boolean): Patch =>
  (o) => ({ ...o, techniques: { ...o.techniques, [id]: on } })

/** Keyframe share of the tolerance, as offered (engine value: a multiple of half the budget). */
const KEYFRAME_SHARES = [0, 0.5, 1, 1.5, 2] as const
const MAX_SCALES = [0, 1, 1.5, 2, 3] as const

/** Keyframe share as a percentage of the tolerance (1 = half of it). */
const sharePercent = (v: number) => `${Math.round(v * 50)}%`

function updateQueueOptions(patch: Patch): void {
  setOptimizerSettings({ options: patch(useOptimizerSettings.getState().options) })
}

function GroupTitle({ children, lossy }: { children: ReactNode; lossy?: boolean }) {
  const t = useT()
  return (
    <div className="mt-2 flex h-7 items-center gap-2">
      <span className="text-xs font-semibold text-fg">{children}</span>
      {lossy && (
        <span className="rounded-xs px-1 text-2xs text-warning shadow-[inset_0_0_0_1px_var(--le-warning-subtle)]">
          {t.optimizer.settings.lossy}
        </span>
      )}
    </div>
  )
}

/** A label with the technique's explanation in a tooltip, and a switch. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
  testId?: string
}) {
  const text = <span className="min-w-0 truncate text-sm text-fg-muted">{label}</span>
  return (
    <label className={cn('flex h-7 items-center justify-between gap-3', disabled && 'opacity-40')}>
      {hint ? (
        <Tooltip content={hint} side="left">
          {text}
        </Tooltip>
      ) : (
        text
      )}
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={label}
        data-testid={testId}
      />
    </label>
  )
}

/**
 * A parameter row: indented under its technique, or (`group`) a parameter of the whole group,
 * aligned with the techniques.
 */
function ParamRow({
  label,
  hint,
  group,
  children,
}: {
  label: string
  hint?: string
  group?: boolean
  children: ReactNode
}) {
  const text = (
    <span
      className={cn('min-w-0 truncate', group ? 'text-sm text-fg-muted' : 'text-xs text-fg-subtle')}
    >
      {label}
    </span>
  )
  return (
    <div
      className={cn(
        'grid h-7 grid-cols-[minmax(0,1fr)_minmax(0,148px)] items-center gap-3',
        !group && 'pl-3',
      )}
    >
      {hint ? (
        <Tooltip content={hint} side="left">
          {text}
        </Tooltip>
      ) : (
        text
      )}
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  )
}

const STRUCTURE: TechniqueId[] = [
  'hidden',
  'invisible',
  'empty',
  'unusedAssets',
  'dedupeAssets',
  'staticize',
  'defaults',
  'legacy',
]

function Techniques({
  options,
  update,
  images,
}: {
  options: OptimizeOptions
  update: (patch: Patch) => void
  /** Embedded images in the file (null: settings for all files). */
  images: number | null
}) {
  const t = useT()
  const T = t.optimizer.techniques
  const S = t.optimizer.settings
  const on = options.techniques
  const toggle = (id: TechniqueId) => (value: boolean) => update(setTechnique(id, value))
  const noImages = images === 0
  return (
    <div className="flex flex-col">
      <GroupTitle>{S.geometry}</GroupTitle>
      <ParamRow label={S.tolerance} hint={S.toleranceHint} group>
        <NumberField
          value={options.pxTolerance}
          onChange={(v) => update((o) => ({ ...o, pxTolerance: v }))}
          min={0}
          max={2}
          step={0.01}
          precision={3}
          suffix="px"
          className="w-[84px]"
          aria-label={S.tolerance}
        />
      </ParamRow>
      <ToggleRow
        label={T.precision.name}
        hint={T.precision.about}
        checked={on.precision}
        onChange={toggle('precision')}
      />
      <ToggleRow
        label={T.keyframes.name}
        hint={T.keyframes.about}
        checked={on.keyframes}
        onChange={toggle('keyframes')}
      />
      {on.keyframes && (
        <ParamRow label={S.keyframeShare} hint={S.keyframeShareHint}>
          <Select<string>
            value={String(nearest(KEYFRAME_SHARES, options.keyframeTolerance))}
            onValueChange={(v) => update((o) => ({ ...o, keyframeTolerance: Number(v) }))}
            options={KEYFRAME_SHARES.map((v) => ({ value: String(v), label: sharePercent(v) }))}
            aria-label={S.keyframeShare}
            className="w-[84px]"
          />
        </ParamRow>
      )}
      <ToggleRow
        label={T.paths.name}
        hint={T.paths.about}
        checked={on.paths}
        onChange={toggle('paths')}
      />
      {on.paths && (
        <label className="flex h-7 items-center gap-2 pl-3 text-xs text-fg-subtle">
          <Checkbox
            checked={options.pathSimplify}
            onCheckedChange={(v) => update((o) => ({ ...o, pathSimplify: v }))}
          />
          <span className="truncate">{S.simplifyPaths}</span>
        </label>
      )}

      <GroupTitle>{S.structure}</GroupTitle>
      {STRUCTURE.map((id) => (
        <ToggleRow
          key={id}
          label={T[id].name}
          hint={T[id].about}
          checked={on[id]}
          onChange={toggle(id)}
        />
      ))}

      <GroupTitle lossy>{S.names}</GroupTitle>
      <ToggleRow
        label={T.names.name}
        hint={T.names.about}
        checked={on.names}
        onChange={toggle('names')}
      />
      {on.names && (
        <>
          <ParamRow label={S.nameScope}>
            <Select<NameScope>
              value={options.names.scope}
              onValueChange={(scope) => update((o) => ({ ...o, names: { ...o.names, scope } }))}
              options={(['shapes', 'exceptLayers', 'all'] as const).map((v) => ({
                value: v,
                label: S.nameScopes[v],
              }))}
              aria-label={S.nameScope}
            />
          </ParamRow>
          <label className="flex h-7 items-center gap-2 pl-3 text-xs text-fg-subtle">
            <Checkbox
              checked={options.names.classes}
              onCheckedChange={(classes) =>
                update((o) => ({ ...o, names: { ...o.names, classes } }))
              }
            />
            <span className="truncate">{S.classes}</span>
          </label>
        </>
      )}

      <GroupTitle lossy>{S.images}</GroupTitle>
      <ToggleRow
        label={T.images.name}
        hint={noImages ? S.noImages : T.images.about}
        checked={on.images}
        onChange={toggle('images')}
      />
      {on.images && (
        <div className={cn('flex flex-col', noImages && 'opacity-50')}>
          <ParamRow label={S.format}>
            <Select<ImageFormat>
              value={options.image.format}
              onValueChange={(format) => update((o) => ({ ...o, image: { ...o.image, format } }))}
              options={(['auto', 'webp', 'jpeg', 'png'] as const).map((v) => ({
                value: v,
                label: S.formats[v],
              }))}
              aria-label={S.format}
            />
          </ParamRow>
          <ParamRow label={S.quality}>
            <div className="flex w-full items-center gap-2">
              <Slider
                value={Math.round(options.image.quality * 100)}
                min={5}
                max={100}
                step={5}
                onChange={(v) => update((o) => ({ ...o, image: { ...o.image, quality: v / 100 } }))}
                aria-label={S.quality}
              />
              <span className="w-8 shrink-0 text-right text-xs text-fg-muted tabular-nums">
                {Math.round(options.image.quality * 100)}%
              </span>
            </div>
          </ParamRow>
          <ParamRow label={S.maxScale} hint={S.maxScaleHint}>
            <Select<string>
              value={String(nearest(MAX_SCALES, options.image.maxScale))}
              onValueChange={(v) =>
                update((o) => ({ ...o, image: { ...o.image, maxScale: Number(v) } }))
              }
              options={MAX_SCALES.map((v) => ({
                value: String(v),
                label: v === 0 ? S.keepSize : `${v}×`,
              }))}
              aria-label={S.maxScale}
            />
          </ParamRow>
        </div>
      )}
    </div>
  )
}

function nearest(values: readonly number[], v: number): number {
  return values.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), values[0])
}

/** The guarantee and the frames setting (the same for every file). */
function Verification() {
  const t = useT()
  const S = t.optimizer.settings
  const guarantee = useOptimizerSettings((s) => s.guarantee)
  const frames = useOptimizerSettings((s) => s.verifyFrames)
  return (
    <div className="flex flex-col">
      <GroupTitle>{S.verification}</GroupTitle>
      <ToggleRow
        label={S.guarantee}
        hint={S.guaranteeHint}
        checked={guarantee}
        onChange={(v) => setOptimizerSettings({ guarantee: v })}
        testId="opt-guarantee"
      />
      <ToggleRow
        label={S.everyFrame}
        hint={S.everyFrameHint}
        checked={frames === 'all'}
        onChange={(v) => setOptimizerSettings({ verifyFrames: v ? 'all' : 'sampled' })}
      />
    </div>
  )
}

function PresetHeader({
  options,
  onPreset,
}: {
  options: OptimizeOptions
  onPreset: (id: PresetId) => void
}) {
  const t = useT()
  const preset = presetOf(options)
  return (
    <div className="flex flex-col gap-1.5">
      <PresetControl options={options} onPreset={onPreset} fill />
      <p className="min-h-8 text-xs text-fg-subtle">{t.optimizer.presets.about[preset]}</p>
    </div>
  )
}

function QueueSettings() {
  const t = useT()
  const options = useOptimizerSettings((s) => s.options)
  return (
    <div
      className="flex max-h-[min(640px,calc(100vh-120px))] flex-col overflow-y-auto px-3 pt-3 pb-2"
      data-testid="opt-settings-queue"
    >
      <p className="mb-2 text-xs text-fg-muted">{t.optimizer.settings.queueScope}</p>
      <PresetHeader
        options={options}
        onPreset={(id) => setOptimizerSettings({ options: presetOptions(id) })}
      />
      <Techniques options={options} update={updateQueueOptions} images={null} />
      <Verification />
    </div>
  )
}

function FileSettings({ jobId }: { jobId: string }) {
  const t = useT()
  const job = useJob(jobId)
  const queue = useOptimizerSettings((s) => s.options)
  if (!job) return null
  const own = job.options
  const options = own ?? queue
  const images = job.parts.reduce((n, p) => n + p.info.images, 0)
  // Settings equal to the queue's are not "own" settings: the file keeps following the queue.
  const set = (next: OptimizeOptions) =>
    setJobOptions(jobId, optionsKey(next) === optionsKey(queue) ? null : next)
  const update = (patch: Patch) => set(patch(own ?? queue))
  return (
    <div className="flex flex-col px-3 pt-3 pb-4" data-testid="opt-settings-file">
      <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-xs text-fg-muted">
          {own ? t.optimizer.settings.fileScope : t.optimizer.settings.followsQueue}
        </p>
        {own && (
          <div className="flex items-center gap-1">
            <IconButton
              icon={RotateCcw}
              label={t.optimizer.settings.reset}
              onClick={() => setJobOptions(jobId, null)}
              data-testid="opt-settings-reset"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setOptimizerSettings({ options: own })
                setJobOptions(jobId, null)
              }}
              data-testid="opt-settings-apply-all"
            >
              {t.optimizer.settings.applyToAll}
            </Button>
          </div>
        )}
      </div>
      <PresetHeader options={options} onPreset={(id) => set(presetOptions(id))} />
      <Techniques options={options} update={update} images={images} />
      <Verification />
    </div>
  )
}

export function SettingsPanel(props: Scope) {
  return props.scope === 'queue' ? <QueueSettings /> : <FileSettings jobId={props.jobId} />
}
