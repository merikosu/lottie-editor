/**
 * Compact document palette for the inspector's document view (nothing selected): the most used
 * colors as swatches; clicking one replaces it everywhere.
 */
import { ClipboardCopy, MousePointer2, PanelRightOpen, Pencil, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  ColorSwatch,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
  Section,
  Tooltip,
} from '@/components/ui'
import { useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import type { RGBA } from '@/lib/color'
import {
  colorToRgb8,
  groupColors,
  readUsageColor,
  rgb8ToHex,
  type ColorGroup,
  type ColorUsage,
} from '@/lottie/colors'
import type { Animation } from '@/lottie/types'
import { getDoc, useDocument } from '@/store/document'
import {
  clearHighlight,
  copyWithFlash,
  hasModifiedUsages,
  highlightUsages,
  resetUsages,
  selectLayersOf,
  showColorsPanel,
} from './actions'
import { ColorEditPopover, type EditTarget } from './ColorEditor'
import { FlashMessage } from './FlashMessage'
import { displayHex, kindSummary } from './format'
import { latestUsages, useColorScan } from './useColorData'

const MAX_SWATCHES = 16

// Keyed by the sample usage so a swatch keeps its identity (and the popover its anchor) while
// its color changes.
const sectionKey = (group: ColorGroup) => `doc:${group.sample.id}`

/** Current color of a group (the list may be frozen while one of its colors is edited). */
const liveColor = (doc: Animation | null, group: ColorGroup): RGBA =>
  (doc && readUsageColor(doc, group.sample)) || group.color

const hexOf = (color: RGBA) => `#${displayHex(rgb8ToHex(colorToRgb8(color)))}`

/** The usages the grid was grouped from when an edit started. */
interface Frozen {
  colors: ColorUsage[]
  docId: string | null
}

export function DocumentColorsSection() {
  const t = useT()
  const scan = useColorScan()
  const docId = useDocument((s) => s.meta?.id ?? null)
  const [frozenState, setFrozen] = useState<Frozen | null>(null)
  const [editingState, setEditing] = useState<EditTarget | null>(null)
  // Opening another document ends any edit that belonged to the previous one.
  const editing = editingState && editingState.docId === docId ? editingState : null
  const frozen = frozenState && frozenState.docId === docId ? frozenState : null
  // While a swatch is edited the grid keeps its order (and is not regrouped for every live edit).
  const source = frozen?.colors ?? scan.colors
  const live = useMemo(() => groupColors(source), [source])
  const [menuGroup, setMenuGroup] = useState<ColorGroup | null>(null)
  // Selecting something replaces the document view under the pointer (no leave event).
  useEffect(() => () => clearHighlight(), [])
  const doc = useDocument((s) => s.doc)
  const groups = live
  const shown = groups.slice(0, MAX_SWATCHES)
  const more = groups.length - shown.length

  const edit = (group: ColorGroup) => {
    const latest = getDoc()
    const usages = latestUsages(group.usages)
    const [sample] = latestUsages([group.sample])
    if (!latest || usages.length === 0 || !sample) return
    const current = readUsageColor(latest, sample) ?? group.color
    setFrozen((f) => f ?? { colors: source, docId })
    setEditing({
      docId,
      key: sectionKey(group),
      usages,
      sample,
      color: { ...current, a: 1 },
      alpha: false,
      title: t.colors.picker.replaceTitle,
      subtitle: t.colors.usesInLayers(group.count, group.layerCount),
      label: t.colors.history.replace,
    })
  }

  return (
    <Section
      id="doc-colors"
      title={
        <span className="flex items-baseline gap-1.5">
          {t.colors.title}
          {groups.length > 0 && (
            <span className="font-normal text-fg-subtle tabular-nums">{groups.length}</span>
          )}
        </span>
      }
      actions={
        <IconButton
          icon={PanelRightOpen}
          label={t.colors.section.openPanel}
          onClick={showColorsPanel}
        />
      }
    >
      {groups.length === 0 ? (
        <div className="text-xs text-fg-subtle">{t.colors.section.none}</div>
      ) : (
        <div className="relative">
          <ContextMenu onOpenChange={(open) => !open && setMenuGroup(null)}>
            <ContextMenuTrigger asChild>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="doc-colors"
                onPointerLeave={clearHighlight}
              >
                {shown.map((group) => {
                  const current = liveColor(doc, group)
                  const hex = hexOf(current)
                  const key = sectionKey(group)
                  return (
                    <Tooltip
                      key={key}
                      content={`${hex} · ${kindSummary(group.usages, t, group.layerCount)}`}
                    >
                      <button
                        type="button"
                        data-color-anchor={key}
                        aria-label={`${hex}, ${t.colors.uses(group.count)}`}
                        onClick={() => edit(group)}
                        onPointerEnter={() => highlightUsages(group.usages)}
                        onFocus={() => highlightUsages(group.usages)}
                        onBlur={clearHighlight}
                        onContextMenu={() => setMenuGroup(group)}
                        className={cn(
                          'group/swatch relative rounded-sm outline-offset-2 transition-shadow duration-100',
                          editing?.key === key
                            ? 'shadow-[0_0_0_1.5px_var(--le-surface-1),0_0_0_3px_var(--le-accent)]'
                            : 'hover:shadow-[0_0_0_1.5px_var(--le-surface-1),0_0_0_3px_var(--le-line-strong)]',
                        )}
                      >
                        <ColorSwatch
                          color={{ ...current, a: group.color.a }}
                          size={24}
                          className="rounded-sm"
                        />
                        <span className="pointer-events-none absolute -top-1.5 -right-1.5 hidden h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface-3 px-1 text-2xs leading-none font-medium text-fg-muted tabular-nums shadow-popover group-hover/swatch:flex">
                          {group.count}
                        </span>
                      </button>
                    </Tooltip>
                  )
                })}
                {more > 0 && (
                  <Tooltip content={t.colors.section.moreHint(more)}>
                    <button
                      type="button"
                      onClick={showColorsPanel}
                      className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm bg-surface-2 px-1.5 text-xs text-fg-muted tabular-nums hover:bg-hover hover:text-fg"
                    >
                      {t.colors.section.more(more)}
                    </button>
                  </Tooltip>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-[220px]">
              {menuGroup && (
                <SwatchMenu
                  group={menuGroup}
                  hex={hexOf(liveColor(doc, menuGroup))}
                  t={t}
                  // Opened after the menu has closed and returned focus, which would dismiss it.
                  onEdit={() => setTimeout(() => edit(menuGroup), 0)}
                />
              )}
            </ContextMenuContent>
          </ContextMenu>
          <FlashMessage className="-bottom-1" />
        </div>
      )}
      <ColorEditPopover
        target={editing}
        onClose={() => {
          setEditing(null)
          setFrozen(null)
          if (getDoc()) clearHighlight()
        }}
      />
    </Section>
  )
}

interface SwatchMenuProps {
  group: ColorGroup
  /** Current hex of the group ("#RRGGBB"). */
  hex: string
  t: Dict
  onEdit: () => void
}

function SwatchMenu({ group, hex, t, onEdit }: SwatchMenuProps) {
  return (
    <>
      <MenuItem kind="context" icon={Pencil} onSelect={onEdit}>
        {t.colors.context.replace}
      </MenuItem>
      <MenuItem
        kind="context"
        icon={ClipboardCopy}
        onSelect={() => void copyWithFlash(hex, t.colors.flash.copied(hex))}
      >
        {t.colors.context.copyHex(hex)}
      </MenuItem>
      <MenuItem kind="context" icon={MousePointer2} onSelect={() => selectLayersOf(group.usages)}>
        {t.colors.context.selectLayers}
      </MenuItem>
      <MenuSeparator kind="context" />
      <MenuItem
        kind="context"
        icon={RotateCcw}
        disabled={!hasModifiedUsages(group.usages)}
        onSelect={() => resetUsages(latestUsages(group.usages))}
      >
        {t.colors.context.reset}
      </MenuItem>
    </>
  )
}
