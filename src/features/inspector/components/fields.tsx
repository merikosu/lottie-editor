/**
 * Typed animatable fields built on PropertyRow (scalar, vector, scale, color, position).
 */
import { Link2, Unlink2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ColorField, Switch, Tooltip } from '@/components/ui'
import { NumberField } from './number-field'
import { useDocumentColors } from '@/features/colors'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { AnyProperty } from '@/lottie/property'
import type { PropTarget } from '../edit'
import { commonNumber, decodeColor, encodeColor } from '../model/values'
import { setInspectorPrefs, useInspectorPrefs } from '../state'
import { PropertyRow } from './PropertyRow'
import { ValueGrid } from './Row'

type Props = readonly (AnyProperty | null | undefined)[]

interface NumberOptions {
  unit?: string
  precision?: number
  step?: number
  min?: number
  max?: number
  /** Value change per dragged pixel (defaults to step). */
  scrubSpeed?: number
}

interface BaseProps {
  label: string
  hint?: string
  targets: PropTarget[]
  props: Props
  resettable?: boolean
  disabled?: boolean
  badge?: ReactNode
  /** Discrete value: keyframes are hold keyframes. */
  discrete?: boolean
}

/* -------------------------------------------------------------------------- */
/*                                   Scalar                                   */
/* -------------------------------------------------------------------------- */

export interface ScalarPropertyProps extends BaseProps, NumberOptions {
  fallback?: number
  /** Stretch the field over both value columns. */
  wide?: boolean
  /**
   * Shown value = stored value × scale (e.g. 0–255 shown as a percentage). `min`/`max` apply
   * to the shown value.
   */
  scale?: number
}

export function ScalarProperty({
  fallback = 0,
  unit,
  precision = 1,
  step = 1,
  min,
  max,
  scrubSpeed,
  wide,
  scale = 1,
  ...row
}: ScalarPropertyProps) {
  const shown = commonNumberScaled(scale)
  return (
    <PropertyRow {...row} fallback={[fallback]}>
      {({ values, tone, write }) => (
        <ValueGrid>
          <NumberField
            className={cn(wide && 'col-span-2')}
            value={shown(values.map((v) => v[0]))}
            onChange={(v, g) => write(() => (scale === 1 ? v : roundStored(v / scale)), g)}
            suffix={unit}
            precision={precision}
            step={step}
            min={min}
            max={max}
            scrubSpeed={scrubSpeed}
            tone={tone}
            aria-label={row.label}
            disabled={row.disabled}
          />
        </ValueGrid>
      )}
    </PropertyRow>
  )
}

/** Common value of the targets, multiplied for display (null when they differ). */
function commonNumberScaled(scale: number): (values: number[]) => number | null {
  return (values) => {
    const v = commonNumber(values)
    return v === null || scale === 1 ? v : v * scale
  }
}

/** Stored values of scaled fields keep a few decimals (0.1 % of 255 is 0.255). */
function roundStored(v: number): number {
  return Math.round(v * 1e4) / 1e4
}

/* -------------------------------------------------------------------------- */
/*                                   Vector                                   */
/* -------------------------------------------------------------------------- */

export interface VectorPropertyProps extends BaseProps, NumberOptions {
  fallback: number[]
  /** Number of edited dimensions (others are preserved). */
  dims?: 2 | 3
  /** Short labels inside the fields. */
  axes?: string[]
}

export function VectorProperty({
  fallback,
  dims = 2,
  axes = ['X', 'Y', 'Z'],
  unit,
  precision = 1,
  step = 1,
  min,
  max,
  scrubSpeed,
  ...row
}: VectorPropertyProps) {
  return (
    <PropertyRow {...row} fallback={fallback}>
      {({ values, tone, write }) => (
        <ValueGrid className={dims === 3 ? 'grid-cols-3' : undefined}>
          {Array.from({ length: dims }, (_, d) => (
            <NumberField
              key={d}
              label={axes[d]}
              labelTooltip={`${row.label} ${axes[d]}`}
              value={commonNumber(values.map((v) => v[d]))}
              onChange={(value, g) =>
                write((current) => {
                  const next = [...current]
                  while (next.length <= d) next.push(fallback[next.length] ?? 0)
                  next[d] = value
                  return next
                }, g)
              }
              // Three columns are too narrow for units; the row label names the property.
              suffix={dims === 3 ? undefined : unit}
              precision={precision}
              step={step}
              min={min}
              max={max}
              scrubSpeed={scrubSpeed}
              tone={tone}
              disabled={row.disabled}
              inputClassName="px-1"
            />
          ))}
        </ValueGrid>
      )}
    </PropertyRow>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Scale                                   */
/* -------------------------------------------------------------------------- */

/** Scale with a "constrain proportions" toggle that keeps the X:Y ratio. */
export function ScaleProperty({
  dims = 2,
  ...props
}: Omit<VectorPropertyProps, 'fallback' | 'unit'>) {
  const t = useT()
  const linked = useInspectorPrefs((s) => s.scaleLinked)
  const link = (
    <Tooltip content={t.inspector.props.linkScale} side="left">
      <button
        type="button"
        aria-label={t.inspector.props.linkScale}
        aria-pressed={linked}
        onClick={() => setInspectorPrefs({ scaleLinked: !linked })}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-xs transition-colors duration-100',
          linked ? 'text-accent-text hover:text-accent' : 'text-fg-faint hover:text-fg-muted',
        )}
      >
        {linked ? <Link2 size={12} /> : <Unlink2 size={12} />}
      </button>
    </Tooltip>
  )
  const fallback = [100, 100, 100]
  return (
    <PropertyRow {...props} fallback={fallback} badge={link}>
      {({ values, tone, write }) => (
        <ValueGrid className={dims === 3 ? 'grid-cols-3' : undefined}>
          {Array.from({ length: dims }, (_, d) => (
            <NumberField
              key={d}
              label={['X', 'Y', 'Z'][d]}
              labelTooltip={`${props.label} ${['X', 'Y', 'Z'][d]}`}
              value={commonNumber(values.map((v) => v[d]))}
              onChange={(value, g) =>
                write((current) => {
                  const next = [...current]
                  while (next.length < Math.max(dims, 2)) next.push(100)
                  const old = next[d]
                  next[d] = value
                  if (linked) {
                    for (let o = 0; o < dims; o++) {
                      if (o === d) continue
                      // Keep the ratio; from zero there is no ratio, so follow the edited axis.
                      next[o] = old !== 0 ? (next[o] * value) / old : value
                    }
                  }
                  return next.map((v) => Math.round(v * 1000) / 1000)
                }, g)
              }
              suffix={dims === 3 ? undefined : '%'}
              precision={1}
              step={1}
              tone={tone}
              disabled={props.disabled}
              inputClassName="px-1"
            />
          ))}
        </ValueGrid>
      )}
    </PropertyRow>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Switch                                   */
/* -------------------------------------------------------------------------- */

/** An animatable on/off value stored as 0 or 1 (effect checkboxes); it animates in steps. */
export function SwitchProperty({ fallback = 0, ...row }: BaseProps & { fallback?: number }) {
  const t = useT()
  return (
    <PropertyRow {...row} fallback={[fallback]} discrete>
      {({ values, write }) => {
        const on = values.map((v) => (v[0] ?? 0) >= 0.5)
        const mixed = on.some((v) => v !== on[0])
        return (
          <>
            <Switch
              checked={!mixed && on[0] === true}
              onCheckedChange={(next) => write(() => (next ? 1 : 0))}
              disabled={row.disabled}
              aria-label={row.label}
            />
            {mixed && <span className="text-xs text-fg-subtle">{t.common.mixed}</span>}
          </>
        )
      }}
    </PropertyRow>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Color                                   */
/* -------------------------------------------------------------------------- */

export interface ColorPropertyProps extends BaseProps {
  /** Default color (0..1), 3 or 4 components. */
  fallback?: number[]
  /** Colors stored as 0..255 (legacy bodymovin < 4.1.9 fills and strokes). */
  legacyScale?: boolean
}

/**
 * Fill/stroke/text color. The alpha channel of Lottie colors is ignored by players (opacity
 * is a separate property), so the picker edits RGB and preserves the stored alpha.
 */
export function ColorProperty({
  fallback = [0, 0, 0, 1],
  legacyScale,
  ...row
}: ColorPropertyProps) {
  const swatches = useDocumentColors()
  return (
    <PropertyRow {...row} fallback={fallback}>
      {({ values, write }) => {
        const rgba = values.map((v) => decodeColor(v, legacyScale))
        const same = rgba.every(
          (c) =>
            Math.abs(c.r - rgba[0].r) < 1e-3 &&
            Math.abs(c.g - rgba[0].g) < 1e-3 &&
            Math.abs(c.b - rgba[0].b) < 1e-3,
        )
        return (
          <ColorField
            className="w-full"
            value={same && rgba[0] ? { ...rgba[0], a: 1 } : null}
            alpha={false}
            swatches={swatches}
            disabled={row.disabled}
            onChange={(c, g) =>
              write((current) => {
                const arity = current.length >= 4 ? 4 : 3
                // The stored alpha is kept (players ignore it; opacity is its own property).
                const alpha = decodeColor(current, legacyScale).a
                return encodeColor(c, alpha, arity, legacyScale)
              }, g)
            }
          />
        )
      }}
    </PropertyRow>
  )
}
