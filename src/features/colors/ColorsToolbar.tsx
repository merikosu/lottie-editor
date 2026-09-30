/**
 * Colors panel toolbar: scope (Document / Selection), sort order, "merge similar" and the
 * overflow menu (copy palette, reset colors).
 */
import {
  ArrowDownWideNarrow,
  Blend,
  Braces,
  Ellipsis,
  Hash,
  Palette,
  Rainbow,
  RotateCcw,
  Variable,
} from 'lucide-react'
import { ToggleGroup } from 'radix-ui'
import { useMemo, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  Switch,
  Tooltip,
} from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatDecimal } from '@/lib/format'
import {
  groupColors,
  type ColorGroup,
  type ColorSort,
  type ColorUsage,
  type GradientGroup,
} from '@/lottie/colors'
import { copyWithFlash, hasModifiedUsages, resetUsages, unifyGroups } from './actions'
import { formatPalette, type PaletteFormat } from './palette-export'
import {
  setColorsPrefs,
  TOLERANCE_MAX,
  TOLERANCE_MIN,
  useColorsPrefs,
  type ColorScope,
} from './store'
import { latestUsages } from './useColorData'

export interface ColorsToolbarProps {
  scope: ColorScope
  hasSelection: boolean
  usages: ColorUsage[]
  colorGroups: ColorGroup[]
  gradientGroups: GradientGroup[]
}

export function ColorsToolbar({
  scope,
  hasSelection,
  usages,
  colorGroups,
  gradientGroups,
}: ColorsToolbarProps) {
  // Sorting and merging have nothing to act on in an empty list.
  const empty = colorGroups.length === 0 && gradientGroups.length === 0
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-2">
      <ScopeSwitch scope={scope} hasSelection={hasSelection} />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <SortMenu disabled={empty} />
        <MergeSimilar usages={usages} disabled={empty} />
        <OverflowMenu
          scope={scope}
          usages={usages}
          colorGroups={colorGroups}
          gradientGroups={gradientGroups}
        />
      </div>
    </div>
  )
}

/* ---------------------------------- Scope ---------------------------------- */

// As the foundation's SegmentedControl (which cannot wrap a disabled segment in a tooltip), a
// little tighter so both Russian labels fit the narrowest sidebar.
const segmentClass = cn(
  'inline-flex h-full min-w-0 items-center justify-center rounded-sm px-1.5 text-sm font-medium text-fg-subtle transition-colors duration-100 hover:text-fg disabled:pointer-events-none disabled:opacity-40',
  'data-[state=on]:bg-surface-1 data-[state=on]:text-fg data-[state=on]:shadow-thumb dark:data-[state=on]:bg-surface-3',
)

/** Segmented Document / Selection switch; Selection explains itself while unavailable. */
function ScopeSwitch({ scope, hasSelection }: { scope: ColorScope; hasSelection: boolean }) {
  const t = useT()
  return (
    <ToggleGroup.Root
      type="single"
      value={scope}
      // Clicking the segment that is already on reports '' (it would turn off): it still sets
      // the preference, e.g. "Document" shown while "Selection" waits for a selection.
      onValueChange={(v) => setColorsPrefs({ scope: (v || scope) as ColorScope })}
      aria-label={t.colors.scope.label}
      className="inline-flex h-6 min-w-0 shrink items-center gap-0.5 rounded-md bg-surface-2 p-0.5"
      data-testid="colors-scope"
    >
      <ToggleGroup.Item value="document" className={segmentClass}>
        <span className="truncate">{t.colors.scope.document}</span>
      </ToggleGroup.Item>
      <Tooltip content={hasSelection ? undefined : t.colors.scope.selectionHint}>
        {/* The wrapper keeps the tooltip working while the segment is disabled. */}
        <span className="inline-flex h-full min-w-0">
          <ToggleGroup.Item value="selection" disabled={!hasSelection} className={segmentClass}>
            <span className="truncate">{t.colors.scope.selection}</span>
          </ToggleGroup.Item>
        </span>
      </Tooltip>
    </ToggleGroup.Root>
  )
}

/* ---------------------------------- Sort ----------------------------------- */

function SortMenu({ disabled }: { disabled: boolean }) {
  const t = useT()
  const sortBy = useColorsPrefs((s) => s.sortBy)
  return (
    <DropdownMenu>
      <Tooltip content={sortBy === 'hue' ? t.colors.sort.sortedByHue : t.colors.sort.sortedByUsage}>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={sortBy === 'hue' ? Rainbow : ArrowDownWideNarrow}
            label={t.colors.sort.label}
            tooltip={false}
            disabled={disabled}
            data-testid="colors-sort"
          />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <MenuRadioGroup
          value={sortBy}
          onValueChange={(v) => setColorsPrefs({ sortBy: v as ColorSort })}
        >
          <MenuRadioItem value="usage">{t.colors.sort.usage}</MenuRadioItem>
          <MenuRadioItem value="hue">{t.colors.sort.hue}</MenuRadioItem>
        </MenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ------------------------------ Merge similar ------------------------------ */

function MergeSimilar({ usages, disabled }: { usages: ColorUsage[]; disabled: boolean }) {
  const t = useT()
  const enabled = useColorsPrefs((s) => s.mergeSimilar)
  const tolerance = useColorsPrefs((s) => s.tolerance)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={t.colors.merge.button}>
        <PopoverTrigger asChild>
          <IconButton
            icon={Blend}
            label={t.colors.merge.button}
            tooltip={false}
            active={enabled}
            disabled={disabled}
            data-testid="colors-merge"
          />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="flex flex-col gap-3 p-3">
          <label className="flex items-center gap-2">
            <span className="flex-1 text-sm font-medium text-fg">{t.colors.merge.title}</span>
            <Switch
              checked={enabled}
              onCheckedChange={(mergeSimilar) => setColorsPrefs({ mergeSimilar })}
              aria-label={t.colors.merge.title}
            />
          </label>
          <p className="text-xs text-fg-subtle">{t.colors.merge.description}</p>
          <div className={cn('flex flex-col gap-1.5', !enabled && 'opacity-40')}>
            <div className="flex items-center justify-between text-xs">
              <Tooltip content={t.colors.merge.toleranceHint} side="left">
                <span className="text-fg-muted">{t.colors.merge.tolerance}</span>
              </Tooltip>
              <span className="text-fg tabular-nums">ΔE {formatDecimal(tolerance, 1)}</span>
            </div>
            <Slider
              value={tolerance}
              min={TOLERANCE_MIN}
              max={TOLERANCE_MAX}
              step={0.5}
              disabled={!enabled}
              aria-label={t.colors.merge.tolerance}
              onChange={(v) => setColorsPrefs({ tolerance: v })}
            />
          </div>
        </div>
        {open && <MergePreview usages={usages} tolerance={tolerance} />}
      </PopoverContent>
    </Popover>
  )
}

/**
 * "41 → 33 swatches" at the current tolerance (computed only while the popover is open); while
 * merging is off it previews what turning it on would do.
 */
function MergePreview({ usages, tolerance }: { usages: ColorUsage[]; tolerance: number }) {
  const t = useT()
  const [from, to] = usePreviewCounts(usages, tolerance)
  return (
    <div className="border-t border-line px-3 py-2 text-xs text-fg-subtle tabular-nums">
      {t.colors.merge.result(from, to)}
    </div>
  )
}

function usePreviewCounts(usages: ColorUsage[], tolerance: number): [number, number] {
  return useMemo(
    () => [groupColors(usages).length, groupColors(usages, { mergeSimilar: tolerance }).length],
    [usages, tolerance],
  )
}

/* -------------------------------- Overflow --------------------------------- */

function OverflowMenu({
  scope,
  usages,
  colorGroups,
  gradientGroups,
}: {
  scope: ColorScope
  usages: ColorUsage[]
  colorGroups: ColorGroup[]
  gradientGroups: GradientGroup[]
}) {
  const t = useT()
  const mergeOn = useColorsPrefs((s) => s.mergeSimilar)
  const [modified, setModified] = useState(false)
  const merged = colorGroups.filter((g) => g.members.length > 1)
  const similarCount = merged.reduce((n, g) => n + g.members.length - 1, 0)
  const copy = (format: PaletteFormat) =>
    void copyWithFlash(
      formatPalette(colorGroups, gradientGroups, format),
      t.colors.flash.copiedPalette(colorGroups.length),
    )
  return (
    <DropdownMenu onOpenChange={(open) => open && setModified(hasModifiedUsages(usages))}>
      <Tooltip content={t.colors.menu.more}>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={Ellipsis}
            label={t.colors.menu.more}
            tooltip={false}
            data-testid="colors-more"
          />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <MenuSub
          label={t.colors.menu.copyPalette}
          icon={Palette}
          disabled={colorGroups.length === 0}
        >
          <MenuItem icon={Hash} onSelect={() => copy('hex')}>
            {t.colors.menu.asHex}
          </MenuItem>
          <MenuItem icon={Variable} onSelect={() => copy('css')}>
            {t.colors.menu.asCss}
          </MenuItem>
          <MenuItem icon={Braces} onSelect={() => copy('json')}>
            {t.colors.menu.asJson}
          </MenuItem>
        </MenuSub>
        {mergeOn && (
          <MenuItem
            icon={Blend}
            disabled={similarCount === 0}
            onSelect={() =>
              unifyGroups(merged.map((g) => ({ ...g, usages: latestUsages(g.usages) })))
            }
          >
            {t.colors.menu.unifyAll(similarCount)}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={RotateCcw} disabled={!modified} onSelect={() => resetUsages(usages)}>
          {scope === 'selection' ? t.colors.menu.resetSelection : t.colors.menu.resetAll}
        </MenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
