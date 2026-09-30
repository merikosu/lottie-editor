import { Pipette } from 'lucide-react'
import { useRef, useState } from 'react'
import { RgbaColorPicker, RgbColorPicker } from 'react-colorful'
import { cn } from '@/lib/cn'
import { hexToRgba, rgbaToHex, type RGBA } from '@/lib/color'
import { roundTo } from '@/lib/math'
import { uid } from '@/lib/id'
import { pushRecentColor, usePrefs } from '@/store/prefs'
import { useT } from '@/i18n'
import type { ChangeGesture } from './gesture'
import { fieldFrame, fieldSizes, type FieldSize } from './field'
import { NumberField } from './number-field'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Tooltip } from './tooltip'

type Rgba255 = { r: number; g: number; b: number; a: number }
const to255 = (c: RGBA): Rgba255 => ({
  r: Math.round(c.r * 255),
  g: Math.round(c.g * 255),
  b: Math.round(c.b * 255),
  a: c.a,
})
const from255 = (c: Rgba255): RGBA => ({ r: c.r / 255, g: c.g / 255, b: c.b / 255, a: c.a })

interface EyeDropperResult {
  sRGBHex: string
}
declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<EyeDropperResult> }
  }
}

/** Color swatch with a checkerboard behind translucent colors. */
export function ColorSwatch({
  color,
  size = 16,
  className,
  title,
}: {
  color: RGBA | string
  size?: number
  className?: string
  title?: string
}) {
  const rgba = typeof color === 'string' ? (hexToRgba(color) ?? { r: 0, g: 0, b: 0, a: 1 }) : color
  const css = `rgba(${Math.round(rgba.r * 255)}, ${Math.round(rgba.g * 255)}, ${Math.round(rgba.b * 255)}, ${rgba.a})`
  return (
    <span
      title={title}
      className={cn(
        'relative inline-block shrink-0 overflow-hidden rounded-xs checkerboard-sm',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0" style={{ background: css }} />
      <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]" />
    </span>
  )
}

export interface ColorPickerProps {
  value: RGBA
  onChange: (value: RGBA, gesture: ChangeGesture) => void
  /** Show the alpha slider and input. */
  alpha?: boolean
  /** Extra swatches (e.g. the document palette). */
  swatches?: string[]
}

/** Saturation/hue/alpha picker with hex input, eyedropper and swatches. */
export function ColorPicker({ value, onChange, alpha = true, swatches = [] }: ColorPickerProps) {
  const t = useT()
  const recent = usePrefs((s) => s.recentColors)
  const gestureKey = useRef<string | null>(null)
  const last = useRef(value)
  // Hex being typed; null when not editing.
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const hex = hexDraft ?? rgbaToHex(value)

  const emit = (c: RGBA, final: boolean) => {
    if (!gestureKey.current) gestureKey.current = uid('color')
    last.current = c
    onChange(c, { key: gestureKey.current, final })
    if (final) {
      pushRecentColor(rgbaToHex(c))
      gestureKey.current = null
    }
  }

  const pickFromScreen = async () => {
    if (!window.EyeDropper) return
    try {
      const res = await new window.EyeDropper().open()
      const c = hexToRgba(res.sRGBHex)
      if (c) emit({ ...c, a: value.a }, true)
    } catch {
      /* cancelled */
    }
  }

  const palette = [...new Set([...swatches.map((s) => s.toLowerCase()), ...recent])].slice(0, 24)

  return (
    <div className="flex w-[232px] flex-col gap-3">
      <div
        className="le-color-picker"
        onPointerUp={() => {
          if (gestureKey.current) emit(last.current, true)
        }}
      >
        {alpha ? (
          <RgbaColorPicker color={to255(value)} onChange={(c) => emit(from255(c), false)} />
        ) : (
          <RgbColorPicker
            color={to255(value)}
            onChange={(c) => emit(from255({ ...c, a: value.a }), false)}
          />
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div className={cn(fieldFrame, fieldSizes.sm, 'flex-1')}>
          <span className="pl-2 text-xs text-fg-faint">#</span>
          <input
            aria-label={t.common.hexColor}
            value={hex.replace('#', '')}
            spellCheck={false}
            onChange={(e) =>
              setHexDraft(`#${e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 8)}`)
            }
            onBlur={() => {
              const c = hexDraft === null ? null : hexToRgba(hexDraft)
              if (c && hexDraft)
                emit({ ...c, a: hexDraft.replace('#', '').length === 8 ? c.a : value.a }, true)
              setHexDraft(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className="h-full w-full min-w-0 bg-transparent px-1 font-mono text-sm uppercase outline-none"
          />
        </div>
        {alpha && (
          <NumberField
            className="w-[64px]"
            value={roundTo(value.a * 100, 0)}
            min={0}
            max={100}
            precision={0}
            suffix="%"
            aria-label={t.common.opacity}
            onChange={(v, g) => {
              const c = { ...value, a: v / 100 }
              last.current = c
              onChange(c, g)
            }}
          />
        )}
        {typeof window !== 'undefined' && window.EyeDropper && (
          <Tooltip content={t.common.eyedropper}>
            <button
              type="button"
              onClick={pickFromScreen}
              className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              aria-label={t.common.eyedropper}
            >
              <Pipette size={14} />
            </button>
          </Tooltip>
        )}
      </div>
      {palette.length > 0 && (
        <div className="grid grid-cols-8 gap-1.5">
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              className="rounded-xs outline-offset-1"
              onClick={() => {
                const rgba = hexToRgba(c)
                if (rgba) emit({ ...rgba, a: value.a }, true)
              }}
              aria-label={c}
            >
              <ColorSwatch color={c} size={22} title={c.toUpperCase()} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface ColorFieldProps {
  value: RGBA | null
  onChange: (value: RGBA, gesture: ChangeGesture) => void
  alpha?: boolean
  swatches?: string[]
  size?: FieldSize
  disabled?: boolean
  className?: string
  /** Show the hex text next to the swatch. */
  showHex?: boolean
}

/** Swatch + hex field that opens a ColorPicker popover. */
export function ColorField({
  value,
  onChange,
  alpha = true,
  swatches,
  size = 'sm',
  disabled,
  className,
  showHex = true,
}: ColorFieldProps) {
  const t = useT()
  // Hex being typed; null when not editing.
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const hexText = hexDraft ?? (value ? rgbaToHex(value).slice(1).toUpperCase() : '')

  const commitHex = () => {
    const c = hexDraft === null ? null : hexToRgba(hexDraft)
    setHexDraft(null)
    if (c && value) onChange({ ...c, a: value.a }, { key: uid('hex'), final: true })
    else if (c) onChange(c, { key: uid('hex'), final: true })
  }

  return (
    <div
      className={cn(fieldFrame, fieldSizes[size], 'gap-1.5 pl-1', className)}
      aria-disabled={disabled || undefined}
    >
      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            className="flex shrink-0 items-center rounded-xs"
            aria-label={t.common.color}
          >
            <ColorSwatch color={value ?? { r: 0, g: 0, b: 0, a: 0 }} size={16} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="p-3">
          {value && (
            <ColorPicker value={value} onChange={onChange} alpha={alpha} swatches={swatches} />
          )}
        </PopoverContent>
      </Popover>
      {showHex && (
        <input
          aria-label={t.common.hexColor}
          value={value ? hexText : ''}
          placeholder={value ? undefined : t.common.mixed}
          spellCheck={false}
          onFocus={(e) => {
            setHexDraft(hexText)
            e.target.select()
          }}
          onChange={(e) =>
            setHexDraft(
              e.target.value
                .replace(/[^0-9a-f#]/gi, '')
                .replace('#', '')
                .slice(0, 6),
            )
          }
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setHexDraft(null)
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
            }
          }}
          className="h-full w-full min-w-0 bg-transparent font-mono text-sm uppercase outline-none placeholder:font-sans placeholder:text-fg-faint placeholder:normal-case"
        />
      )}
      {alpha && value && value.a < 1 && showHex && (
        <span className="pr-1.5 text-xs text-fg-subtle tabular-nums">
          {Math.round(value.a * 100)}%
        </span>
      )}
    </div>
  )
}
