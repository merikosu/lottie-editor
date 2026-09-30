/**
 * Rows of the colors list. Rows are plain presentational components: the list owns focus,
 * events (delegated), drag and drop and the context menu.
 */
import { ChevronRight, Diamond } from 'lucide-react'
import { memo, type ComponentType, type ReactNode } from 'react'
import type { IconProps } from '@/commands/registry'
import { Badge, ColorSwatch, Tooltip } from '@/components/ui'
import type { Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { isMac } from '@/lib/platform'
import { hexToRgba, type RGBA } from '@/lib/color'
import type { ColorKind, GradientGroup } from '@/lottie/colors'
import { displayHex, GRADIENT_KIND_ICONS, KIND_ICONS, percent } from './format'

/* -------------------------------------------------------------------------- */
/*                                 Row wrapper                                */
/* -------------------------------------------------------------------------- */

interface RowProps {
  index: number
  itemKey: string
  top: number
  height: number
  level: number
  focusable: boolean
  expanded?: boolean
  className?: string
  children: ReactNode
  /** Extra data attributes (anchors, drop targets). */
  data?: Record<string, string | undefined>
  label?: string
}

const withAlpha = (hex: string, a: number): RGBA => ({
  ...(hexToRgba(hex) ?? { r: 0, g: 0, b: 0 }),
  a,
})

/** Absolutely positioned tree item (virtualized list). */
function Row({
  index,
  itemKey,
  top,
  height,
  level,
  focusable,
  expanded,
  className,
  children,
  data,
  label,
}: RowProps) {
  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-expanded={expanded}
      aria-label={label}
      aria-selected={false}
      tabIndex={focusable ? 0 : -1}
      data-index={index}
      data-row-key={itemKey}
      {...data}
      style={{ transform: `translateY(${top}px)`, height }}
      className={cn(
        // No `outline-none` here: in Tailwind 4 it also sets --tw-outline-style, which would hide
        // the focus-visible ring below. Mouse focus shows no outline anyway (base :focus rule).
        'group/row absolute inset-x-0 top-0 flex items-center gap-2 pr-1.5 text-sm select-none',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Hover-revealed disclosure chevron (always visible while expanded). */
function Disclosure({ expanded, label }: { expanded: boolean; label: string }) {
  return (
    <Tooltip content={label} side="left">
      <button
        type="button"
        tabIndex={-1}
        data-action="toggle"
        aria-label={label}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-opacity duration-100 hover:bg-hover hover:text-fg',
          expanded
            ? 'opacity-100'
            : 'opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
        )}
      >
        <ChevronRight
          size={12}
          className={cn('transition-transform duration-100', expanded && 'rotate-90')}
        />
      </button>
    </Tooltip>
  )
}

/** Small kind glyphs (fill, stroke, gradient…, ◇ when animated) with a tooltip listing counts. */
function KindGlyphs({
  kinds,
  animated,
  tooltip,
}: {
  kinds: readonly ColorKind[]
  animated: boolean
  tooltip: string
}) {
  const icons = [...new Set(kinds.map((k) => KIND_ICONS[k]))]
  return (
    <Tooltip content={tooltip} side="left">
      <span className="flex shrink-0 items-center gap-1 text-fg-subtle group-hover/row:text-fg-muted">
        {icons.map((Icon, i) => (
          <Icon key={i} size={12} />
        ))}
        {animated && <Diamond size={10} />}
      </span>
    </Tooltip>
  )
}

function Count({ value }: { value: number }) {
  return (
    <span className="min-w-6 shrink-0 text-right text-xs text-fg-subtle tabular-nums">{value}</span>
  )
}

/* -------------------------------------------------------------------------- */
/*                                    Rows                                    */
/* -------------------------------------------------------------------------- */

interface PositionProps {
  index: number
  itemKey: string
  top: number
  height: number
  focusable: boolean
}

export const SectionHeaderRow = memo(function SectionHeaderRow({
  title,
  count,
  collapsed,
  first,
  ...pos
}: PositionProps & { title: string; count: number; collapsed: boolean; first: boolean }) {
  return (
    <Row
      {...pos}
      level={1}
      expanded={!collapsed}
      label={`${title} ${count}`}
      className={cn('cursor-default gap-1 pl-2 hover:bg-hover', !first && 'border-t border-line')}
    >
      <ChevronRight
        size={12}
        className={cn(
          'shrink-0 text-fg-subtle transition-transform duration-150',
          !collapsed && 'rotate-90',
        )}
      />
      <span className="truncate text-xs font-semibold text-fg">{title}</span>
      <span className="text-xs text-fg-subtle tabular-nums">{count}</span>
    </Row>
  )
})

export interface ColorRowProps extends PositionProps {
  /** Current color (lowercase #rrggbb); primitive props keep untouched rows memoized. */
  hex: string
  /** Alpha of the swatch (checkerboard below 1). */
  swatchAlpha: number
  /** Shared alpha of the usages, shown as a percentage when below 1. */
  alpha?: number
  members: string[]
  kinds: ColorKind[]
  count: number
  animated: boolean
  kindTooltip: string
  expanded: boolean
  editing: boolean
  dragSource: boolean
  dropTarget: boolean
  t: Dict
}

export const ColorRow = memo(function ColorRow({
  hex,
  swatchAlpha,
  alpha,
  members,
  kinds,
  count,
  animated,
  kindTooltip,
  expanded,
  editing,
  dragSource,
  dropTarget,
  t,
  ...pos
}: ColorRowProps) {
  const label = `${displayHex(hex)}, ${t.colors.uses(count)}`
  return (
    <Row
      {...pos}
      level={2}
      expanded={expanded}
      label={label}
      data={{ 'data-color-anchor': pos.itemKey, 'data-drop-key': pos.itemKey }}
      className={cn(
        'pl-3',
        editing ? 'bg-selected text-fg' : 'hover:bg-hover',
        dragSource && 'opacity-40',
        dropTarget && 'bg-accent-subtle shadow-[inset_0_0_0_1px_var(--le-accent)]',
      )}
    >
      <Tooltip content={t.colors.row.editHint(isMac ? '⌥' : 'Alt')} side="left">
        <span className="flex shrink-0">
          <ColorSwatch color={withAlpha(hex, swatchAlpha)} size={20} className="rounded-sm" />
        </span>
      </Tooltip>
      <span className="min-w-0 truncate font-mono text-xs tracking-wide text-fg tabular-nums">
        {displayHex(hex)}
      </span>
      {alpha !== undefined && (
        <span className="shrink-0 text-xs text-fg-subtle tabular-nums">{percent(alpha)}</span>
      )}
      {members.length > 1 && (
        <Tooltip
          content={t.colors.similarHint(members.slice(1).map(displayHex).join(', '))}
          side="left"
        >
          <span>
            <Badge>{t.colors.similar(members.length - 1)}</Badge>
          </span>
        </Tooltip>
      )}
      <span className="flex-1" />
      <KindGlyphs kinds={kinds} animated={animated} tooltip={kindTooltip} />
      <Count value={count} />
      <Disclosure
        expanded={expanded}
        label={expanded ? t.colors.row.collapse : t.colors.row.expand}
      />
    </Row>
  )
})

/** Gradient preview bar (checkerboard behind transparent stops). */
export function GradientBar({ css, className }: { css: string; className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-block shrink-0 overflow-hidden rounded-sm checkerboard-sm',
        className,
      )}
    >
      <span className="absolute inset-0" style={{ background: css }} />
      <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]" />
    </span>
  )
}

export interface GradientRowProps extends PositionProps {
  group: GradientGroup
  css: string
  expanded: boolean
  t: Dict
}

export const GradientRow = memo(function GradientRow({
  group,
  css,
  expanded,
  t,
  ...pos
}: GradientRowProps) {
  const { sample } = group
  const icons = [...new Set(group.kinds.map((k) => GRADIENT_KIND_ICONS[k]))]
  const tooltip = [
    ...group.kinds.map((k) => t.colors.gradientKinds[k]),
    ...group.types.map((type) => t.colors.gradientTypes[type]),
    group.animatedCount ? t.colors.animatedCount(group.animatedCount) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Row
      {...pos}
      level={2}
      expanded={expanded}
      label={`${t.colors.gradientTypes[sample.type]}, ${t.colors.stops(sample.stops.length)}, ${t.colors.uses(group.count)}`}
      className="pl-3 hover:bg-hover"
    >
      <GradientBar css={css} className="h-5 w-16" />
      <span className="min-w-0 truncate text-xs text-fg-muted">
        {t.colors.gradientTypes[sample.type]} · {t.colors.stops(sample.stops.length)}
      </span>
      <span className="flex-1" />
      <Tooltip content={tooltip} side="left">
        <span className="flex shrink-0 items-center gap-1 text-fg-subtle group-hover/row:text-fg-muted">
          {icons.map((Icon, i) => (
            <Icon key={i} size={12} />
          ))}
          {group.animatedCount > 0 && <Diamond size={10} />}
        </span>
      </Tooltip>
      <Count value={group.count} />
      <Disclosure
        expanded={expanded}
        label={expanded ? t.colors.row.hideStops : t.colors.row.showStops}
      />
    </Row>
  )
})

export interface StopRowProps extends PositionProps {
  /** Current color (lowercase #rrggbb). */
  hex: string
  /** Current opacity of the stop. */
  opacity: number
  offset: number
  showAlpha: boolean
  editing: boolean
  t: Dict
}

export const StopRow = memo(function StopRow({
  hex,
  opacity,
  offset,
  showAlpha,
  editing,
  t,
  ...pos
}: StopRowProps) {
  const alpha = showAlpha && opacity < 0.995
  return (
    <Row
      {...pos}
      level={3}
      label={`${displayHex(hex)} ${t.colors.usage.position(percent(offset))}`}
      data={{ 'data-color-anchor': pos.itemKey }}
      className={cn('pl-3', editing ? 'bg-selected text-fg' : 'hover:bg-hover')}
    >
      <Tooltip content={t.colors.usage.position(percent(offset))} side="left">
        <span className="w-9 shrink-0 text-right text-xs text-fg-subtle tabular-nums">
          {percent(offset)}
        </span>
      </Tooltip>
      <ColorSwatch color={withAlpha(hex, opacity)} size={14} className="rounded-xs" />
      <span className="min-w-0 truncate font-mono text-xs tracking-wide text-fg-muted tabular-nums">
        {displayHex(hex)}
      </span>
      {alpha && (
        <span className="shrink-0 text-xs text-fg-subtle tabular-nums">{percent(opacity)}</span>
      )}
    </Row>
  )
})

/**
 * Shortens deep paths but keeps what tells usages apart: the layer, its top-level group (often
 * the meaningful name, e.g. "HEAD") and the nearest parent: "Layer › HEAD › … › Group 2".
 */
function compactTrail(trail: string[]): string[] {
  return trail.length > 3 ? [trail[0], trail[1], '…', trail[trail.length - 1]] : trail
}

export interface UsageRowProps extends PositionProps {
  icon: ComponentType<IconProps>
  crumbs: string[]
  kind: string
  detail: string
  animated: boolean
  hoverTitle: string
}

export const UsageRow = memo(function UsageRow({
  icon: Icon,
  crumbs,
  kind,
  detail,
  animated,
  hoverTitle,
  ...pos
}: UsageRowProps) {
  const leaf = crumbs[crumbs.length - 1] ?? kind
  const trail = compactTrail(crumbs.slice(0, -1))
  return (
    <Row
      {...pos}
      level={3}
      label={`${crumbs.join(' › ')} · ${kind}${detail ? ` · ${detail}` : ''}`}
      className="pl-9 hover:bg-hover"
    >
      <Icon size={12} className="shrink-0 text-fg-subtle" />
      <Tooltip content={hoverTitle} side="left">
        <span className="min-w-0 flex-1 truncate text-xs">
          {trail.length > 0 && <span className="text-fg-subtle">{trail.join(' › ')} › </span>}
          <span className="text-fg-muted">{leaf}</span>
        </span>
      </Tooltip>
      {animated && <Diamond size={10} className="shrink-0 text-fg-subtle" />}
      {detail && (
        <span className="shrink-0 pr-1 text-xs text-fg-subtle tabular-nums">{detail}</span>
      )}
    </Row>
  )
})
