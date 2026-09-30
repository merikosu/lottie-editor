import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FieldRow,
  IconButton,
  MenuItem,
  NumberField,
  Section,
  Select,
  type ChangeGesture,
} from '@/components/ui'
import { useT } from '@/i18n'
import { roundTo } from '@/lib/math'
import { resizeCanvas } from '@/lottie/canvas'
import { setDuration } from '@/lottie/timing'
import type { Animation } from '@/lottie/types'
import { updateDoc, useDocument } from '@/store/document'
import { currentFormat, designArea, formatCanvas, FORMATS, type FormatId } from '../lib/formats'

const SPEED_PRESETS = [50, 75, 100, 125, 150, 200]

type LiveField = 'speed' | 'duration' | 'w' | 'h'

const gestureOptions = (g: ChangeGesture) => ({ coalesceKey: g.key, final: g.final })

/** Stretches or compresses the animation to last `seconds` (one undo step per gesture). */
function retime(label: string, seconds: number, g?: ChangeGesture): void {
  if (!(seconds > 0)) return
  updateDoc(label, (d) => setDuration(d as Animation, seconds), g ? gestureOptions(g) : undefined)
}

/**
 * Speed and duration (baked into the file) and the canvas: a format adds space around the
 * animation, the size fields set the canvas size (the animation stays centered, unscaled).
 */
export function TimingSection() {
  const t = useT()
  const w = useDocument((s) => s.doc?.w ?? 0)
  const h = useDocument((s) => s.doc?.h ?? 0)
  const fr = useDocument((s) => s.doc?.fr ?? 30)
  const frames = useDocument((s) => (s.doc ? s.doc.op - s.doc.ip : 0))
  const original = useDocument((s) => s.original)
  // Retiming or resizing on every scrub step would be slow and noisy: the field shows the value
  // while it is scrubbed and the document changes on release (one undo step).
  const [live, setLive] = useState<{ field: LiveField; value: number } | null>(null)
  if (!(w > 0) || !(h > 0) || !(fr > 0)) return null

  const seconds = frames / fr
  const originalSeconds =
    original && original.fr > 0 ? (original.op - original.ip) / original.fr : seconds
  const speed = seconds > 0 ? (originalSeconds / seconds) * 100 : 100
  const shown = (field: LiveField, value: number) => (live?.field === field ? live.value : value)
  const onRelease =
    (field: LiveField, apply: (value: number, g: ChangeGesture) => void) =>
    (value: number, g: ChangeGesture) => {
      if (!g.final) {
        setLive({ field, value })
        return
      }
      setLive(null)
      apply(value, g)
    }

  const applySpeed = (percent: number, g?: ChangeGesture) =>
    retime(t.customize.history.speed, originalSeconds / (percent / 100), g)
  const resize = (label: string, width: number, height: number, g?: ChangeGesture) => {
    const nw = Math.max(1, Math.round(width))
    const nh = Math.max(1, Math.round(height))
    if (nw === w && nh === h) return
    updateDoc(
      label,
      (d) => {
        resizeCanvas(d as Animation, nw, nh, { mode: 'resize', anchor: 'center' })
      },
      g ? gestureOptions(g) : undefined,
    )
  }

  const base = original ? { w: original.w, h: original.h } : { w, h }
  const format = currentFormat(base, { w, h })
  const applyFormat = (id: FormatId) => {
    const size = formatCanvas(designArea(base, { w, h }), id)
    resize(t.customize.history.format, size.w, size.h)
  }
  const formatOptions = [
    ...FORMATS.map((id) => {
      const size = formatCanvas(designArea(base, { w, h }), id)
      return {
        value: id as FormatId | 'custom',
        label: t.customize.timing.formats[id],
        hint: `${size.w} × ${size.h}`,
      }
    }),
    ...(format
      ? []
      : [
          {
            value: 'custom' as const,
            label: t.customize.timing.formats.custom,
            hint: `${w} × ${h}`,
            disabled: true,
          },
        ]),
  ]

  return (
    <Section id="customize.timing" title={t.customize.timing.title}>
      <FieldRow label={t.customize.timing.speed} hint={t.customize.timing.speedHint}>
        <NumberField
          value={shown('speed', roundTo(speed, 1))}
          min={5}
          max={1000}
          step={5}
          precision={1}
          suffix="%"
          aria-label={t.customize.timing.speed}
          onChange={onRelease('speed', applySpeed)}
          className="flex-1"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={ChevronDown} label={t.customize.timing.speedPresets} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[120px]">
            {SPEED_PRESETS.map((p) => (
              <MenuItem key={p} onSelect={() => applySpeed(p)}>
                {p}%
              </MenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </FieldRow>
      <FieldRow label={t.customize.timing.duration}>
        <NumberField
          value={shown('duration', roundTo(seconds, 2))}
          min={0.05}
          max={3600}
          step={0.1}
          precision={2}
          scrubSpeed={0.01}
          suffix={t.common.secondsShort}
          aria-label={t.customize.timing.duration}
          onChange={onRelease('duration', (v, g) => retime(t.customize.history.duration, v, g))}
          className="flex-1"
        />
        <span className="size-6 shrink-0" aria-hidden />
      </FieldRow>
      <FieldRow label={t.customize.timing.format} hint={t.customize.timing.formatHint}>
        <Select<FormatId | 'custom'>
          value={format ?? 'custom'}
          onValueChange={(v) => v !== 'custom' && applyFormat(v)}
          options={formatOptions}
          aria-label={t.customize.timing.format}
          contentClassName="min-w-[220px]"
        />
      </FieldRow>
      <FieldRow label={t.customize.timing.size} hint={t.customize.timing.sizeHint}>
        <NumberField
          value={shown('w', w)}
          label={t.customize.timing.widthShort}
          labelTooltip={t.customize.timing.width}
          min={1}
          max={8192}
          step={1}
          precision={0}
          onChange={onRelease('w', (v, g) => resize(t.customize.history.size, v, h, g))}
          className="min-w-0 flex-1"
        />
        <NumberField
          value={shown('h', h)}
          label={t.customize.timing.heightShort}
          labelTooltip={t.customize.timing.height}
          min={1}
          max={8192}
          step={1}
          precision={0}
          onChange={onRelease('h', (v, g) => resize(t.customize.history.size, w, v, g))}
          className="min-w-0 flex-1"
        />
      </FieldRow>
    </Section>
  )
}
