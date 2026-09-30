/**
 * Building blocks of the export options: labelled rows, notes, and the controls shared by
 * several formats (size, frame rate, range, background).
 */
import { CircleAlert, Info, Link2, Link2Off, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  ColorField,
  FieldRow,
  IconButton,
  SegmentedControl,
  Select,
  Tooltip,
  type SelectOption,
} from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import {
  presetScale,
  lastFrameOf,
  type FrameRange,
  type RangeMode,
  type ResolvedSize,
  type SizePreset,
} from '@/export/plan'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { hexToRgba, rgbaToHex } from '@/lib/color'
import type { Animation } from '@/lottie/types'
import { useFormatter } from '../format'
import type { BackgroundMode, FpsChoice, SizeOptions } from '../store'

/* -------------------------------------------------------------------------- */
/*                                   Layout                                   */
/* -------------------------------------------------------------------------- */

/** Label + control row of the options column (wide label column for longer translations). */
export function OptionRow({
  label,
  hint,
  children,
  className,
  align = 'center',
}: {
  label: ReactNode
  hint?: string
  children: ReactNode
  className?: string
  align?: 'center' | 'start'
}) {
  return (
    <FieldRow
      label={label}
      hint={hint}
      className={cn(
        'min-h-7 grid-cols-[112px_minmax(0,1fr)] gap-3',
        align === 'start' && 'items-start',
        className,
      )}
      labelClassName={cn('text-fg-muted', align === 'start' && 'pt-1.5')}
    >
      {children}
    </FieldRow>
  )
}

/** Vertical stack of option rows with consistent spacing. */
export function OptionStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2.5', className)}>{children}</div>
}

/** Thin separator between groups of options. */
export function OptionDivider() {
  return <div className="my-1 h-px bg-line" />
}

/** Small section title inside the options column. */
export function OptionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between gap-2">
      <div className="text-xs font-semibold text-fg">{children}</div>
      {action}
    </div>
  )
}

export type NoteTone = 'info' | 'warning' | 'danger'

/** Quiet inline note: constraints, consequences, what happens on export. */
export function Note({
  tone = 'info',
  children,
  className,
}: {
  tone?: NoteTone
  children: ReactNode
  className?: string
}) {
  const Icon = tone === 'info' ? Info : tone === 'warning' ? TriangleAlert : CircleAlert
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 text-xs',
        tone === 'info' && 'text-fg-subtle',
        tone === 'warning' && 'text-warning',
        tone === 'danger' && 'text-danger',
        className,
      )}
    >
      <Icon size={12} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 text-pretty">{children}</div>
    </div>
  )
}

/** Note aligned under the control column of an OptionRow. */
export function RowNote(props: { tone?: NoteTone; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
      <div />
      <Note {...props} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Controls                                 */
/* -------------------------------------------------------------------------- */

/** Solid color input bound to a hex string (no alpha: backgrounds are opaque). */
export function HexColorField({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (hex: string) => void
  className?: string
}) {
  const rgba = hexToRgba(value) ?? { r: 1, g: 1, b: 1, a: 1 }
  return (
    <ColorField
      value={rgba}
      alpha={false}
      size="md"
      className={cn('w-[124px]', className)}
      swatches={['#ffffff', '#000000', '#111214', '#f4f5f7']}
      onChange={(c) => onChange(rgbaToHex({ ...c, a: 1 }))}
    />
  )
}

interface SizeFieldProps {
  presets: SizePreset[]
  value: SizeOptions
  doc: Pick<Animation, 'w' | 'h'>
  resolved: ResolvedSize
  onChange: (patch: Partial<SizeOptions>) => void
}

/** Size preset select; "Custom" reveals width and height with an aspect lock. */
export function SizeField({ presets, value, doc, resolved, onChange }: SizeFieldProps) {
  const t = useT()
  const preset = presets.includes(value.preset) ? value.preset : '1x'
  const options: SelectOption<SizePreset>[] = presets.map((p) => {
    const scale = presetScale(p, doc.w, doc.h)
    const hint =
      p === 'custom'
        ? undefined
        : t.export.summary.size(
            Math.max(1, Math.round(doc.w * (scale ?? 1))),
            Math.max(1, Math.round(doc.h * (scale ?? 1))),
          )
    return { value: p, label: t.export.sizes[p], hint }
  })
  const aspect = doc.w > 0 && doc.h > 0 ? doc.w / doc.h : 1
  const setCustom = (axis: 'w' | 'h', v: number) => {
    const n = Math.max(1, Math.round(v))
    if (!value.keepAspect) {
      onChange(axis === 'w' ? { width: n } : { height: n })
      return
    }
    onChange(
      axis === 'w'
        ? { width: n, height: Math.max(1, Math.round(n / aspect)) }
        : { height: n, width: Math.max(1, Math.round(n * aspect)) },
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select<SizePreset>
          value={preset}
          options={options}
          size="md"
          className="w-[108px] shrink-0"
          aria-label={t.export.fields.size}
          onValueChange={(p) => {
            if (p === 'custom' && value.preset !== 'custom') {
              // Start from the size the previous preset produced.
              onChange({ preset: p, width: resolved.width, height: resolved.height })
            } else onChange({ preset: p })
          }}
        />
        {preset !== 'custom' && (
          <span className="truncate text-sm text-fg-muted tabular-nums">
            {t.export.summary.size(resolved.width, resolved.height)}
          </span>
        )}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <NumberField
            label={t.export.fields.widthShort}
            labelTooltip={t.common.width}
            value={value.width}
            min={1}
            max={8192}
            precision={0}
            size="md"
            className="w-[92px]"
            onChange={(v) => setCustom('w', v)}
          />
          <IconButton
            icon={value.keepAspect ? Link2 : Link2Off}
            label={t.export.keepAspect}
            active={value.keepAspect}
            onClick={() =>
              onChange({
                keepAspect: !value.keepAspect,
                height: !value.keepAspect
                  ? Math.max(1, Math.round(value.width / aspect))
                  : value.height,
              })
            }
          />
          <NumberField
            label={t.export.fields.heightShort}
            labelTooltip={t.common.height}
            value={value.height}
            min={1}
            max={8192}
            precision={0}
            size="md"
            className="w-[92px]"
            onChange={(v) => setCustom('h', v)}
          />
          <span className="text-xs text-fg-faint">{t.common.pixelsShort}</span>
        </div>
      )}
      {preset === 'custom' &&
        Math.abs(resolved.width / resolved.height - aspect) > aspect * 0.01 && (
          <Note>{t.export.letterbox}</Note>
        )}
    </div>
  )
}

/** Frame rate select: the animation's own rate first, then common rates (no duplicates). */
export function FpsField({
  choices,
  value,
  docFps,
  onChange,
}: {
  choices: FpsChoice[]
  value: FpsChoice
  docFps: number
  onChange: (fps: FpsChoice) => void
}) {
  const t = useT()
  const fmt = useFormatter()
  const source = fmt.decimal(docFps)
  const options: SelectOption<FpsChoice>[] = choices
    .filter((c) => c === 'source' || Math.abs(Number(c) - docFps) > 1e-6)
    .map((c) => ({
      value: c,
      label: t.export.fps(c === 'source' ? source : c),
      hint: c === 'source' ? t.export.fpsSource : undefined,
    }))
  const current =
    choices.includes(value) && (value === 'source' || Math.abs(Number(value) - docFps) > 1e-6)
      ? value
      : 'source'
  return (
    <Select<FpsChoice>
      value={current}
      options={options}
      size="md"
      className="w-[148px]"
      aria-label={t.export.fields.frameRate}
      onValueChange={onChange}
    />
  )
}

/** Whole animation / work area, with the frames and seconds it covers. */
export function RangeField({
  value,
  onChange,
  hasWorkArea,
  range,
  fps,
}: {
  value: RangeMode
  onChange: (mode: RangeMode) => void
  hasWorkArea: boolean
  range: FrameRange
  fps: number
}) {
  const t = useT()
  const seconds = useFormatter().decimal((range.end - range.start) / (fps || 30))
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Tooltip content={hasWorkArea ? undefined : t.export.rangeNoWorkArea} side="top">
        <div className="w-fit">
          <SegmentedControl<RangeMode>
            value={hasWorkArea ? value : 'all'}
            onValueChange={onChange}
            size="md"
            aria-label={t.export.fields.range}
            options={[
              { value: 'all', label: t.export.rangeAll },
              { value: 'workArea', label: t.export.rangeWorkArea, disabled: !hasWorkArea },
            ]}
          />
        </div>
      </Tooltip>
      <span className="text-xs text-fg-subtle tabular-nums">
        {t.export.summary.frames(Math.round(range.start), lastFrameOf(range))} ·{' '}
        {t.export.summary.seconds(seconds)}
      </span>
    </div>
  )
}

/**
 * Background rows: transparent / color, and the color itself on its own row (so long
 * translations never wrap the control).
 */
export function BackgroundRows({
  mode,
  color,
  onMode,
  onColor,
}: {
  mode: BackgroundMode
  color: string
  onMode: (mode: BackgroundMode) => void
  onColor: (hex: string) => void
}) {
  const t = useT()
  return (
    <>
      <OptionRow label={t.export.fields.background}>
        <SegmentedControl<BackgroundMode>
          value={mode}
          onValueChange={onMode}
          size="md"
          aria-label={t.export.fields.background}
          options={[
            { value: 'transparent', label: t.export.bgTransparent },
            { value: 'color', label: t.export.bgColor },
          ]}
        />
      </OptionRow>
      {mode === 'color' && (
        <OptionRow label={t.export.bgColor}>
          <HexColorField value={color} onChange={onColor} />
        </OptionRow>
      )}
    </>
  )
}

/** Labelled switch row used inside option rows (label on the right of the switch). */
export function SwitchLabel({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="min-w-0 cursor-default truncate text-sm text-fg">
      {children}
    </label>
  )
}
