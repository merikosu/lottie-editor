/**
 * One 28px row of the layer tree. Rendering only: pointer/keyboard logic lives in the tree
 * (event delegation), so rows stay cheap and memoizable.
 */
import {
  ChevronRight,
  CircleDashed,
  CircleDot,
  Contrast,
  Eclipse,
  Eye,
  EyeOff,
  Link2,
  Link2Off,
  Lock,
  LockOpen,
} from 'lucide-react'
import { Tooltip as RadixTooltip } from 'radix-ui'
import { memo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Tooltip } from '@/components/ui'
import type { IconProps } from '@/commands/registry'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { ROW_HEIGHT, contentLeft, rowTop } from './layout'
import { NodeIcon } from './NodeIcon'
import type { TreeRow } from './tree-model'

/** Track matte summary of a layer row. */
export interface RowMatte {
  role: 'target' | 'source'
  /** Matte type of targets: 1 alpha, 2 inverted alpha, 3 luma, 4 inverted luma. */
  type: number
  label: string
  missing?: boolean
}

export interface RowActions {
  /** `deep`: also expand/collapse everything below (⌥-click). */
  toggleExpand: (row: TreeRow, deep: boolean) => void
  toggleHidden: (row: TreeRow) => void
  toggleLocked: (row: TreeRow) => void
  /**
   * Press on the eye or lock toggle: toggles the row, then gives every row the pointer sweeps
   * over the same state (After Effects / Figma "swipe" over the switches).
   */
  swipe: (row: TreeRow, what: 'hidden' | 'locked', e: PointerEvent) => void
  toggleSolo: (row: TreeRow) => void
  commitRename: (row: TreeRow, name: string) => void
  /** Tab / ⇧Tab while renaming: commit and rename the next / previous row. */
  renameNext: (row: TreeRow, name: string, step: 1 | -1) => void
  cancelRename: () => void
  selectParentOf: (row: TreeRow) => void
  hoverParentOf: (row: TreeRow | null) => void
}

export interface LayerRowProps {
  row: TreeRow
  index: number
  /** 0 not selected, 1 selected, 2 primary selection. */
  selected: 0 | 1 | 2
  /** The neighbouring rows are selected too (their highlights merge). */
  joinTop: boolean
  joinBottom: boolean
  focused: boolean
  /** Hovered on the canvas or timeline. */
  hovered: boolean
  renaming: boolean
  locked: boolean
  lockedByParent: boolean
  soloed: boolean
  /** Another layer of its composition (or of an enclosing one) is soloed: not in the preview. */
  soloHidden: boolean
  dragged: boolean
  dropInside: boolean
  /** Precomp layers: number of layers using the same composition. */
  usage: number
  parentLabel: string | null
  parentMissing: boolean
  matte: RowMatte | null
  actions: RowActions
}

function Highlight({ name, match }: { name: string; match: TreeRow['match'] }) {
  if (!match) return <>{name}</>
  return (
    <>
      {name.slice(0, match[0])}
      <mark className="rounded-[2px] bg-accent-subtle [box-decoration-break:clone] text-accent-text">
        {name.slice(match[0], match[1])}
      </mark>
      {name.slice(match[1])}
    </>
  )
}

/** Name with a tooltip that only opens when the text is truncated. */
function RowName({
  name,
  match,
  className,
  interactive,
}: {
  name: string
  match: TreeRow['match']
  className?: string
  interactive: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  if (!interactive) {
    return (
      <span data-row-name="" className={cn('min-w-0 flex-1 truncate', className)}>
        <Highlight name={name} match={match} />
      </span>
    )
  }
  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={(next) => {
        const el = ref.current
        setOpen(next && !!el && el.scrollWidth > el.clientWidth + 1)
      }}
    >
      <RadixTooltip.Trigger asChild>
        <span ref={ref} data-row-name="" className={cn('min-w-0 flex-1 truncate', className)}>
          <Highlight name={name} match={match} />
        </span>
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-w-80 animate-fade-in rounded-md bg-surface-3 px-2 py-1 text-xs break-words text-fg shadow-popover"
        >
          {name}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

function RenameInput({
  initial,
  label,
  onCommit,
  onTab,
  onCancel,
}: {
  initial: string
  label: string
  onCommit: (name: string) => void
  onTab: (name: string, step: 1 | -1) => void
  onCancel: () => void
}) {
  const done = useRef(false)
  const finish = (commit: boolean, value: string) => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(value)
    else onCancel()
  }
  return (
    <input
      autoFocus
      defaultValue={initial}
      spellCheck={false}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(true, e.currentTarget.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true, e.currentTarget.value)
        else if (e.key === 'Escape') finish(false, '')
        else if (e.key === 'Tab' && !done.current) {
          e.preventDefault()
          done.current = true
          onTab(e.currentTarget.value, e.shiftKey ? -1 : 1)
        }
      }}
      className="-ml-1 h-[22px] min-w-0 flex-1 rounded-sm bg-surface-2 px-1 text-sm text-fg shadow-[inset_0_0_0_1px_var(--le-accent)] outline-none selection:bg-selected-strong"
    />
  )
}

/** Small icon button inside a row (not in the tab order; the tree handles the keyboard). */
function RowButton({
  icon: Icon,
  label,
  onClick,
  onPress,
  className,
  onHover,
  interactive,
}: {
  icon: ComponentType<IconProps>
  label: string
  onClick: () => void
  /** Acts on pointer down instead of click (swipe toggles); clicks then only come from AT. */
  onPress?: (e: PointerEvent) => void
  className?: string
  onHover?: (hovering: boolean) => void
  /** Tooltips are mounted only on the hovered row (cheap virtualized scrolling). */
  interactive: boolean
}) {
  return (
    <Tooltip content={label} side="bottom" disabled={!interactive}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        data-row-control=""
        onPointerDown={(e) => {
          e.stopPropagation()
          if (onPress && e.button === 0) onPress(e.nativeEvent)
        }}
        // Keep keyboard focus in the tree (Space must not re-press this button).
        onMouseDown={(e) => e.preventDefault()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          // Pointer clicks were handled on press; `detail` 0 means assistive technology.
          if (!onPress || e.detail === 0) onClick()
        }}
        onPointerEnter={onHover && (() => onHover(true))}
        onPointerLeave={onHover && (() => onHover(false))}
        className={cn(
          'inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-[color,opacity] duration-100 hover:text-fg',
          className,
        )}
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  )
}

function Indicator({
  icon: Icon,
  label,
  className,
  interactive,
}: {
  icon: ComponentType<IconProps>
  label: ReactNode
  className?: string
  interactive: boolean
}) {
  return (
    <Tooltip content={label} side="bottom" disabled={!interactive}>
      <span
        className={cn(
          'inline-flex h-6 w-5 shrink-0 items-center justify-center text-fg-faint',
          className,
        )}
      >
        <Icon size={13} />
      </span>
    </Tooltip>
  )
}

const MATTE_ICON: Record<number, ComponentType<IconProps>> = {
  1: Eclipse,
  2: Eclipse,
  3: Contrast,
  4: Contrast,
}

function LayerRowImpl(p: LayerRowProps) {
  const t = useT()
  const { row, actions } = p
  const hidden = row.hidden || row.hiddenByParent || p.soloHidden
  const activeRow = p.selected > 0 || p.focused
  // Layers read brighter than their content; out-of-range rows (data-inactive, set per frame
  // by the tree) step one tone down; hidden rows are faint.
  const tone = hidden
    ? 'text-fg-faint'
    : activeRow
      ? 'text-fg'
      : row.kind === 'layer'
        ? 'text-fg data-inactive:text-fg-muted'
        : 'text-fg-muted data-inactive:text-fg-subtle'

  return (
    <div
      id={`le-layer-row-${p.index}`}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-selected={p.selected > 0}
      aria-expanded={row.expandable ? row.expanded : undefined}
      data-layer-row={p.index}
      className={cn(
        'group/row absolute inset-x-0 flex items-center select-none',
        p.dragged && 'opacity-45',
      )}
      style={{ top: rowTop(p.index), height: ROW_HEIGHT }}
    >
      {/* Indent guides under each ancestor's chevron (beneath the highlight, which tints them). */}
      {Array.from({ length: row.depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="absolute inset-y-0 w-px bg-line"
          style={{ left: contentLeft(level) + 7.5 }}
        />
      ))}
      {/* Inset, rounded highlight; merges with selected neighbours. */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-y-0 right-1.5 left-1.5 rounded-md transition-colors duration-75',
          p.selected === 0 &&
            !p.dropInside &&
            (p.hovered ? 'bg-hover' : 'group-hover/row:bg-hover'),
          p.selected === 1 && 'bg-selected',
          p.selected === 2 && 'bg-selected-strong',
          p.joinTop && 'rounded-t-none',
          p.joinBottom && 'rounded-b-none',
          p.dropInside && 'bg-accent-subtle shadow-[inset_0_0_0_1px_var(--le-accent)]',
          p.focused && 'group-focus-visible/tree:shadow-[inset_0_0_0_1px_var(--le-accent)]',
        )}
      />
      <div
        className="relative flex h-full min-w-0 flex-1 items-center pr-2.5"
        style={{ paddingLeft: contentLeft(row.depth) }}
      >
        {row.expandable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={row.expanded ? t.layers.row.collapse : t.layers.row.expand}
            data-row-control=""
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              actions.toggleExpand(row, e.altKey)
            }}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:text-fg"
          >
            <ChevronRight
              size={12}
              className={cn('transition-transform duration-100', row.expanded && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span className="ml-0.5 flex size-4 shrink-0 items-center justify-center">
          <NodeIcon node={row.node} kind={row.kind} dim={hidden} />
        </span>
        <span className="ml-1.5 flex h-full min-w-0 flex-1 items-center">
          {p.renaming ? (
            <RenameInput
              initial={row.name}
              label={t.layers.menu.rename}
              onCommit={(name) => actions.commitRename(row, name)}
              onTab={(name, step) => actions.renameNext(row, name, step)}
              onCancel={actions.cancelRename}
            />
          ) : (
            <RowName name={row.name} match={row.match} interactive={p.hovered} className={tone} />
          )}
        </span>

        {!p.renaming && <RowMeta {...p} />}
      </div>
    </div>
  )
}

/** Right side of a row: indicators (always visible) and toggles (on hover, or when active). */
function RowMeta(p: LayerRowProps) {
  const t = useT()
  const { row, actions } = p
  const reveal = 'opacity-0 group-hover/row:opacity-100'
  const inverted = p.matte?.type === 2 || p.matte?.type === 4
  const interactive = p.hovered
  return (
    <>
      {p.usage > 1 && (
        <Tooltip content={t.layers.row.usage(p.usage)} side="bottom" disabled={!interactive}>
          <span className="ml-1.5 shrink-0 px-0.5 text-xs text-fg-subtle tabular-nums">
            ×{p.usage}
          </span>
        </Tooltip>
      )}
      {row.recursive && (
        <Indicator
          icon={Link2Off}
          label={t.layers.row.recursive}
          className="text-warning"
          interactive={interactive}
        />
      )}
      {p.parentLabel && (
        <RowButton
          icon={p.parentMissing ? Link2Off : Link2}
          label={p.parentLabel}
          onClick={() => actions.selectParentOf(row)}
          onHover={(on) => actions.hoverParentOf(on ? row : null)}
          className={cn('text-fg-faint', p.parentMissing && 'text-warning hover:text-warning')}
          interactive={interactive}
        />
      )}
      {p.matte && (
        <Indicator
          icon={p.matte.role === 'source' ? CircleDashed : (MATTE_ICON[p.matte.type] ?? Eclipse)}
          label={p.matte.label}
          // Inverted mattes show the mirrored glyph.
          className={cn(
            p.matte.missing ? 'text-warning' : 'text-fg-subtle',
            inverted && '[&_svg]:-scale-x-100',
          )}
          interactive={interactive}
        />
      )}
      {p.soloed && (
        <RowButton
          icon={CircleDot}
          label={t.layers.row.soloed}
          onClick={() => actions.toggleSolo(row)}
          className="text-accent-text hover:text-accent-text"
          interactive={interactive}
        />
      )}
      <RowButton
        icon={p.locked || p.lockedByParent ? Lock : LockOpen}
        label={p.locked ? t.layers.row.unlock : t.layers.row.lock}
        onClick={() => actions.toggleLocked(row)}
        onPress={(e) => actions.swipe(row, 'locked', e)}
        className={cn(p.locked ? 'text-fg-muted' : p.lockedByParent ? 'text-fg-faint' : reveal)}
        interactive={interactive}
      />
      <RowButton
        icon={row.hidden ? EyeOff : Eye}
        label={row.hidden ? t.layers.row.show : t.layers.row.hide}
        onClick={() => actions.toggleHidden(row)}
        onPress={(e) => actions.swipe(row, 'hidden', e)}
        className={cn(row.hidden ? 'text-fg-muted' : reveal)}
        interactive={interactive}
      />
    </>
  )
}

const sameMatte = (a: RowMatte | null, b: RowMatte | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.role === b.role &&
    a.type === b.type &&
    a.label === b.label &&
    a.missing === b.missing)

/** Props are primitives or stable references, except the matte summary (compared by value). */
function sameProps(a: LayerRowProps, b: LayerRowProps): boolean {
  for (const key in a) {
    const k = key as keyof LayerRowProps
    if (k === 'matte' ? !sameMatte(a.matte, b.matte) : a[k] !== b[k]) return false
  }
  return true
}

export const LayerRow = memo(LayerRowImpl, sameProps)
