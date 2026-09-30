/**
 * Canvas background picker: four preview tiles (checkerboard, dark, light, custom) and a color
 * picker for the custom color. A viewing aid only; nothing is written to the file.
 */
import { Pipette } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import type { CSSProperties } from 'react'
import { ColorPicker, Kbd, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { contrastingFg, hexToRgba, rgbaToHex } from '@/lib/color'
import { setPrefs, usePrefs, type CanvasBackground } from '@/store/prefs'
import { BACKGROUNDS, backgroundColor } from '../backgrounds'

/** The artboard's checkerboard (theme colors) at a smaller square size. */
function checkerStyle(square: number): CSSProperties {
  const b = 'var(--le-checker-b)'
  return {
    backgroundColor: 'var(--le-checker-a)',
    backgroundImage: `linear-gradient(45deg, ${b} 25%, transparent 25%), linear-gradient(-45deg, ${b} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${b} 75%), linear-gradient(-45deg, transparent 75%, ${b} 75%)`,
    backgroundSize: `${square * 2}px ${square * 2}px`,
    backgroundPosition: `0 0, 0 ${square}px, ${square}px -${square}px, -${square}px 0`,
  }
}

/** Miniature of a background mode (checker pattern or solid color) with a hairline. */
export function BackgroundSwatch({
  mode,
  custom,
  square = 4,
  className,
}: {
  mode: CanvasBackground
  custom: string
  /** Checker square size in px. */
  square?: number
  className?: string
}) {
  const color = backgroundColor(mode, custom)
  return (
    <span
      aria-hidden
      className={cn('relative block shrink-0 overflow-hidden', className)}
      style={color ? { backgroundColor: color } : checkerStyle(square)}
    >
      <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.16)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)]" />
    </span>
  )
}

export function BackgroundPicker() {
  const t = useT()
  const mode = usePrefs((s) => s.canvasBackground)
  const custom = usePrefs((s) => s.canvasColor)
  const customRgba = hexToRgba(custom) ?? { r: 1, g: 1, b: 1, a: 1 }
  // The custom tile is marked with a pipette readable on the chosen color.
  const customFg =
    contrastingFg(customRgba) === '#000000' ? 'rgb(0 0 0 / 0.55)' : 'rgb(255 255 255 / 0.75)'

  return (
    <Popover>
      <Tooltip content={t.viewport.background} shortcut="shift+b">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t.viewport.background}
            data-testid="background-picker"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-100 hover:bg-hover data-[state=open]:bg-hover"
          >
            <BackgroundSwatch
              mode={mode}
              custom={custom}
              square={3.5}
              className="size-3.5 rounded-xs"
            />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[264px] p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">{t.viewport.background}</span>
          <Kbd shortcut="shift+b" />
        </div>
        <RadioGroup.Root
          value={mode}
          onValueChange={(v) => setPrefs({ canvasBackground: v as CanvasBackground })}
          aria-label={t.viewport.background}
          className="grid grid-cols-4 gap-1.5"
        >
          {BACKGROUNDS.map((bg) => {
            const active = bg === mode
            return (
              <RadioGroup.Item
                key={bg}
                value={bg}
                data-testid={`background-${bg}`}
                className="group flex min-w-0 flex-col items-center gap-1.5 rounded-md outline-offset-2"
              >
                <span className="relative w-full">
                  <BackgroundSwatch
                    mode={bg}
                    custom={custom}
                    square={6}
                    className={cn(
                      'h-9 w-full rounded-md transition-shadow duration-100',
                      active
                        ? 'shadow-[0_0_0_2px_var(--le-surface-3),0_0_0_4px_var(--le-accent)]'
                        : 'group-hover:shadow-[0_0_0_2px_var(--le-surface-3),0_0_0_3px_var(--le-line-strong)]',
                    )}
                  />
                  {bg === 'custom' && (
                    <Pipette
                      size={14}
                      aria-hidden
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                      style={{ color: customFg }}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    'max-w-full truncate text-xs',
                    active ? 'text-fg' : 'text-fg-subtle group-hover:text-fg-muted',
                  )}
                >
                  {t.viewport.backgrounds[bg]}
                </span>
              </RadioGroup.Item>
            )
          })}
        </RadioGroup.Root>
        {mode === 'custom' && (
          // The preview background is opaque: no alpha.
          <div className="mt-3 flex justify-center border-t border-line pt-3">
            <ColorPicker
              value={customRgba}
              alpha={false}
              onChange={(c) => setPrefs({ canvasColor: rgbaToHex(c) })}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
