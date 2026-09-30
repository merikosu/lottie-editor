/** Options of the rendered formats: GIF, MP4, WebM and PNG sequences. */
import { Film } from 'lucide-react'
import { SegmentedControl, Select, Spinner, type SelectOption } from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { frameFileName } from '@/export/plan'
import { CODEC_NAMES, CODEC_PREFERENCE } from '@/export/video'
import { useT } from '@/i18n'
import { usePlayback } from '@/store/playback'
import { useFormatter } from '../../format'
import { FPS_CHOICES, SIZE_PRESETS, type RasterPlan } from '../../plan'
import { frameBaseName } from '../../run'
import { updateFormatPrefs, type GifPrefs, type VideoPrefs } from '../../store'
import {
  BackgroundRows,
  FpsField,
  HexColorField,
  Note,
  OptionDivider,
  OptionRow,
  OptionStack,
  RangeField,
  RowNote,
  SizeField,
} from '../fields'
import { ContentNotes, RendererRow, SwitchField } from './common'
import { usesWebFonts } from '../doc-info'
import type { PanelProps } from './types'

/** Size, frame rate and range rows shared by every rendered format. */
function TimingRows({
  format,
  plan,
  props,
}: {
  format: 'gif' | 'mp4' | 'webm' | 'png'
  plan: RasterPlan
  props: PanelProps
}) {
  const t = useT()
  const { doc, prefs } = props
  const p = prefs[format]
  const hasWorkArea = usePlayback((s) => s.workArea !== null)
  const video = format === 'mp4' || format === 'webm'
  return (
    <>
      <OptionRow label={t.export.fields.size} align="start">
        <SizeField
          presets={SIZE_PRESETS[format]}
          value={p.size}
          doc={doc}
          resolved={plan.size}
          onChange={(patch) => updateFormatPrefs(format, { size: { ...p.size, ...patch } })}
        />
      </OptionRow>
      {plan.size.adjusted && <RowNote>{video ? t.export.evenSize : t.export.sizeLimited}</RowNote>}
      <OptionRow label={t.export.fields.frameRate}>
        <FpsField
          choices={FPS_CHOICES[format]}
          value={p.fps}
          docFps={doc.fr}
          onChange={(fps) => updateFormatPrefs(format, { fps })}
        />
      </OptionRow>
      {plan.fpsCapped && <RowNote>{t.export.gifFpsCap}</RowNote>}
      <OptionRow label={t.export.fields.range} align="start">
        <RangeField
          value={p.range}
          hasWorkArea={hasWorkArea}
          range={plan.range}
          fps={plan.compFps}
          onChange={(range) => updateFormatPrefs(format, { range })}
        />
      </OptionRow>
    </>
  )
}

/* ------------------------------------------------------------------------- */
/*                                    GIF                                    */
/* ------------------------------------------------------------------------- */

const setGif = (patch: Partial<GifPrefs>) => updateFormatPrefs('gif', patch)

export function GifPanel(props: PanelProps) {
  const t = useT()
  const { prefs, model, doc } = props
  const g = prefs.gif
  const plan = model.raster!
  const set = setGif
  const colorOptions: SelectOption<GifPrefs['colors']>[] = (
    ['256', '128', '64', '32'] as const
  ).map((c) => ({ value: c, label: c }))
  return (
    <OptionStack>
      <TimingRows format="gif" plan={plan} props={props} />
      <OptionDivider />
      <BackgroundRows
        mode={g.background}
        color={g.color}
        onMode={(background) => set({ background })}
        onColor={(color) => set({ color })}
      />
      {g.background === 'transparent' && (
        <>
          <OptionRow label={t.export.fields.matte} hint={t.export.matteHint}>
            <HexColorField value={g.matte} onChange={(matte) => set({ matte })} />
          </OptionRow>
          <OptionRow label={t.export.fields.threshold} hint={t.export.thresholdHint}>
            <NumberField
              value={g.threshold}
              min={1}
              max={100}
              precision={0}
              suffix="%"
              size="md"
              className="w-[92px]"
              aria-label={t.export.fields.threshold}
              onChange={(threshold) => set({ threshold })}
            />
          </OptionRow>
          <RowNote tone="warning">{t.export.gifTransparencyNote}</RowNote>
        </>
      )}
      <OptionRow label={t.export.fields.colors}>
        <Select<GifPrefs['colors']>
          value={g.colors}
          options={colorOptions}
          size="md"
          className="w-[92px]"
          aria-label={t.export.fields.colors}
          onValueChange={(colors) => set({ colors })}
        />
      </OptionRow>
      <OptionRow label={t.export.fields.palette} hint={t.export.paletteHint}>
        <SegmentedControl<GifPrefs['palette']>
          value={g.palette}
          onValueChange={(palette) => set({ palette })}
          size="md"
          aria-label={t.export.fields.palette}
          options={[
            { value: 'global', label: t.export.paletteShared },
            { value: 'perFrame', label: t.export.palettePerFrame },
          ]}
        />
      </OptionRow>
      <OptionRow label={t.export.fields.dithering}>
        <SwitchField checked={g.dither} onChange={(dither) => set({ dither })} muted>
          {t.export.ditherHint}
        </SwitchField>
      </OptionRow>
      <OptionRow label={t.export.fields.loop} align={g.loop === 'count' ? 'start' : 'center'}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SegmentedControl<GifPrefs['loop']>
            value={g.loop}
            onValueChange={(loop) => set({ loop })}
            size="md"
            aria-label={t.export.fields.loop}
            options={[
              { value: 'forever', label: t.export.loopForever },
              { value: 'once', label: t.export.loopOnce },
              { value: 'count', label: t.export.loopCustom },
            ]}
          />
          {g.loop === 'count' && (
            <NumberField
              value={g.plays}
              min={2}
              max={100}
              precision={0}
              suffix={t.export.times(g.plays)}
              size="md"
              className="w-[84px]"
              aria-label={t.export.loopCustom}
              onChange={(plays) => set({ plays })}
            />
          )}
        </div>
      </OptionRow>
      <OptionDivider />
      <RendererRow
        value={prefs.renderer}
        viewRenderer={props.viewRenderer}
        fontsWarning={usesWebFonts(doc)}
      />
      <ContentNotes doc={doc} expressionsOff={props.expressionsOff} />
    </OptionStack>
  )
}

/* ------------------------------------------------------------------------- */
/*                                   Video                                   */
/* ------------------------------------------------------------------------- */

/** Shown instead of the options when the browser cannot encode the format. */
function Unsupported({
  format,
  reason,
  size,
}: {
  format: 'mp4' | 'webm'
  reason: string | null
  size: string
}) {
  const t = useT()
  const text =
    reason === 'no-webcodecs'
      ? t.export.unsupported.noWebCodecs
      : reason === 'no-codec'
        ? t.export.unsupported.noCodec(size)
        : t.export.unsupported.error
  return (
    <div
      className="flex flex-col items-start gap-1.5 rounded-md bg-surface-2 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--le-line)]"
      data-testid="export-unsupported"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <Film size={14} className="text-fg-subtle" aria-hidden />
        {t.export.unsupported.title(format === 'mp4' ? 'MP4' : 'WebM')}
      </div>
      <p className="text-xs text-fg-muted">{text}</p>
    </div>
  )
}

export function VideoPanel(props: PanelProps & { format: 'mp4' | 'webm' }) {
  const t = useT()
  const fmt = useFormatter()
  const { prefs, model, doc, format } = props
  const v = prefs[format]
  const plan = model.raster!
  const support = model.support[format]
  const set = (patch: Partial<VideoPrefs>) => updateFormatPrefs(format, patch)
  const codec = support.value?.codec ?? null
  const reason = support.value?.reason ?? null
  const preferred = CODEC_PREFERENCE[format][0]
  const noWebCodecs = reason === 'no-webcodecs'
  return (
    <OptionStack>
      {support.value && !codec && !support.pending && (
        <Unsupported
          format={format}
          reason={reason}
          size={t.export.summary.size(plan.size.width, plan.size.height)}
        />
      )}
      {!noWebCodecs && (
        <>
          <TimingRows format={format} plan={plan} props={props} />
          <OptionRow label={t.export.fields.quality}>
            <SegmentedControl<VideoPrefs['quality']>
              value={v.quality}
              onValueChange={(quality) => set({ quality })}
              size="md"
              aria-label={t.export.fields.quality}
              options={[
                { value: 'low', label: t.export.quality.low },
                { value: 'medium', label: t.export.quality.medium },
                { value: 'high', label: t.export.quality.high },
              ]}
            />
          </OptionRow>
          <OptionRow label={t.export.fields.repeat} hint={t.export.repeatHint}>
            <div className="flex items-center gap-2">
              <NumberField
                value={v.repeat}
                min={1}
                max={100}
                precision={0}
                suffix={t.export.times(v.repeat)}
                size="md"
                className="w-[84px]"
                aria-label={t.export.fields.repeat}
                onChange={(repeat) => set({ repeat })}
              />
              <span className="text-xs text-fg-subtle tabular-nums">
                {t.export.summary.seconds(fmt.decimal(plan.totalSeconds))}
              </span>
            </div>
          </OptionRow>
          <OptionDivider />
          {format === 'mp4' ? (
            <OptionRow label={t.export.fields.background}>
              <HexColorField value={v.color} onChange={(color) => set({ color })} />
            </OptionRow>
          ) : (
            <BackgroundRows
              mode={v.transparent ? 'transparent' : 'color'}
              color={v.color}
              onMode={(mode) => set({ transparent: mode === 'transparent' })}
              onColor={(color) => set({ color })}
            />
          )}
          {format === 'mp4' && <RowNote>{t.export.mp4NoAlpha}</RowNote>}
          {format === 'webm' && v.transparent && (
            <RowNote tone="warning">{t.export.webmAlphaNote}</RowNote>
          )}
          <OptionRow label={t.export.fields.codec}>
            {support.pending || !support.value ? (
              <span className="flex items-center gap-2 text-sm text-fg-subtle">
                <Spinner size={12} />
                {t.export.checkingEncoder}
              </span>
            ) : (
              <span className="text-sm text-fg-muted">
                {codec ? (CODEC_NAMES[codec] ?? codec) : '—'}
              </span>
            )}
          </OptionRow>
          {codec && codec !== preferred && format === 'mp4' && (
            <RowNote tone="warning">{t.export.codecFallback(CODEC_NAMES[codec] ?? codec)}</RowNote>
          )}
          <RendererRow
            value={prefs.renderer}
            viewRenderer={props.viewRenderer}
            fontsWarning={usesWebFonts(doc)}
          />
          <ContentNotes doc={doc} expressionsOff={props.expressionsOff} />
        </>
      )}
    </OptionStack>
  )
}

/* ------------------------------------------------------------------------- */
/*                                PNG sequence                               */
/* ------------------------------------------------------------------------- */

export function PngSequencePanel(props: PanelProps) {
  const t = useT()
  const { prefs, model, doc, fileName } = props
  const p = prefs.png
  const plan = model.raster!
  const base = frameBaseName(fileName)
  return (
    <OptionStack>
      <TimingRows format="png" plan={plan} props={props} />
      <OptionDivider />
      <BackgroundRows
        mode={p.background}
        color={p.color}
        onMode={(background) => updateFormatPrefs('png', { background })}
        onColor={(color) => updateFormatPrefs('png', { color })}
      />
      <OptionDivider />
      <RendererRow
        value={prefs.renderer}
        viewRenderer={props.viewRenderer}
        fontsWarning={usesWebFonts(doc)}
      />
      <Note>
        <span className="tabular-nums">
          {t.export.summary.files(plan.totalFrames)}:{' '}
          {t.export.sequenceFiles(
            frameFileName(base, 0, plan.totalFrames),
            frameFileName(base, plan.totalFrames - 1, plan.totalFrames),
          )}
        </span>
      </Note>
      <ContentNotes doc={doc} expressionsOff={props.expressionsOff} />
    </OptionStack>
  )
}
