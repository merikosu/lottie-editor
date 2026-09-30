/** Options of the Lottie JSON and dotLottie exports. */
import { useMemo } from 'react'
import { SegmentedControl, Select, type SelectOption } from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import {
  embeddedImageCount,
  exportNeedsV2,
  includesThemes,
  resolveDotLottieVersion,
  type PrecisionOption,
} from '@/export/lottie-files'
import { useT } from '@/i18n'
import { useFormatter } from '../../format'
import { updateFormatPrefs } from '../../store'
import { Note, OptionDivider, OptionHeading, OptionRow, OptionStack, RowNote } from '../fields'
import { Stat, SwitchField } from './common'
import { StillRows } from './StillRows'
import type { PanelProps } from './types'

function PrecisionSelect({
  value,
  onChange,
}: {
  value: PrecisionOption
  onChange: (v: PrecisionOption) => void
}) {
  const t = useT()
  const options: SelectOption<PrecisionOption>[] = [
    { value: 'keep', label: t.export.json.keepDecimals },
    { value: '3', label: t.export.json.decimals(3) },
    { value: '2', label: t.export.json.decimals(2) },
    { value: '1', label: t.export.json.decimals(1) },
  ]
  return (
    <Select<PrecisionOption>
      value={value}
      options={options}
      size="md"
      className="w-[148px]"
      aria-label={t.export.fields.precision}
      onValueChange={onChange}
    />
  )
}

/** Precision + name stripping rows (Lottie JSON and Telegram). */
export function TransformRows({
  precision,
  stripNames,
  onChange,
}: {
  precision: PrecisionOption
  stripNames: boolean
  onChange: (patch: { precision?: PrecisionOption; stripNames?: boolean }) => void
}) {
  const t = useT()
  return (
    <>
      <OptionRow label={t.export.fields.precision}>
        <PrecisionSelect value={precision} onChange={(p) => onChange({ precision: p })} />
      </OptionRow>
      {precision !== 'keep' && <RowNote>{t.export.json.precisionHint}</RowNote>}
      <OptionRow label={t.export.fields.names}>
        <SwitchField
          checked={stripNames}
          onChange={(v) => onChange({ stripNames: v })}
          testId="export-strip-names"
        >
          {t.export.json.stripNames}
        </SwitchField>
      </OptionRow>
      {stripNames && <RowNote tone="warning">{t.export.json.stripNamesWarning}</RowNote>}
    </>
  )
}

export function JsonPanel(props: PanelProps) {
  const { doc, prefs, model } = props
  const t = useT()
  const fmt = useFormatter()
  const o = prefs.json
  const images = useMemo(() => embeddedImageCount(doc), [doc])
  const stats = model.json.value
  const change = stats ? stats.bytes / Math.max(1, stats.baseline) - 1 : 0
  return (
    <OptionStack>
      <StillRows {...props} />
      <OptionRow label={t.export.fields.formatting}>
        <SegmentedControl<'min' | 'pretty'>
          value={o.pretty ? 'pretty' : 'min'}
          onValueChange={(v) => updateFormatPrefs('json', { pretty: v === 'pretty' })}
          size="md"
          aria-label={t.export.fields.formatting}
          options={[
            { value: 'min', label: t.export.json.minified },
            { value: 'pretty', label: t.export.json.pretty },
          ]}
        />
      </OptionRow>
      <TransformRows
        precision={o.precision}
        stripNames={o.stripNames}
        onChange={(patch) => updateFormatPrefs('json', patch)}
      />
      {images > 0 && (
        <>
          <OptionRow label={t.export.fields.images}>
            <SegmentedControl<'embed' | 'files'>
              value={o.images}
              onValueChange={(mode) => updateFormatPrefs('json', { images: mode })}
              size="md"
              aria-label={t.export.fields.images}
              options={[
                { value: 'embed', label: t.export.json.imagesEmbedded },
                { value: 'files', label: t.export.json.imagesFiles },
              ]}
            />
          </OptionRow>
          {o.images === 'files' && <RowNote>{t.export.json.imagesFilesHint}</RowNote>}
        </>
      )}
      <OptionDivider />
      <div className="grid grid-cols-3 gap-4" aria-busy={model.json.pending}>
        <Stat
          label={t.export.fields.size}
          value={stats ? fmt.size(stats.bytes) : '—'}
          extra={
            stats && Math.abs(change) >= 0.005 ? (
              <span className={change < 0 ? 'text-success' : 'text-fg-subtle'}>
                {change < 0
                  ? t.export.json.savings(fmt.percent(-change))
                  : t.export.json.larger(fmt.percent(change))}
              </span>
            ) : undefined
          }
          testId="export-json-size"
        />
        <Stat
          label={t.export.fields.gzip}
          value={stats ? fmt.size(stats.gzip) : '—'}
          testId="export-json-gzip"
        />
      </div>
    </OptionStack>
  )
}

export function DotLottiePanel(props: PanelProps) {
  const { doc, prefs, model } = props
  const t = useT()
  const fmt = useFormatter()
  const o = prefs.dotlottie
  // Like the JSON options: the image choice only matters when the file has embedded images.
  const images = useMemo(() => embeddedImageCount(doc), [doc])
  const pkg = model.packageInfo
  const set = (patch: Partial<typeof o>) => updateFormatPrefs('dotlottie', patch)
  const blockV1 = exportNeedsV2(o, pkg)
  const autoVersion = resolveDotLottieVersion({ ...o, version: 'auto' }, pkg)
  const versionOptions: SelectOption<typeof o.version>[] = [
    { value: 'auto', label: t.export.dotlottie.auto(autoVersion) },
    {
      value: '1',
      label: t.export.dotlottie.v1,
      hint: t.export.dotlottie.v1Hint,
      disabled: blockV1,
    },
    { value: '2', label: t.export.dotlottie.v2, hint: t.export.dotlottie.v2Hint },
  ]
  const contents: string[] = []
  if (pkg) {
    if (pkg.otherAnimations)
      contents.push(t.export.dotlottie.packageAnimations(pkg.otherAnimations))
    if (pkg.stateMachines) contents.push(t.export.dotlottie.packageStateMachines(pkg.stateMachines))
  }
  const v2 = model.dotlottieVersion === 2
  return (
    <OptionStack>
      <StillRows {...props} />
      <OptionRow label={t.export.fields.version}>
        <Select<typeof o.version>
          value={blockV1 && o.version === '1' ? 'auto' : o.version}
          options={versionOptions}
          size="md"
          className="w-[180px]"
          contentClassName="min-w-[300px]"
          aria-label={t.export.fields.version}
          onValueChange={(version) => set({ version })}
        />
      </OptionRow>
      {blockV1 && (
        <RowNote>
          {o.includePackage && pkg?.needsV2WithoutThemes
            ? t.export.dotlottie.v2Required
            : t.themes.export.needsV2}
        </RowNote>
      )}
      {images > 0 && (
        <OptionRow label={t.export.fields.images}>
          <SwitchField
            checked={o.extractImages}
            onChange={(extractImages) => set({ extractImages })}
          >
            {t.export.dotlottie.imagesAsFiles}
          </SwitchField>
        </OptionRow>
      )}
      {contents.length > 0 && (
        <OptionRow label={t.export.fields.contents} align="start">
          <div className="flex min-w-0 flex-col gap-1">
            <SwitchField
              checked={o.includePackage}
              onChange={(includePackage) => set({ includePackage })}
            >
              {t.export.dotlottie.includePackage}
            </SwitchField>
            <span className="pl-9 text-xs text-fg-subtle">{contents.join(' · ')}</span>
          </div>
        </OptionRow>
      )}
      {pkg && pkg.themes > 0 && (
        <OptionRow label={t.themes.export.label} align="start">
          <div className="flex min-w-0 flex-col gap-1">
            <SwitchField
              checked={includesThemes(o)}
              onChange={(themes) => set({ themes })}
              testId="export-themes"
            >
              {t.themes.export.include}
            </SwitchField>
            <span className="truncate pl-9 text-xs text-fg-subtle">
              {(pkg.themeNames ?? []).join(' · ')}
            </span>
          </div>
        </OptionRow>
      )}
      <OptionDivider />
      <OptionHeading>{t.export.fields.player}</OptionHeading>
      <OptionRow label={t.export.fields.loop}>
        <SwitchField checked={o.loop} disabled={v2} onChange={(loop) => set({ loop })}>
          {t.export.playerLoop}
        </SwitchField>
      </OptionRow>
      <OptionRow label={t.export.fields.autoplay}>
        <SwitchField checked={o.autoplay} disabled={v2} onChange={(autoplay) => set({ autoplay })}>
          {t.export.playerAutoplay}
        </SwitchField>
      </OptionRow>
      <OptionRow label={t.export.fields.speed}>
        <NumberField
          value={Math.round(o.speed * 1000) / 10}
          min={10}
          max={1000}
          step={5}
          precision={1}
          suffix="%"
          size="md"
          disabled={v2}
          className="w-[92px]"
          aria-label={t.export.fields.speed}
          onChange={(percent) => set({ speed: percent / 100 })}
        />
      </OptionRow>
      <OptionRow label={t.export.fields.direction}>
        <SegmentedControl<'normal' | 'bounce'>
          value={o.bounce ? 'bounce' : 'normal'}
          onValueChange={(v) => set({ bounce: v === 'bounce' })}
          size="md"
          aria-label={t.export.fields.direction}
          options={[
            { value: 'normal', label: t.export.dotlottie.normal, disabled: v2 },
            { value: 'bounce', label: t.export.dotlottie.bounce, disabled: v2 },
          ]}
        />
      </OptionRow>
      <RowNote>{v2 ? t.export.dotlottie.playerV2Hint : t.export.dotlottie.playerHint}</RowNote>
      <OptionDivider />
      <div className="grid grid-cols-3 gap-4" aria-busy={model.dotlottie.pending}>
        <Stat
          label={t.export.fields.size}
          value={model.dotlottie.value !== undefined ? fmt.size(model.dotlottie.value) : '—'}
          testId="export-dotlottie-size"
        />
      </div>
      {model.dotlottie.error ? <Note tone="danger">{String(model.dotlottie.error)}</Note> : null}
    </OptionStack>
  )
}
