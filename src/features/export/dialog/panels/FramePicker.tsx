/** The frame to export: a number field, "use the playhead" and a slider over the animation. */
import { Crosshair } from 'lucide-react'
import { IconButton, Slider } from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { useT } from '@/i18n'
import { lastFrame } from '@/lottie/time'
import type { Animation } from '@/lottie/types'
import { usePlayback } from '@/store/playback'

export function FramePicker({
  doc,
  frame,
  onFrame,
}: {
  /** The animation the frame is taken from. */
  doc: Animation
  frame: number
  onFrame: (frame: number) => void
}) {
  const t = useT()
  const playhead = usePlayback((s) => Math.round(s.frame))
  const first = Math.round(doc.ip)
  const last = lastFrame(doc)
  return (
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
  )
}
