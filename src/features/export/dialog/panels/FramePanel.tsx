/** Options of the single-frame exports (PNG and SVG). */
import { useT } from '@/i18n'
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
import { FramePicker } from './FramePicker'
import type { PanelProps } from './types'

export function FramePanel(props: PanelProps & { format: 'framePng' | 'frameSvg' }) {
  const t = useT()
  const { doc, prefs, model, frame, onFrame, format } = props
  const p = prefs[format]
  const plan = model.frame!
  return (
    <OptionStack>
      <OptionRow label={t.export.fields.frame} align="start">
        <FramePicker doc={doc} frame={frame} onFrame={onFrame} />
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
