/** Small pieces shared by several option panels. */
import { useId, type ReactNode } from 'react'
import { Select, Switch, type SelectOption } from '@/components/ui'
import { missingImages } from '@/lottie/assets'
import type { Animation } from '@/lottie/types'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { RendererType } from '@/store/prefs'
import { setRendererChoice, type RendererChoice } from '../../store'
import { Note, OptionRow, RowNote } from '../fields'

/** Switch with its label on the right (the whole label toggles it). */
export function SwitchField({
  checked,
  onChange,
  children,
  disabled,
  muted,
  testId,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  disabled?: boolean
  /** The label is a quiet description rather than the setting's name. */
  muted?: boolean
  testId?: string
}) {
  const id = useId()
  return (
    <div className="flex min-w-0 items-center gap-2.5" data-testid={testId}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <label
        htmlFor={id}
        className={cn(
          'min-w-0 truncate',
          muted ? 'text-xs text-fg-subtle' : 'text-sm text-fg',
          disabled && 'text-fg-subtle',
        )}
      >
        {children}
      </label>
    </div>
  )
}

/** Renderer choice for raster exports (SVG matches the preview, Canvas is faster). */
export function RendererRow({
  value,
  viewRenderer,
  fontsWarning,
}: {
  value: RendererChoice
  viewRenderer: RendererType
  fontsWarning: boolean
}) {
  const t = useT()
  const options: SelectOption<RendererChoice>[] = [
    { value: 'auto', label: t.export.renderers.auto(t.export.renderers[viewRenderer]) },
    { value: 'svg', label: t.export.renderers.svg },
    { value: 'canvas', label: t.export.renderers.canvas },
  ]
  const effective = value === 'auto' ? viewRenderer : value
  return (
    <>
      <OptionRow label={t.export.fields.renderer} hint={t.export.rendererHint}>
        <Select<RendererChoice>
          value={value}
          options={options}
          size="md"
          className="w-[204px]"
          aria-label={t.export.fields.renderer}
          onValueChange={setRendererChoice}
        />
      </OptionRow>
      {fontsWarning && effective === 'svg' && (
        <RowNote tone="warning">{t.export.svgFontsNote}</RowNote>
      )}
    </>
  )
}

/** Notes about content the export cannot reproduce (missing images, expressions not run). */
export function ContentNotes({ doc, expressionsOff }: { doc: Animation; expressionsOff: boolean }) {
  const t = useT()
  const missing = missingImages(doc).length
  if (!missing && !expressionsOff) return null
  return (
    <div className="flex flex-col gap-1.5">
      {missing > 0 && <Note tone="warning">{t.export.missingImagesNote(missing)}</Note>}
      {expressionsOff && <Note>{t.export.expressionsNote}</Note>}
    </div>
  )
}

/** Label + value pair of the stats block. */
export function Stat({
  label,
  value,
  extra,
  testId,
}: {
  label: ReactNode
  value: ReactNode
  extra?: ReactNode
  testId?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId}>
      <span className="text-xs text-fg-subtle">{label}</span>
      <span className="flex items-baseline gap-1.5 text-base font-medium text-fg tabular-nums">
        {value}
        {extra && <span className="text-xs font-normal">{extra}</span>}
      </span>
    </div>
  )
}
