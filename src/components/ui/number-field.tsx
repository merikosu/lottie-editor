import {
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'
import { formatDecimal } from '@/lib/format'
import { clamp, roundTo } from '@/lib/math'
import { uid } from '@/lib/id'
import type { IconProps } from '@/commands/registry'
import { fieldFrame, fieldSizes, type FieldSize } from './field'
import { evaluateExpression } from './math-expression'
import type { ChangeGesture } from './gesture'
import { Tooltip } from './tooltip'

export interface NumberFieldProps {
  /** Current value; null renders as "mixed" (multiple selection with different values). */
  value: number | null
  onChange: (value: number, gesture: ChangeGesture) => void
  /** Short label or icon inside the field; dragging it scrubs the value. */
  label?: ReactNode
  labelIcon?: ComponentType<IconProps>
  /** Tooltip for the label (full property name). */
  labelTooltip?: string
  suffix?: string
  min?: number
  max?: number
  /** Arrow key / scrub increment. */
  step?: number
  /** Displayed decimals. */
  precision?: number
  /** Value change per dragged pixel (defaults to `step`). */
  scrubSpeed?: number
  size?: FieldSize
  disabled?: boolean
  className?: string
  inputClassName?: string
  'aria-label'?: string
  /** Highlight (e.g. property is animated / has a keyframe here). */
  tone?: 'default' | 'animated' | 'keyframe' | 'expression'
  placeholder?: string
}

const DRAG_THRESHOLD = 3

function format(value: number | null, precision: number): string {
  if (value === null || !Number.isFinite(value)) return ''
  return formatDecimal(value, precision)
}

/**
 * Compact numeric input with After Effects / Figma-style scrubbing:
 * drag the label (or the unfocused field) horizontally to change the value
 * (Shift ×10, Alt ×0.1); click to type; arrows nudge; math like "120/2" is evaluated.
 */
export function NumberField({
  value,
  onChange,
  label,
  labelIcon: LabelIcon,
  labelTooltip,
  suffix,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision = 2,
  scrubSpeed,
  size = 'sm',
  disabled,
  className,
  inputClassName,
  tone = 'default',
  placeholder,
  ...rest
}: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Text being typed; null when not editing (then the formatted value is shown).
  const [draft, setDraft] = useState<string | null>(null)
  // Text the field showed when editing started (or after the last commit). Leaving the field
  // without changing it must not write anything: no rounding of the stored value, no key at a
  // playhead that moved meanwhile.
  const baseText = useRef<string | null>(null)
  // Escape cancels: the blur it causes must not commit.
  const cancelled = useRef(false)
  const focused = draft !== null
  const text = draft ?? format(value, precision)
  const [scrubbing, setScrubbing] = useState(false)
  const nudgeKey = useRef(uid('nudge'))
  const drag = useRef<{
    startX: number
    startValue: number
    moved: boolean
    key: string
    pointerId: number
    fromInput: boolean
    last: number
  } | null>(null)

  const emit = (next: number, gesture: ChangeGesture) => {
    const v = clamp(roundTo(next, Math.max(precision, 4)), min, max)
    onChange(v, gesture)
    return v
  }

  /** Applies the typed text; returns the resulting value (or the current one if unchanged/invalid). */
  const commitText = (): number | null => {
    if (draft === null || cancelled.current || draft.trim() === (baseText.current ?? '').trim())
      return value
    const parsed = evaluateExpression(draft)
    if (parsed === null) return value
    const v = emit(parsed, { key: uid('type'), final: true })
    baseText.current = format(v, precision)
    return v
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const v = commitText()
      setDraft(format(v, precision))
      inputRef.current?.select()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelled.current = true
      setDraft(null)
      inputRef.current?.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
      const base = evaluateExpression(text) ?? value ?? 0
      const v = emit(base + (e.key === 'ArrowUp' ? 1 : -1) * step * mult, {
        key: nudgeKey.current,
        final: true,
      })
      setDraft(format(v, precision))
      baseText.current = format(v, precision)
    }
  }

  const startDrag = (e: PointerEvent<HTMLElement>, fromInput: boolean) => {
    if (disabled || e.button !== 0) return
    if (fromInput && focused) return // let the user select text
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = {
      startX: e.clientX,
      startValue: value ?? 0,
      moved: false,
      key: uid('scrub'),
      pointerId: e.pointerId,
      fromInput,
      last: value ?? 0,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.startX
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return
    if (!d.moved) {
      d.moved = true
      setScrubbing(true)
      inputRef.current?.blur()
    }
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const speed = (scrubSpeed ?? step) * mult
    const next = d.startValue + Math.round(dx) * speed
    d.last = emit(next, { key: d.key, final: false })
  }

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    setScrubbing(false)
    if (d.moved) {
      emit(d.last, { key: d.key, final: true })
    } else if (d.fromInput || label !== undefined || LabelIcon) {
      // A click (no drag): start editing.
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  const scrubHandlers = {
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }

  const hasLabel = label !== undefined || LabelIcon !== undefined
  const labelNode = hasLabel && (
    <span
      className={cn(
        'flex h-full shrink-0 cursor-ew-resize items-center justify-center pl-1.5 text-xs text-fg-subtle select-none',
        LabelIcon ? 'w-6 pl-0' : 'min-w-5 pr-0.5',
        scrubbing && 'text-accent-text',
      )}
      onPointerDown={(e) => startDrag(e, false)}
      {...scrubHandlers}
    >
      {LabelIcon ? <LabelIcon size={12} /> : label}
    </span>
  )

  return (
    <div
      className={cn(
        fieldFrame,
        fieldSizes[size],
        'group relative',
        tone === 'animated' && 'text-accent-text',
        tone === 'keyframe' && 'text-warning',
        tone === 'expression' && 'text-danger',
        scrubbing && 'shadow-[inset_0_0_0_1px_var(--le-accent)]',
        className,
      )}
      aria-disabled={disabled || undefined}
    >
      {hasLabel && labelTooltip ? <Tooltip content={labelTooltip}>{labelNode}</Tooltip> : labelNode}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-valuenow={value ?? undefined}
        aria-valuemin={Number.isFinite(min) ? min : undefined}
        aria-valuemax={Number.isFinite(max) ? max : undefined}
        aria-label={rest['aria-label'] ?? labelTooltip}
        disabled={disabled}
        value={text}
        placeholder={value === null ? '—' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          const shown = format(value, precision)
          baseText.current = shown
          cancelled.current = false
          setDraft(shown)
          e.target.select()
        }}
        onBlur={() => {
          commitText()
          cancelled.current = false
          baseText.current = null
          setDraft(null)
        }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => startDrag(e, true)}
        {...scrubHandlers}
        className={cn(
          'h-full w-full min-w-0 bg-transparent px-1.5 text-inherit tabular-nums outline-none placeholder:text-fg-faint',
          !focused && 'cursor-ew-resize',
          inputClassName,
        )}
      />
      {suffix && (
        <span className="pointer-events-none shrink-0 pr-1.5 text-xs text-fg-faint">{suffix}</span>
      )}
    </div>
  )
}
