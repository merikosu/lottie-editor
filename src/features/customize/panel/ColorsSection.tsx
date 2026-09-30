import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ColorPicker,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Section,
  Tooltip,
  type ChangeGesture,
} from '@/components/ui'
import { useT } from '@/i18n'
import { rgbaToHex, type RGBA } from '@/lib/color'
import {
  adjustColors,
  extractColorUsages,
  groupColors,
  isUsageModified,
  readUsageColor,
  replaceColor,
  restoreColors,
  type ColorGroup,
  type ColorUsage,
} from '@/lottie/colors'
import type { Animation } from '@/lottie/types'
import { getDoc, updateDoc, useDocument } from '@/store/document'
import { useCustomizeUi, useCustomizePrefs } from '../store'
import { BrandColors } from './BrandColors'
import { CenteredSlider } from './CenteredSlider'

/** Swatches shown before "Show all". */
const COLLAPSED_COUNT = 14

const gestureOptions = (g: ChangeGesture) => ({ coalesceKey: g.key, final: g.final })

function Swatch({
  group,
  doc,
  palette,
  onOpenChange,
}: {
  group: ColorGroup
  doc: Animation
  palette: string[]
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const color = readUsageColor(doc, group.sample) ?? group.color
  const opaque = { ...color, a: 1 }
  const hex = rgbaToHex(opaque)
  const label = `${hex.toUpperCase()} · ${t.customize.colors.uses(group.count)}`
  const change = (next: RGBA, g: ChangeGesture) => {
    updateDoc(
      t.customize.history.color,
      (d) => {
        replaceColor(d as Animation, group.usages, { ...next, a: 1 })
      },
      gestureOptions(g),
    )
  }
  return (
    <Popover onOpenChange={onOpenChange}>
      <Tooltip content={label}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="aspect-square w-full rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] outline-offset-2 transition-shadow duration-100 hover:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.25)] aria-expanded:outline-2 aria-expanded:outline-accent dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)] dark:hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)]"
            style={{ background: hex }}
            data-testid="customize-swatch"
          />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="left" align="start" className="p-3">
        <div className="mb-2.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="font-mono text-fg uppercase">{hex}</span>
          <span className="text-fg-subtle">{t.customize.colors.uses(group.count)}</span>
        </div>
        <ColorPicker value={opaque} onChange={change} alpha={false} swatches={palette} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Hue shift of every color. The slider is relative to the colors it started from: each drag is
 * computed from them (one undo step per drag); any other change of the document starts over
 * from the new colors (the slider goes back to 0).
 */
function HueShift({ usages }: { usages: ColorUsage[] }) {
  const t = useT()
  const [hue, setHue] = useState(0)
  const base = useRef<ColorUsage[] | null>(null)
  // True while this slider writes (the store notifies subscribers during the write).
  const writing = useRef(false)

  useEffect(
    () =>
      useDocument.subscribe(
        (s) => s.doc,
        () => {
          if (writing.current) return
          base.current = null
          setHue(0)
        },
      ),
    [writing],
  )

  const change = (value: number, g: ChangeGesture) => {
    base.current ??= usages
    const from = base.current
    setHue(value)
    writing.current = true
    try {
      updateDoc(
        t.customize.history.hue,
        (d) => {
          adjustColors(d as Animation, from, { hue: value })
        },
        gestureOptions(g),
      )
    } finally {
      writing.current = false
    }
  }

  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)_40px] items-center gap-2">
      <Tooltip content={t.customize.colors.hueHint} side="left">
        <span className="truncate text-xs text-fg-muted">{t.customize.colors.hue}</span>
      </Tooltip>
      <CenteredSlider
        value={hue}
        min={-180}
        max={180}
        onChange={change}
        aria-label={t.customize.colors.hue}
      />
      <span className="text-right text-xs text-fg-muted tabular-nums">
        {hue > 0 ? `+${hue}°` : `${hue}°`}
      </span>
    </div>
  )
}

/** The document palette (largest swatches first), brand colors, hue shift and reset. */
export function ColorsSection() {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const original = useDocument((s) => s.original)
  const allColors = useCustomizeUi((s) => s.allColors)
  const brand = useCustomizePrefs((s) => s.brand)
  const usages = useMemo(() => (doc ? extractColorUsages(doc) : []), [doc])
  const groups = useMemo(() => groupColors(usages, { sortBy: 'usage' }), [usages])
  // While a swatch is being edited the palette keeps its order (the edited color must not move).
  const [frozen, setFrozen] = useState<ColorGroup[] | null>(null)
  const shown = frozen ?? groups
  const modified = useMemo(
    () => !!doc && !!original && usages.some((u) => isUsageModified(doc, u, original)),
    [doc, original, usages],
  )
  const palette = useMemo(
    () => [...brand, ...groups.slice(0, 8).map((g) => g.hex)],
    [brand, groups],
  )

  if (!doc) return null
  const visible = allColors ? shown : shown.slice(0, COLLAPSED_COUNT)

  const reset = () => {
    if (!original) return
    updateDoc(t.customize.history.resetColors, (d) => {
      restoreColors(d as Animation, extractColorUsages(getDoc() as Animation), original)
    })
  }

  return (
    <Section
      id="customize.colors"
      title={
        <>
          {t.customize.colors.title}
          {groups.length > 0 && (
            <span className="ml-1.5 font-normal text-fg-subtle tabular-nums">{groups.length}</span>
          )}
        </>
      }
      actions={
        <IconButton
          icon={RotateCcw}
          label={t.customize.colors.reset}
          disabled={!modified}
          onClick={reset}
          data-testid="customize-reset-colors"
        />
      }
      contentClassName="gap-3"
    >
      {groups.length === 0 ? (
        <p className="text-xs text-fg-subtle">{t.customize.colors.empty}</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1.5" data-testid="customize-palette">
            {visible.map((g) => (
              <Swatch
                key={g.sample.id}
                group={g}
                doc={doc}
                palette={palette}
                onOpenChange={(open) => setFrozen(open ? groups : null)}
              />
            ))}
          </div>
          {shown.length > COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => useCustomizeUi.setState({ allColors: !allColors })}
              className="-mt-1 self-start rounded-sm text-xs text-fg-subtle transition-colors duration-100 hover:text-fg"
            >
              {allColors ? t.customize.colors.showFewer : t.customize.colors.showAll(shown.length)}
            </button>
          )}
          <HueShift usages={usages} />
          <BrandColors usages={usages} />
        </>
      )}
    </Section>
  )
}
