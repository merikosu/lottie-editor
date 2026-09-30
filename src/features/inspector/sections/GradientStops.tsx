/**
 * Gradient stops editor for `gf`/`gs`: a bar with draggable stops (click the bar to add a
 * stop, drag a stop away to remove it), the selected stop's color, position and opacity.
 * Opacity stops that don't line up with the color stops get their own lane above the bar.
 *
 * Value edits happen at the playhead (auto-keying animated gradients); adding or removing a
 * stop changes every keyframe so they keep the same layout.
 */
import { Droplet, Minus, MoveHorizontal } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ColorField, IconButton, type ChangeGesture } from '@/components/ui'
import { NumberField } from '../components/number-field'
import { useDocumentColors } from '@/features/colors'
import { useT } from '@/i18n'
import { rgbaToHex } from '@/lib/color'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/id'
import { clamp, roundTo } from '@/lib/math'
import type { NodePath } from '@/lottie/path'
import { isAnimated } from '@/lottie/property'
import type { GradientColors } from '@/lottie/types'
import { PropertyRow } from '../components/PropertyRow'
import { editAllStops, writeStopsWithStructure } from './gradient-edit'
import type { PropTarget } from '../edit'
import {
  cssGradient,
  hasAlignedOpacity,
  insertOpacityStop,
  insertStop,
  parseStops,
  removeOpacityStop,
  removeStop,
  serializeStops,
  setOpacityStop,
  setStopAlpha,
  setStopColor,
  setStopOffset,
  sortStops,
  stopAlpha,
  type GradientStops,
} from '../model/gradient'

type Selection = { kind: 'color' | 'opacity'; index: number }

/** Dragging a stop this far (px) away from the bar removes it on release. */
const REMOVE_DISTANCE = 28

interface GradientStopsRowProps {
  label: string
  /** Path of the gradient item (`gf`/`gs`). */
  path: NodePath
  gradient: GradientColors | undefined
  target: PropTarget
}

export function GradientStopsRow({ label, path, gradient, target }: GradientStopsRowProps) {
  const t = useT()
  const [selection, setSelection] = useState<Selection>({ kind: 'color', index: 0 })
  const count = gradient?.p ?? 0
  const animated = isAnimated(gradient?.k)

  /** Adds/removes stops on every keyframe (structure must match across keyframes). */
  const restructure = (
    historyLabel: string,
    edit: (stops: GradientStops) => GradientStops,
    delta: number,
    gesture?: ChangeGesture,
  ) => editAllStops(historyLabel, path, edit, delta, gesture)

  return (
    <PropertyRow
      label={label}
      targets={[target]}
      props={[gradient?.k]}
      fallback={[0, 0, 0, 0, 1, 1, 1, 1]}
      alignTop
    >
      {({ values, write }) => {
        const stops = parseStops(values[0] ?? [], count)
        const aligned = hasAlignedOpacity(stops)
        const sel: Selection =
          selection.kind === 'opacity' && !aligned && stops.opacities[selection.index]
            ? selection
            : {
                kind: 'color',
                index: clamp(
                  selection.kind === 'color' ? selection.index : 0,
                  0,
                  Math.max(0, stops.colors.length - 1),
                ),
              }

        const commit = (next: GradientStops, gesture?: ChangeGesture) => {
          if (animated && next.opacities.length !== stops.opacities.length) {
            // Opacity stops added at the playhead: every keyframe gets them (looking the same).
            writeStopsWithStructure(
              t.inspector.history.change(label),
              path,
              target.frame,
              next,
              gesture,
            )
          } else {
            write(() => serializeStops(next), gesture)
          }
        }
        return (
          <StopsEditor
            stops={stops}
            selection={sel}
            onSelect={setSelection}
            onChange={commit}
            onInsert={(kind, offset) => {
              if (kind === 'color') {
                const { index } = insertStop(stops, offset)
                restructure(t.inspector.history.addStop, (s) => insertStop(s, offset).stops, 1)
                setSelection({ kind: 'color', index })
              } else {
                const { index } = insertOpacityStop(stops, offset)
                restructure(
                  t.inspector.history.addStop,
                  (s) => insertOpacityStop(s, offset).stops,
                  0,
                )
                setSelection({ kind: 'opacity', index })
              }
            }}
            onRemove={(kind, index, gesture) => {
              if (kind === 'color') {
                if (stops.colors.length <= 2) return
                restructure(
                  t.inspector.history.removeStop,
                  (s) => removeStop(s, index),
                  -1,
                  gesture,
                )
              } else {
                if (stops.opacities.length <= 2) return
                restructure(
                  t.inspector.history.removeStop,
                  (s) => removeOpacityStop(s, index),
                  0,
                  gesture,
                )
              }
              setSelection({ kind, index: Math.max(0, index - 1) })
            }}
          />
        )
      }}
    </PropertyRow>
  )
}

interface StopsEditorProps {
  stops: GradientStops
  selection: Selection
  onSelect: (s: Selection) => void
  onChange: (stops: GradientStops, gesture?: ChangeGesture) => void
  onInsert: (kind: Selection['kind'], offset: number) => void
  onRemove: (kind: Selection['kind'], index: number, gesture?: ChangeGesture) => void
}

function StopsEditor({
  stops,
  selection,
  onSelect,
  onChange,
  onInsert,
  onRemove,
}: StopsEditorProps) {
  const t = useT()
  const tp = t.inspector.props
  const swatches = useDocumentColors()
  const barRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const aligned = hasAlignedOpacity(stops)
  const showOpacityLane = stops.opacities.length > 0 && !aligned
  /**
   * Markers are keyed by index, so a stop that passes a neighbour (or a removed stop) leaves
   * focus on another marker: move it to the stop being edited as soon as the new order is
   * committed (before the next key press is handled).
   */
  const pendingFocus = useRef<string | null>(null)
  const focusMarker = (kind: Selection['kind'], index: number) => {
    pendingFocus.current = `${kind}-${index}`
  }
  useLayoutEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    pendingFocus.current = null
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-stop="${key}"]`)?.focus()
  })
  const drag = useRef<{
    kind: Selection['kind']
    index: number
    key: string
    startY: number
    remove: boolean
    /** Latest stops written by this drag (renders may lag behind pointer events). */
    stops: GradientStops
  } | null>(null)
  const [removing, setRemoving] = useState<Selection | null>(null)

  const offsetAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return clamp((clientX - rect.left) / rect.width, 0, 1)
  }

  /**
   * Moves a stop of `base`, keeping ascending order (SVG needs it) and the selection on the
   * moved stop. Returns the written stops and the stop's new index.
   */
  const moveStop = (
    base: GradientStops,
    kind: Selection['kind'],
    index: number,
    offset: number,
    gesture?: ChangeGesture,
  ): { stops: GradientStops; index: number } => {
    let next: { stops: GradientStops; index: number }
    if (kind === 'color') {
      next = sortStops(setStopOffset(base, index, offset), index)
    } else {
      const moved = setOpacityStop(base, index, { offset })
      const order = moved.opacities
        .map((_, i) => i)
        .sort((a, b) => moved.opacities[a].offset - moved.opacities[b].offset || a - b)
      next = {
        stops: { ...moved, opacities: order.map((i) => moved.opacities[i]) },
        index: order.indexOf(index),
      }
    }
    onChange(next.stops, gesture)
    onSelect({ kind, index: next.index })
    return next
  }

  const onMarkerDown = (
    e: PointerEvent<HTMLButtonElement>,
    kind: Selection['kind'],
    index: number,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    onSelect({ kind, index })
    drag.current = { kind, index, key: uid('stop'), startY: e.clientY, remove: false, stops }
  }

  const onMarkerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const list = d.kind === 'color' ? d.stops.colors : d.stops.opacities
    const remove = Math.abs(e.clientY - d.startY) > REMOVE_DISTANCE && list.length > 2
    if (remove !== d.remove) {
      d.remove = remove
      setRemoving(remove ? { kind: d.kind, index: d.index } : null)
    }
    if (remove) return
    const offset = roundTo(offsetAt(e.clientX), 4)
    if (!list[d.index] || Math.abs(offset - list[d.index].offset) < 1e-4) return
    const next = moveStop(d.stops, d.kind, d.index, offset, { key: d.key, final: false })
    d.index = next.index
    d.stops = next.stops
  }

  const onMarkerUp = () => {
    const d = drag.current
    drag.current = null
    setRemoving(null)
    // Removing a dragged stop ends the drag's undo step (the move and the removal are one step).
    if (d?.remove) onRemove(d.kind, d.index, { key: d.key, final: true })
  }

  const onMarkerKey = (
    e: KeyboardEvent<HTMLButtonElement>,
    kind: Selection['kind'],
    index: number,
  ) => {
    const list = kind === 'color' ? stops.colors : stops.opacities
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01)
      const next = moveStop(
        stops,
        kind,
        index,
        clamp(roundTo(list[index].offset + delta, 4), 0, 1),
        {
          key: `nudge-${kind}-${index}`,
          final: true,
        },
      )
      if (next.index !== index) focusMarker(kind, next.index)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      if (list.length <= 2) return
      onRemove(kind, index)
      focusMarker(kind, Math.max(0, index - 1))
    }
  }

  const selectedColor = selection.kind === 'color' ? stops.colors[selection.index] : undefined
  const selectedOpacity =
    selection.kind === 'opacity' ? stops.opacities[selection.index] : undefined
  const offset = selectedColor?.offset ?? selectedOpacity?.offset ?? 0
  const alpha = selectedColor ? stopAlpha(stops, selection.index) : (selectedOpacity?.alpha ?? 1)
  const canRemove =
    selection.kind === 'color' ? stops.colors.length > 2 : stops.opacities.length > 2
  const removeButton = (
    <IconButton
      icon={Minus}
      label={t.inspector.history.removeStop}
      disabled={!canRemove}
      tooltipSide="left"
      onClick={() => onRemove(selection.kind, selection.index)}
    />
  )

  const marker = (kind: Selection['kind'], index: number, stopOffset: number, color: string) => {
    const selected = selection.kind === kind && selection.index === index
    const fading = removing?.kind === kind && removing.index === index
    return (
      <button
        key={`${kind}-${index}`}
        type="button"
        data-stop={`${kind}-${index}`}
        aria-label={`${kind === 'color' ? tp.color : tp.opacity} ${Math.round(stopOffset * 100)}%`}
        aria-pressed={selected}
        onPointerDown={(e) => onMarkerDown(e, kind, index)}
        onPointerMove={onMarkerMove}
        onPointerUp={onMarkerUp}
        onPointerCancel={onMarkerUp}
        onKeyDown={(e) => onMarkerKey(e, kind, index)}
        onClick={(e) => e.stopPropagation()}
        style={{ left: `${stopOffset * 100}%` }}
        className={cn(
          'absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-[4px] outline-none active:cursor-grabbing',
          'shadow-[0_0_0_2px_#fff,0_0_0_3px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.4)]',
          selected && 'shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--le-accent),0_1px_3px_rgb(0_0_0/0.4)]',
          kind === 'opacity' && 'rounded-full',
          fading && 'opacity-30',
          'focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--le-accent)]',
        )}
      >
        <span className="block size-full rounded-[inherit]" style={{ background: color }} />
      </button>
    )
  }

  return (
    <div ref={rootRef} className="flex w-full min-w-0 flex-col gap-1.5">
      {showOpacityLane && (
        <div
          className="relative mx-[7px] h-4 cursor-copy"
          onClick={(e) => onInsert('opacity', offsetAt(e.clientX))}
          role="presentation"
        >
          {stops.opacities.map((s, i) => {
            const g = Math.round((1 - clamp(s.alpha, 0, 1)) * 255)
            return marker('opacity', i, s.offset, `rgb(${g}, ${g}, ${g})`)
          })}
        </div>
      )}
      <div className="relative h-6 rounded-sm checkerboard-sm shadow-[inset_0_0_0_1px_var(--le-line-strong)]">
        <div
          className="absolute inset-0 rounded-[inherit]"
          style={{ background: cssGradient(stops) }}
        />
        <div
          ref={barRef}
          className="absolute inset-y-0 right-[7px] left-[7px] cursor-copy"
          onClick={(e) => onInsert('color', offsetAt(e.clientX))}
          role="presentation"
        >
          {stops.colors.map((s, i) =>
            marker(
              'color',
              i,
              s.offset,
              rgbaToHex({
                r: clamp(s.color[0], 0, 1),
                g: clamp(s.color[1], 0, 1),
                b: clamp(s.color[2], 0, 1),
                a: 1,
              }),
            ),
          )}
        </div>
      </div>
      {selectedColor && (
        <div className="flex min-w-0 items-center gap-1.5">
          <ColorField
            className="min-w-0 flex-1"
            value={{
              r: clamp(selectedColor.color[0], 0, 1),
              g: clamp(selectedColor.color[1], 0, 1),
              b: clamp(selectedColor.color[2], 0, 1),
              a: 1,
            }}
            alpha={false}
            swatches={swatches}
            onChange={(c, g) => onChange(setStopColor(stops, selection.index, [c.r, c.g, c.b]), g)}
          />
          {removeButton}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
          <NumberField
            labelIcon={MoveHorizontal}
            labelTooltip={t.inspector.props.position}
            value={roundTo(offset * 100, 1)}
            min={0}
            max={100}
            precision={1}
            suffix="%"
            inputClassName="px-1"
            onChange={(v, g) => moveStop(stops, selection.kind, selection.index, v / 100, g)}
          />
          <NumberField
            labelIcon={Droplet}
            labelTooltip={t.inspector.props.opacity}
            value={roundTo(alpha * 100, 1)}
            min={0}
            max={100}
            precision={0}
            suffix="%"
            inputClassName="px-1"
            onChange={(v, g) =>
              onChange(
                selection.kind === 'color'
                  ? setStopAlpha(stops, selection.index, v / 100)
                  : setOpacityStop(stops, selection.index, { alpha: v / 100 }),
                g,
              )
            }
          />
        </div>
        {!selectedColor && removeButton}
      </div>
    </div>
  )
}
