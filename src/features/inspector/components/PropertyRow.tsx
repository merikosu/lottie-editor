/**
 * The animatable property row: `[key status] Label [fx]  [value fields…]`.
 *
 * - Values are evaluated at the playhead (in the property's composition time).
 * - Editing auto-keys animated properties; a continuous gesture is one undo step.
 * - Hovering reveals ‹ › to jump to the previous / next keyframe; right-click opens a menu
 *   with key actions, "Remove animation", "Reset" and "Show in JSON".
 * - Several targets (multi-selection) are edited together; differing values show as mixed.
 */
import { Braces, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import {
  Badge,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
  MenuSeparator,
  Tooltip,
  type ChangeGesture,
} from '@/components/ui'
import { useT } from '@/i18n'
import { emit } from '@/lib/events'
import { cn } from '@/lib/cn'
import { isEditableTarget } from '@/lib/platform'
import { pathEquals } from '@/lottie/path'
import type { AnyProperty } from '@/lottie/property'
import { focusProperty, useDocument } from '@/store/document'
import { setFrame } from '@/store/playback'
import {
  editProperties,
  firstExpression,
  holdKeyframes,
  keyStatus,
  neighbourKeys,
  readValue,
  removeAnimation,
  toggleKeys,
  writeValue,
  type KeyStatus,
  type PropTarget,
  type Value,
} from '../edit'
import { useInspectorFrame } from '../hooks'
import { expressionSummary } from '../model/values'
import { DiamondIcon } from './icons'
import { KeyButton } from './KeyButton'
import { InspectorRow } from './Row'

export interface PropertyRowContext {
  status: KeyStatus
  /** NumberField tone for the current status. */
  tone: 'default' | 'animated' | 'keyframe'
  /** Evaluated value of each target at its frame. */
  values: number[][]
  /** Writes a value computed per target; pass the control's gesture for one undo step. */
  write: (compute: (current: number[], index: number) => Value, gesture?: ChangeGesture) => void
}

export interface PropertyRowProps {
  label: string
  hint?: string
  targets: PropTarget[]
  props: readonly (AnyProperty | null | undefined)[]
  /** Value of missing properties; also the "Reset" value when `resettable`. */
  fallback: number[]
  resettable?: boolean
  /** Extra element after the label (e.g. a link toggle). */
  badge?: ReactNode
  disabled?: boolean
  className?: string
  /** Align the label with the top of tall controls. */
  alignTop?: boolean
  /** Discrete value (checkbox, menu, picker): keyframes are hold keyframes. */
  discrete?: boolean
  children: (ctx: PropertyRowContext) => ReactNode
}

const toneOf = (status: KeyStatus): PropertyRowContext['tone'] =>
  status === 'key' ? 'keyframe' : status === 'animated' ? 'animated' : 'default'

export function PropertyRow({
  label,
  hint,
  targets,
  props,
  fallback,
  resettable,
  badge,
  disabled,
  className,
  alignTop,
  discrete,
  children,
}: PropertyRowProps) {
  const t = useT()
  const rootFrame = useInspectorFrame()
  const firstPath = targets[0]?.path
  // Keyframes of this property are selected (e.g. in the timeline): show the link.
  const keysSelected = useDocument(
    (s) => !!firstPath && s.selection.keyframes.some((k) => pathEquals(k.path, firstPath)),
  )
  const status = keyStatus(props, targets)
  const values = targets.map((target, i) => readValue(props[i], target.frame, fallback))
  const expression = firstExpression(props)
  const { prev, next } =
    status === 'static' ? { prev: null, next: null } : neighbourKeys(props, targets)
  const frameLabel = String(rootFrame)

  const write: PropertyRowContext['write'] = (compute, gesture) => {
    editProperties(
      t.inspector.history.change(label),
      targets,
      (prop, target, index) => {
        writeValue(prop, target.frame, compute(readValue(prop, target.frame, fallback), index))
        if (discrete) holdKeyframes(prop)
      },
      gesture,
    )
  }

  const onKey = () => {
    const historyLabel =
      status === 'key'
        ? t.inspector.history.removeKey
        : status === 'animated'
          ? t.inspector.history.addKey
          : t.inspector.history.animate
    toggleKeys(historyLabel, targets, status, discrete)
  }

  const keyTooltip =
    status === 'key'
      ? t.inspector.key.remove(frameLabel)
      : status === 'animated'
        ? t.inspector.key.add(frameLabel)
        : t.inspector.key.animate(frameLabel)

  const fx = expression ? (
    <Tooltip
      side="left"
      content={
        <span className="flex max-w-64 flex-col gap-0.5">
          <span className="font-mono text-2xs break-all text-fg">
            {expressionSummary(expression)}
          </span>
          <span className="text-fg-muted">{t.inspector.key.expressionHint}</span>
        </span>
      }
    >
      <span className="inline-flex shrink-0">
        <Badge tone="danger" className="font-mono italic">
          <span aria-hidden>fx</span>
          <span className="sr-only">{t.inspector.key.expression}</span>
        </Badge>
      </span>
    </Tooltip>
  ) : null

  // Working with a row focuses its property everywhere (the timeline highlights it, keyframe
  // paste and "Show in JSON" target it), like clicking a property in After Effects.
  const focusPath = targets[targets.length - 1]?.path
  const rowRef = useRef<HTMLDivElement>(null)
  const focusedHere = useRef(false)
  const focusRow = () => {
    if (!focusPath || pathEquals(useDocument.getState().selection.property, focusPath)) return
    focusedHere.current = true
    focusProperty(focusPath)
  }
  // Focused elsewhere (a property picked in the timeline): bring the row into view, unless
  // keyframes are selected (their editor at the top of the panel has priority).
  const focusedAway = useDocument(
    (s) =>
      !!focusPath &&
      s.selection.keyframes.length === 0 &&
      pathEquals(s.selection.property, focusPath),
  )
  useEffect(() => {
    if (!focusedAway) return
    if (focusedHere.current) focusedHere.current = false
    else rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focusedAway])

  const row = (
    <div
      ref={rowRef}
      onPointerDownCapture={focusRow}
      onFocusCapture={focusRow}
      className={cn(
        'group/row relative isolate',
        keysSelected &&
          'before:absolute before:-inset-x-1.5 before:-inset-y-0.5 before:-z-10 before:rounded-md before:bg-selected',
        className,
      )}
      data-property={targets[0]?.path.join('.')}
    >
      <InspectorRow
        label={label}
        hint={hint}
        alignTop={alignTop}
        leading={
          <KeyButton status={status} onClick={onKey} tooltip={keyTooltip} disabled={disabled} />
        }
        badge={
          fx || badge ? (
            <>
              {fx}
              {badge}
            </>
          ) : undefined
        }
      >
        {/* Text fields keep the browser's own context menu (cut, copy, paste). */}
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onContextMenu={(e) => isEditableTarget(e.target) && e.stopPropagation()}
        >
          {children({ status, tone: toneOf(status), values, write })}
        </div>
      </InspectorRow>
      {status !== 'static' && (
        <div
          className="invisible absolute top-1 isolate flex h-4 items-center bg-surface-1 pl-0.5 group-hover/row:visible"
          style={{ left: `calc(var(--insp-label) - ${fx || badge ? 52 : 28}px)` }}
        >
          {/* Same backdrop as the row so the arrows cover the label cleanly. */}
          {keysSelected && <span className="absolute inset-0 -z-10 bg-selected" aria-hidden />}
          <NavButton icon="prev" label={t.inspector.key.prev} frame={prev} />
          <NavButton icon="next" label={t.inspector.key.next} frame={next} />
        </div>
      )}
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={disabled}>
        {row}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuItem kind="context" icon={DiamondIcon} onSelect={onKey}>
          {status === 'key' ? t.inspector.key.removeKey : t.inspector.key.addKey}
        </MenuItem>
        <MenuItem
          kind="context"
          icon={ChevronLeft}
          disabled={prev === null}
          onSelect={() => prev !== null && setFrame(prev)}
        >
          {t.inspector.key.prev}
        </MenuItem>
        <MenuItem
          kind="context"
          icon={ChevronRight}
          disabled={next === null}
          onSelect={() => next !== null && setFrame(next)}
        >
          {t.inspector.key.next}
        </MenuItem>
        <MenuSeparator kind="context" />
        <MenuItem
          kind="context"
          icon={Trash2}
          disabled={status === 'static'}
          onSelect={() => removeAnimation(t.inspector.history.removeAnimation, targets)}
        >
          {t.inspector.key.removeAnimation}
        </MenuItem>
        {resettable && (
          <MenuItem
            kind="context"
            icon={RotateCcw}
            onSelect={() =>
              editProperties(t.inspector.history.reset(label), targets, (prop, target) => {
                // Keep the stored arity (group transforms are 2-D, layer transforms 3-D).
                const current = readValue(prop, target.frame, fallback)
                const reset = current.map((v, i) => fallback[i] ?? v)
                writeValue(prop, target.frame, reset.length === 1 ? reset[0] : reset)
                if (discrete) holdKeyframes(prop)
              })
            }
          >
            {t.inspector.key.reset}
          </MenuItem>
        )}
        <MenuSeparator kind="context" />
        <MenuItem
          kind="context"
          icon={Braces}
          onSelect={() => targets[0] && emit('reveal-code', { path: targets[0].path })}
        >
          {t.inspector.key.showInJson}
        </MenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function NavButton({
  icon,
  label,
  frame,
}: {
  icon: 'prev' | 'next'
  label: string
  frame: number | null
}) {
  const Icon = icon === 'prev' ? ChevronLeft : ChevronRight
  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        aria-label={label}
        disabled={frame === null}
        onClick={() => frame !== null && setFrame(frame)}
        className="inline-flex h-4 w-3.5 items-center justify-center rounded-xs text-fg-subtle hover:bg-hover hover:text-fg disabled:opacity-30"
      >
        <Icon size={12} />
      </button>
    </Tooltip>
  )
}
