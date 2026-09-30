/**
 * "Content" of the Lottie formats (JSON, dotLottie, Telegram sticker): the whole animation, or
 * one frame as a still Lottie (every value fixed, nothing animated), e.g. for a sticker pack.
 */
import { SegmentedControl } from '@/components/ui'
import { useT } from '@/i18n'
import { OptionDivider, OptionRow, RowNote } from '../fields'
import { FramePicker } from './FramePicker'
import type { PanelProps } from './types'

export function StillRows({ source, still, onStill, stillInfo, frame, onFrame }: PanelProps) {
  const t = useT()
  const ts = t.export.still
  return (
    <>
      <OptionRow label={ts.content}>
        <SegmentedControl<'animation' | 'frame'>
          value={still ? 'frame' : 'animation'}
          onValueChange={(v) => onStill(v === 'frame')}
          size="md"
          aria-label={ts.content}
          options={[
            { value: 'animation', label: ts.animation },
            { value: 'frame', label: ts.frame },
          ]}
        />
      </OptionRow>
      {still && (
        <>
          <OptionRow label={t.export.fields.frame} align="start">
            <FramePicker doc={source} frame={frame} onFrame={onFrame} />
          </OptionRow>
          <RowNote>{ts.note}</RowNote>
          {!!stillInfo?.expressions && (
            <RowNote tone="warning">{ts.expressions(stillInfo.expressions)}</RowNote>
          )}
          {!!stillInfo?.lostAutoOrient && (
            <RowNote tone="warning">{ts.autoOrient(stillInfo.lostAutoOrient)}</RowNote>
          )}
        </>
      )}
      <OptionDivider />
    </>
  )
}
