/** Options of the single-frame exports (PNG and SVG). */
import { Crosshair } from 'lucide-react'
import { IconButton, Slider } from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { useT } from '@/i18n'
import { lastFrame } from '@/lottie/time'
import { usePlayback } from '@/store/playback'
import { SIZE_PRESETS } from '../../plan'
import { updateFormatPrefs } from '../../store'
import {
  BackgroundRows,
  OptionDivider,
  OptionRow,
  OptionStack,
  RowNote,
  SizeField,
} from '../fields'
import { ContentNotes, RendererRow } from './common'
import { usesWebFonts } from '../doc-info'
import type { PanelProps } from './types'

export function FramePanel(props: PanelProps & { format: 'framePng' | 'frameSvg' }) {
  const t = useT()
  const { doc, prefs, model, frame, onFrame, format } = props
  const p = prefs[format]
  const plan = model.frame!
  const playhead = usePlayback((s) => Math.round(s.frame))
  const first = Math.round(doc.ip)
  const last = lastFrame(doc)
  return (
    <OptionStack>
      <OptionRow label={t.export.fields.frame} align="start">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-center gap-1.5">
            <NumberField
              value={frame}
              min={first}
              max={last}
              precision={0}
              size="md"
              className="w-[92px]"
              aria-label={t.export.fields.frame}
              onChange={(v) => onFrame(Math.round(v))}
            />
            <span className="text-xs text-fg-subtle tabular-nums">{t.export.frame.of(last)}</span>
            <IconButton
              icon={Crosshair}
              label={t.export.frame.playhead}
              disabled={playhead === frame}
              onClick={() => onFrame(playhead)}
              data-testid="export-frame-playhead"
            />
          </div>
          {last > first && (
            <Slider
              value={frame}
              min={first}
              max={last}
              step={1}
              className="max-w-[300px]"
              aria-label={t.export.fields.frame}
              onChange={(v) => onFrame(Math.round(v))}
            />
          )}
        </div>
      </OptionRow>
      <OptionRow label={t.export.fields.size} align="start">
        <SizeField
          presets={SIZE_PRESETS[format]}
          value={p.size}
          doc={doc}
          resolved={plan.size}
          onChange={(patch) => updateFormatPrefs(format, { size: { ...p.size, ...patch } })}
        />
      </OptionRow>
      {plan.size.adjusted && <RowNote>{t.export.sizeLimited}</RowNote>}
      {format === 'frameSvg' && <RowNote>{t.export.frame.svgSizeHint}</RowNote>}
      {format === 'frameSvg' && usesWebFonts(doc) && (
        <RowNote tone="warning">{t.export.frame.svgFontsNote}</RowNote>
      )}
      <BackgroundRows
        mode={p.background}
        color={p.color}
        onMode={(background) => updateFormatPrefs(format, { background })}
        onColor={(color) => updateFormatPrefs(format, { color })}
      />
      {format === 'framePng' && (
        <>
          <OptionDivider />
          <RendererRow
            value={prefs.renderer}
            viewRenderer={props.viewRenderer}
            fontsWarning={usesWebFonts(doc)}
          />
        </>
      )}
      <ContentNotes doc={doc} expressionsOff={props.expressionsOff} />
    </OptionStack>
  )
}
