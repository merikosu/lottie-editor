import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Button,
  ColorPicker,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { hexToRgba, rgbaToHex, type RGBA } from '@/lib/color'
import type { ColorUsage } from '@/lottie/colors'
import type { Animation } from '@/lottie/types'
import { updateDoc } from '@/store/document'
import { applyBrandPlan, MAX_BRAND_COLORS, planBrandColors, type BrandFamily } from '../lib/brand'
import { setCustomizePrefs, useCustomizePrefs } from '../store'

/** Color used for a new brand slot when the animation has no family left to suggest one. */
const FALLBACK = '#3470e8'

function setBrand(next: string[]): void {
  setCustomizePrefs({ brand: next.slice(0, MAX_BRAND_COLORS) })
}

function Replaces({ family }: { family: BrandFamily | undefined }) {
  const t = useT()
  if (!family)
    return <div className="truncate text-2xs text-fg-faint">{t.customize.brand.unused}</div>
  return (
    <div className="flex min-w-0 items-center gap-1 text-2xs text-fg-subtle">
      <span className="shrink-0">{t.customize.brand.replaces}</span>
      <span className="flex min-w-0 gap-0.5 overflow-hidden">
        {family.colors.slice(0, 5).map((hex) => (
          <span
            key={hex}
            title={hex.toUpperCase()}
            className="size-2.5 shrink-0 rounded-[2px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
            style={{ background: hex }}
          />
        ))}
      </span>
    </div>
  )
}

function Slot({
  index,
  hex,
  family,
  palette,
  open,
  onOpenChange,
}: {
  index: number
  hex: string
  family: BrandFamily | undefined
  palette: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const color = hexToRgba(hex) ?? { r: 0, g: 0, b: 0, a: 1 }
  const change = (c: RGBA) => {
    const brand = [...useCustomizePrefs.getState().brand]
    brand[index] = rgbaToHex(c)
    setBrand(brand)
  }
  const remove = () => setBrand(useCustomizePrefs.getState().brand.filter((_, i) => i !== index))
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="group/slot relative">
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t.customize.brand.slot(index + 1)}
              className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md bg-surface-2 pr-6 pl-1.5 shadow-[inset_0_0_0_1px_var(--le-line)] transition-shadow duration-100 hover:shadow-[inset_0_0_0_1px_var(--le-line-strong)] aria-expanded:shadow-[inset_0_0_0_1px_var(--le-accent)]"
              data-testid="customize-brand-slot"
            >
              <span
                className="size-5 shrink-0 rounded-sm shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
                style={{ background: hex }}
              />
              <span className="truncate font-mono text-xs text-fg uppercase">{hex.slice(1)}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="left" align="start" className="p-3">
            <div className="mb-2.5 text-xs font-semibold text-fg">
              {t.customize.brand.slot(index + 1)}
            </div>
            <ColorPicker value={color} onChange={change} alpha={false} swatches={palette} />
          </PopoverContent>
        </Popover>
        <IconButton
          icon={X}
          size="xs"
          label={t.customize.brand.remove}
          onClick={remove}
          className="absolute top-1.5 right-1 opacity-0 group-hover/slot:opacity-100 focus-visible:opacity-100"
        />
      </div>
      <Replaces family={family} />
    </div>
  )
}

/**
 * Up to three brand colors mapped onto the animation's main color families (see lib/brand.ts),
 * with a preview of what each one replaces. The colors are kept for the next files.
 */
export function BrandColors({ usages }: { usages: ColorUsage[] }) {
  const t = useT()
  const brand = useCustomizePrefs((s) => s.brand)
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const plan = useMemo(
    () =>
      planBrandColors(
        usages,
        brand.map((hex) => hexToRgba(hex) ?? { r: 0, g: 0, b: 0, a: 1 }),
      ),
    [usages, brand],
  )
  const palette = useMemo(() => plan.families.slice(0, 8).map((f) => f.anchor), [plan])

  const add = () => {
    // Start from the color it would replace: nothing changes until the user picks theirs.
    const suggestion = plan.families[brand.length]?.anchor ?? FALLBACK
    setBrand([...brand, suggestion])
    setOpenSlot(brand.length)
  }
  const apply = () => {
    updateDoc(t.customize.history.brand, (d) => {
      applyBrandPlan(d as Animation, usages, plan)
    })
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3" data-testid="customize-brand">
      <div>
        <div className="text-xs font-semibold text-fg">{t.customize.brand.title}</div>
        <p className="mt-0.5 text-xs text-fg-subtle">
          {plan.families.length === 0 ? t.customize.brand.neutralOnly : t.customize.brand.hint}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {brand.map((hex, i) => (
          <Slot
            key={i}
            index={i}
            hex={hex}
            family={plan.families.find((f) => f.brand === i)}
            palette={palette}
            open={openSlot === i}
            onOpenChange={(open) => setOpenSlot(open ? i : null)}
          />
        ))}
        {brand.length < MAX_BRAND_COLORS && (
          <Tooltip content={t.customize.brand.add}>
            <button
              type="button"
              onClick={add}
              aria-label={t.customize.brand.add}
              className={cn(
                'flex h-8 items-center justify-center rounded-md border border-dashed border-line-strong text-fg-subtle',
                'transition-colors duration-100 hover:border-fg-faint hover:text-fg',
              )}
              data-testid="customize-brand-add"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
        )}
      </div>
      {/* Nothing to apply before the first brand color: the button appears with it. */}
      {brand.length > 0 && (
        <Button
          onClick={apply}
          disabled={plan.changes === 0}
          className="w-full"
          data-testid="customize-brand-apply"
        >
          {t.customize.brand.apply}
        </Button>
      )}
    </div>
  )
}
