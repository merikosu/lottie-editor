import { useT } from '@/i18n'
import { FieldRow } from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { formatSeconds } from '../format'
import { PAUSE_PRESETS } from '../presets'
import { setDocopsPrefs, useDocopsPrefs } from '../store'

/** Pause length field with quick values and a before → after duration line. */
export function PauseForm() {
  const t = useT()
  const seconds = useDocopsPrefs((s) => s.pauseSeconds)
  const fr = useDocument((s) => s.doc?.fr ?? 30)
  const frames = useDocument((s) => (s.doc ? s.doc.op - s.doc.ip : 0))
  const added = Math.max(1, Math.round(seconds * fr))
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label={t.docops.pause.length}>
        <NumberField
          value={seconds}
          min={0.01}
          max={600}
          step={0.25}
          precision={2}
          suffix={t.common.secondsShort}
          onChange={(v) => setDocopsPrefs({ pauseSeconds: Math.max(0.01, v) })}
          className="flex-1"
          aria-label={t.docops.pause.length}
        />
      </FieldRow>
      <div className="flex gap-1 pl-[92px]">
        {PAUSE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDocopsPrefs({ pauseSeconds: p })}
            className={cn(
              'h-5 rounded-sm px-1.5 text-xs tabular-nums transition-colors duration-100',
              Math.abs(p - seconds) < 1e-6
                ? 'bg-accent-subtle text-accent-text'
                : 'text-fg-muted hover:bg-hover hover:text-fg',
            )}
          >
            {formatSeconds(t, p)}
          </button>
        ))}
      </div>
      <div className="pl-[92px] text-xs text-fg-subtle tabular-nums">
        {t.docops.pause.summary(
          formatSeconds(t, frames / fr),
          formatSeconds(t, (frames + added) / fr),
        )}
      </div>
    </div>
  )
}
