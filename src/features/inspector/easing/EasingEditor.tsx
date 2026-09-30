/**
 * Easing editor for keyframe segments: curve plot, preview, x1/y1/x2/y2 fields, presets,
 * hold, and CSS cubic-bezier copy/paste. Edits every segment of the selection at once.
 */
import { Check, ClipboardPaste, Copy, Info } from 'lucide-react'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { IconButton, Switch, Tooltip, toast, type ChangeGesture } from '@/components/ui'
import { NumberField } from '../components/number-field'
import { useT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { handleComponent, matchPreset, EASING_PRESETS, type BezierCurve } from '@/lottie/easing'
import { normalizeLegacyKeyframes, setSegmentEasing } from '@/lottie/keyframes'
import { getKeyframes, hasSpatialTangents } from '@/lottie/property'
import type { Keyframe } from '@/lottie/types'
import { updateDoc, useDocument } from '@/store/document'
import { Note } from '../components/Row'
import { gestureOptions, propertyAt } from '../edit'
import {
  constrainCurve,
  curvesEqual,
  formatCubicBezier,
  isPerAxis,
  isSpatialSegment,
  parseEasing,
  segmentKeyframe,
  type SegmentRef,
} from '../model/easing'
import { CurvePlot } from './CurvePlot'
import { EasingPreview } from './EasingPreview'
import { curveRange } from './geometry'

/** The bezier handles of a segment, ignoring hold (so un-holding restores the curve). */
function handlesOf(kf: Keyframe<unknown>): BezierCurve {
  return [
    handleComponent(kf.o?.x, 0, 0),
    handleComponent(kf.o?.y, 0, 0),
    handleComponent(kf.i?.x, 0, 1),
    handleComponent(kf.i?.y, 0, 1),
  ]
}

export function EasingEditor({ segments }: { segments: SegmentRef[] }) {
  const t = useT()
  const te = t.inspector.easing
  const keyframes = useDocument(
    useShallow((s) => segments.map((seg) => (s.doc ? segmentKeyframe(s.doc, seg) : undefined))),
  )
  const [copied, setCopied] = useState(false)
  const first = keyframes.find((k): k is Keyframe<unknown> => !!k)
  if (!first) return null

  const hold = first.h === 1
  const curve = handlesOf(first)
  const spatial = keyframes.some((kf) => !!kf && isSpatialSegment(kf))
  const perAxis = keyframes.some((kf) => !!kf && isPerAxis(kf))
  const mixed = keyframes.some(
    (kf) => !!kf && (!curvesEqual(handlesOf(kf), curve) || (kf.h === 1) !== hold),
  )
  const preset = matchPreset(hold ? null : curve)

  /** Writes a curve (null = hold) to every segment; one undo step per gesture. */
  const apply = (next: BezierCurve | null, gesture?: ChangeGesture) =>
    updateDoc(
      t.inspector.history.easing,
      (draft) => {
        for (const seg of segments) {
          const prop = propertyAt(draft, seg.path)
          if (prop) normalizeLegacyKeyframes(prop)
          const kf = getKeyframes(prop)?.[seg.index]
          if (!prop || !kf) continue
          if (next === null) {
            setSegmentEasing(prop, seg.index, null)
            // lottie-web ignores hold on motion-path segments: drop their tangents.
            if (hasSpatialTangents(kf)) {
              delete kf.to
              delete kf.ti
            }
          } else {
            setSegmentEasing(prop, seg.index, constrainCurve(next, isSpatialSegment(kf)))
          }
        }
      },
      gestureOptions(gesture),
    )

  const setComponent = (i: number, v: number, g: ChangeGesture) => {
    const next = [...curve] as BezierCurve
    next[i] = v
    apply(next, g)
  }

  const copyCss = async () => {
    if (await copyText(hold ? 'steps(1, end)' : formatCubicBezier(curve))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }

  const paste = async () => {
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      toast.error(te.clipboardDenied)
      return
    }
    const parsed = parseEasing(text)
    if (parsed === null) {
      toast.error(te.pasteFailed)
      return
    }
    apply(parsed === 'hold' ? null : parsed)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-5 items-center justify-between gap-2 pl-5 text-xs">
        <span className="font-medium text-fg">{te.title}</span>
        <span className="truncate text-fg-subtle">
          {mixed ? t.common.mixed : preset ? te.presets[preset.id] : te.custom}
        </span>
      </div>
      <CurvePlot
        curve={curve}
        hold={hold}
        spatial={spatial}
        onChange={apply}
        labels={{ curve: te.curve, out: te.outHandle, in: te.inHandle }}
      />
      <EasingPreview curve={curve} hold={hold} />
      <div className={cn('grid grid-cols-4 gap-1', hold && 'pointer-events-none opacity-40')}>
        {(['x1', 'y1', 'x2', 'y2'] as const).map((label, i) => (
          <NumberField
            key={label}
            label={label}
            labelTooltip={i < 2 ? te.outHandle : te.inHandle}
            value={curve[i]}
            precision={2}
            step={0.01}
            scrubSpeed={0.005}
            min={i % 2 === 0 || spatial ? 0 : -5}
            max={i % 2 === 0 || spatial ? 1 : 6}
            onChange={(v, g) => setComponent(i, v, g)}
            inputClassName="px-1"
            disabled={hold}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Tooltip content={te.holdHint} side="left">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <Switch
              checked={hold}
              onCheckedChange={(on) => apply(on ? null : curve)}
              aria-label={te.hold}
            />
            {te.hold}
          </label>
        </Tooltip>
        <div className="flex-1" />
        <IconButton
          icon={copied ? Check : Copy}
          label={copied ? t.common.copied : te.copyCssHint}
          onClick={() => void copyCss()}
          className={cn(copied && 'text-success hover:text-success')}
        />
        <IconButton icon={ClipboardPaste} label={te.pasteHint} onClick={() => void paste()} />
      </div>
      <PresetGrid current={mixed ? undefined : preset?.id} onPick={(c) => apply(c)} />
      {spatial && <Note icon={<Info size={12} />}>{te.spatial}</Note>}
      {perAxis && <Note icon={<Info size={12} />}>{te.perAxis}</Note>}
      {mixed && segments.length > 1 && (
        <Note icon={<Info size={12} />}>{te.mixed(segments.length)}</Note>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Presets                                  */
/* -------------------------------------------------------------------------- */

function PresetGrid({
  current,
  onPick,
}: {
  current: string | undefined
  onPick: (curve: BezierCurve | null) => void
}) {
  const t = useT()
  return (
    <div className="grid grid-cols-5 gap-1">
      {EASING_PRESETS.map((preset) => {
        const name = t.inspector.easing.presets[preset.id] ?? preset.id
        const active = current === preset.id
        return (
          <Tooltip key={preset.id} content={name}>
            <button
              type="button"
              aria-label={name}
              aria-pressed={active}
              onClick={() => onPick(preset.curve)}
              className={cn(
                'flex h-8 items-center justify-center rounded-md transition-colors duration-100',
                active
                  ? 'bg-selected text-accent-text'
                  : 'text-fg-subtle hover:bg-hover hover:text-fg',
              )}
            >
              <PresetThumb curve={preset.curve} />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

function PresetThumb({ curve }: { curve: BezierCurve | null }) {
  const W = 32
  const H = 20
  const [lo, hi] = curve ? curveRange(curve, 0.08) : [-0.08, 1.08]
  const X = (x: number) => 2 + x * (W - 4)
  const Y = (y: number) => ((hi - y) / (hi - lo)) * H
  const d = curve
    ? `M${X(0)} ${Y(0)}C${X(curve[0])} ${Y(curve[1])} ${X(curve[2])} ${Y(curve[3])} ${X(1)} ${Y(1)}`
    : `M${X(0)} ${Y(0)}H${X(1)}V${Y(1)}`
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="overflow-visible">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
