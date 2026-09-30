/**
 * The palette list: colors, then gradients (with their stops), each expandable to show where
 * it is used. Virtualized; one delegated handler per event type; tree keyboard navigation;
 * drag a color onto another to merge them; one context menu for all rows.
 */
import {
  Blend,
  Braces,
  ClipboardCopy,
  MousePointer2,
  Pencil,
  Rainbow,
  RotateCcw,
  Rows3,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ColorSwatch,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
  MenuSeparator,
} from '@/components/ui'
import { ThemeColorMenuItem } from '@/features/themes'
import { useT, type Dict } from '@/i18n'
import type { RGBA } from '@/lib/color'
import { hasModKey } from '@/lib/platform'
import {
  gradientToCss,
  readUsageColor,
  rgb8ToHex,
  colorToRgb8,
  type ColorGroup,
  type ColorUsage,
  type GradientGroup,
  type GradientUsage,
} from '@/lottie/colors'
import type { Animation } from '@/lottie/types'
import { getDoc, useDocument } from '@/store/document'
import {
  clearHighlight,
  copyWithFlash,
  hasModifiedUsages,
  highlightUsages,
  mergeUsages,
  replaceUsages,
  resetUsages,
  revealInJson,
  selectLayersOf,
  selectUsageNode,
  swapUsages,
} from './actions'
import { gradientGroupCss } from './palette-export'
import {
  colorRowKey,
  displayHex,
  GRADIENT_KIND_ICONS,
  gradientRowKey,
  gradientUsagesKey,
  KIND_ICONS,
  kindSummary,
  stopRowKey,
} from './format'
import { ColorRow, GradientRow, SectionHeaderRow, StopRow, UsageRow } from './rows'
import {
  toggleExpanded,
  toggleListSection,
  useColorsPrefs,
  useColorsUi,
  type ListSection,
} from './store'
import { describeGradientUsage, describeUsage } from './usage-label'
import { latestUsages } from './useColorData'
import { useVirtualRows } from './useVirtualRows'

/* -------------------------------------------------------------------------- */
/*                                    Items                                   */
/* -------------------------------------------------------------------------- */

export type ListItem =
  | {
      type: 'header'
      key: string
      section: ListSection
      title: string
      count: number
      collapsed: boolean
      first: boolean
    }
  | { type: 'color'; key: string; group: ColorGroup; expanded: boolean }
  | { type: 'usage'; key: string; usage: ColorUsage; parentKey: string }
  | {
      type: 'gradient'
      key: string
      group: GradientGroup
      expanded: boolean
      usagesExpanded: boolean
    }
  | { type: 'stop'; key: string; group: GradientGroup; index: number; parentKey: string }
  | { type: 'gusage'; key: string; usage: GradientUsage; parentKey: string }

const ROW_HEIGHT: Record<ListItem['type'], number> = {
  header: 28,
  color: 28,
  gradient: 28,
  usage: 24,
  stop: 24,
  gusage: 24,
}

function buildItems(
  colors: readonly ColorGroup[],
  gradients: readonly GradientGroup[],
  expanded: Record<string, boolean>,
  collapsed: Partial<Record<ListSection, boolean>>,
  t: Dict,
): ListItem[] {
  const items: ListItem[] = []
  if (colors.length) {
    const closed = !!collapsed.colors
    items.push({
      type: 'header',
      key: 'h:colors',
      section: 'colors',
      title: t.colors.sections.colors,
      count: colors.length,
      collapsed: closed,
      first: true,
    })
    if (!closed) {
      for (const group of colors) {
        const key = colorRowKey(group)
        const open = !!expanded[key]
        items.push({ type: 'color', key, group, expanded: open })
        if (open)
          for (const usage of group.usages)
            items.push({ type: 'usage', key: `${key}|${usage.id}`, usage, parentKey: key })
      }
    }
  }
  if (gradients.length) {
    const closed = !!collapsed.gradients
    items.push({
      type: 'header',
      key: 'h:gradients',
      section: 'gradients',
      title: t.colors.sections.gradients,
      count: gradients.length,
      collapsed: closed,
      first: items.length === 0,
    })
    if (!closed) {
      for (const group of gradients) {
        const key = gradientRowKey(group)
        const open = !!expanded[key]
        const usagesOpen = !!expanded[gradientUsagesKey(group)]
        items.push({ type: 'gradient', key, group, expanded: open, usagesExpanded: usagesOpen })
        if (open)
          group.sample.stops.forEach((_, index) =>
            items.push({
              type: 'stop',
              key: stopRowKey(group, index),
              group,
              index,
              parentKey: key,
            }),
          )
        if (usagesOpen)
          for (const usage of group.usages)
            items.push({ type: 'gusage', key: `${key}|${usage.id}`, usage, parentKey: key })
      }
    }
  }
  return items
}

/** Usages an item stands for (hover highlight, selection, reset). */
function itemUsages(item: ListItem): ColorUsage[] {
  switch (item.type) {
    case 'color':
      return item.group.usages
    case 'usage':
      return [item.usage]
    case 'gradient':
      return item.group.usages.flatMap((g) => g.stops)
    case 'stop':
      return item.group.usages.map((g) => g.stops[item.index]).filter(Boolean)
    case 'gusage':
      return item.usage.stops
    default:
      return []
  }
}

/** Current color of a usage (rows may show groups computed before the latest edit). */
function liveColor(doc: Animation | null, usage: ColorUsage, fallback: RGBA): RGBA {
  return (doc && readUsageColor(doc, usage)) || fallback
}

const liveHex = (usage: ColorUsage, fallback: RGBA) =>
  rgb8ToHex(colorToRgb8(liveColor(getDoc(), usage, fallback)))

/** Focus leaving the list ends the keyboard highlight. */
function onListBlur(e: FocusEvent): void {
  if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
    clearHighlight()
}

/** Shows on the canvas where an item's colors are used (nothing for section headers). */
function highlightItem(item: ListItem): void {
  if (item.type === 'header') clearHighlight()
  else highlightUsages(item.type === 'gusage' ? [item.usage] : itemUsages(item))
}

/** Live CSS of a gradient (reads current stop colors from the document). */
function liveGradientCss(doc: Animation | null, group: GradientGroup): string {
  if (!doc) return gradientGroupCss(group)
  const { sample } = group
  const live = sample.stops.map((s) => readUsageColor(doc, s) ?? s.color)
  const opacity = sample.opacity.map((o) => {
    const i = sample.stops.findIndex(
      (s) => s.alphaEditable && Math.abs((s.stopOffset ?? 0) - o.offset) <= 0.01,
    )
    return i >= 0 ? { offset: o.offset, alpha: live[i].a } : o
  })
  return gradientToCss(
    sample.stops.map((s, i) => ({ offset: s.stopOffset ?? 0, color: live[i] })),
    opacity,
    'linear',
  )
}

function copyHex(hex: string | undefined, t: Dict): void {
  if (!hex) return
  const text = `#${displayHex(hex)}`
  void copyWithFlash(text, t.colors.flash.copied(text))
}

function copyCss(group: GradientGroup, t: Dict): void {
  void copyWithFlash(gradientGroupCss(group), t.colors.flash.copied('CSS'))
}

/* -------------------------------------------------------------------------- */
/*                                    List                                    */
/* -------------------------------------------------------------------------- */

interface DragState {
  source: ColorGroup
  sourceKey: string
  x: number
  y: number
  overKey: string | null
  over: ColorGroup | null
  /** Alt is held: the colors exchange places instead of merging. */
  swap: boolean
}

export interface ColorListProps {
  colorGroups: ColorGroup[]
  gradientGroups: GradientGroup[]
  /** Row key whose picker is open (highlighted). */
  editingKey: string | null
  onEditGroup: (group: ColorGroup) => void
  onEditStop: (group: GradientGroup, index: number) => void
}

export function ColorList({
  colorGroups,
  gradientGroups,
  editingKey,
  onEditGroup,
  onEditStop,
}: ColorListProps) {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const expanded = useColorsUi((s) => s.expanded)
  const collapsed = useColorsPrefs((s) => s.collapsed)
  const items = useMemo(
    () => buildItems(colorGroups, gradientGroups, expanded, collapsed, t),
    [colorGroups, gradientGroups, expanded, collapsed, t],
  )
  const heights = useMemo(() => items.map((i) => ROW_HEIGHT[i.type]), [items])
  const scrollRef = useRef<HTMLDivElement>(null)
  const { start, end, offsets, total } = useVirtualRows(heights, scrollRef)

  const [activeKey, setActiveKey] = useState<string | null>(null)
  const found = activeKey ? items.findIndex((i) => i.key === activeKey) : -1
  const activeIndex = found >= 0 ? found : 0

  const [menuItem, setMenuItem] = useState<ListItem | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const suppressClick = useRef(false)
  const hoverKey = useRef<string | null>(null)
  // The list can unmount under the pointer (tab switch, closing the panel): no leave event
  // then, so the canvas highlight is cleared here.
  useEffect(() => () => clearHighlight(), [])

  const itemAt = useCallback(
    (target: EventTarget | null): ListItem | null => {
      const el = target instanceof Element ? target.closest<HTMLElement>('[data-row-key]') : null
      if (!el) return null
      const index = Number(el.dataset.index)
      return items[index]?.key === el.dataset.rowKey ? items[index] : null
    },
    [items],
  )

  /* ------------------------------ Activation ------------------------------ */

  const toggle = useCallback((item: ListItem) => {
    if (item.type === 'header') toggleListSection(item.section)
    else if (item.type === 'color' || item.type === 'gradient') toggleExpanded(item.key)
  }, [])

  const activate = useCallback(
    (item: ListItem) => {
      switch (item.type) {
        case 'header':
        case 'gradient':
          toggle(item)
          break
        case 'color':
          onEditGroup(item.group)
          break
        case 'stop':
          onEditStop(item.group, item.index)
          break
        case 'usage':
        case 'gusage':
          selectUsageNode(item.usage)
          break
      }
    },
    [toggle, onEditGroup, onEditStop],
  )

  // Tab, click or programmatic focus on a row makes it the keyboard cursor.
  const onFocus = (e: FocusEvent) => {
    const item = itemAt(e.target)
    if (item && item.key !== activeKey) setActiveKey(item.key)
  }

  const onClick = (e: MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const item = itemAt(e.target)
    if (!item) return
    setActiveKey(item.key)
    const action = (e.target as Element).closest('[data-action]')?.getAttribute('data-action')
    if (action === 'toggle') toggle(item)
    else activate(item)
  }

  /* ------------------------------- Keyboard ------------------------------- */

  const focusIndex = (index: number) => {
    const i = Math.max(0, Math.min(items.length - 1, index))
    const item = items[i]
    if (!item) return
    setActiveKey(item.key)
    // Moving through the rows with the keyboard shows where each color is used, as hovering does.
    highlightItem(item)
    const el = scrollRef.current
    if (el) {
      const top = offsets[i]
      const bottom = offsets[i + 1]
      if (top < el.scrollTop) el.scrollTop = top
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    }
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.focus(),
    )
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const item = items[activeIndex]
    if (!item) return
    const parentIndex = 'parentKey' in item ? items.findIndex((i) => i.key === item.parentKey) : -1
    const isOpen =
      (item.type === 'header' && !item.collapsed) ||
      ((item.type === 'color' || item.type === 'gradient') && item.expanded)
    const canOpen = item.type === 'header' || item.type === 'color' || item.type === 'gradient'
    switch (e.key) {
      case 'ArrowDown':
        focusIndex(activeIndex + 1)
        break
      case 'ArrowUp':
        focusIndex(activeIndex - 1)
        break
      case 'Home':
        focusIndex(0)
        break
      case 'End':
        focusIndex(items.length - 1)
        break
      case 'ArrowRight':
        if (canOpen && !isOpen) toggle(item)
        else if (isOpen) focusIndex(activeIndex + 1)
        break
      case 'ArrowLeft':
        if (canOpen && isOpen) toggle(item)
        else if (parentIndex >= 0) focusIndex(parentIndex)
        break
      // Space stays with the global play / pause shortcut.
      case 'Enter':
        activate(item)
        break
      default: {
        // ⌘C by physical key, so it works with any keyboard layout.
        if (e.code !== 'KeyC' || !hasModKey(e) || e.shiftKey || e.altKey) return
        if (item.type === 'color') copyHex(liveHex(item.group.sample, item.group.color), t)
        else if (item.type === 'stop') {
          const stop = item.group.sample.stops[item.index]
          if (stop) copyHex(liveHex(stop, stop.color), t)
        } else if (item.type === 'gradient') copyCss(item.group, t)
        else return
      }
    }
    e.preventDefault()
    e.stopPropagation()
  }

  /* ------------------------------- Hovering ------------------------------- */

  const onPointerMove = (e: ReactPointerEvent) => {
    if (drag) return
    const item = itemAt(e.target)
    const key = item?.key ?? null
    if (key === hoverKey.current) return
    hoverKey.current = key
    if (item) highlightItem(item)
    else clearHighlight()
  }

  const onPointerLeave = () => {
    hoverKey.current = null
    clearHighlight()
  }

  /* ---------------------------- Drag to merge ----------------------------- */

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('[data-action]')) return
    const item = itemAt(e.target)
    if (!item || item.type !== 'color') return
    const source = item.group
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false
    let over: { key: string; group: ColorGroup } | null = null
    let autoScroll = 0
    let lastX = startX
    let lastY = startY
    let swap = false

    const findTarget = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-key]')
      const key = el?.dataset.dropKey
      if (!key || key === item.key) return null
      const target = items.find((i) => i.key === key)
      return target?.type === 'color' ? { key, group: target.group } : null
    }

    const scrollStep = () => {
      const el = scrollRef.current
      if (!el || !dragging) return
      const rect = el.getBoundingClientRect()
      const edge = 28
      const delta = lastY < rect.top + edge ? -8 : lastY > rect.bottom - edge ? 8 : 0
      if (delta) el.scrollTop += delta
      autoScroll = delta ? requestAnimationFrame(scrollStep) : 0
    }

    const update = () =>
      setDrag({
        source,
        sourceKey: item.key,
        x: lastX,
        y: lastY,
        overKey: over?.key ?? null,
        over: over?.group ?? null,
        swap,
      })

    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX
      lastY = ev.clientY
      swap = ev.altKey
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
        dragging = true
        document.body.style.cursor = 'grabbing'
        clearHighlight()
      }
      over = findTarget(ev.clientX, ev.clientY)
      update()
      if (!autoScroll) autoScroll = requestAnimationFrame(scrollStep)
    }

    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      if (autoScroll) cancelAnimationFrame(autoScroll)
      document.body.style.cursor = ''
      if (dragging) {
        suppressClick.current = true
        // The click that follows pointerup is swallowed; clear the flag if it never comes.
        setTimeout(() => (suppressClick.current = false), 0)
        setDrag(null)
        if (commit && over) {
          const target = over.group
          const latest = getDoc()
          const from = liveColor(latest, source.sample, source.color)
          const into = liveColor(latest, target.sample, target.color)
          if (swap) swapUsages(latestUsages(source.usages), from, latestUsages(target.usages), into)
          else mergeUsages(latestUsages(source.usages), into)
        }
      }
    }
    const onUp = (ev: PointerEvent) => {
      swap = ev.altKey
      finish(true)
    }
    const onCancel = () => finish(false)
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (!dragging) return
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        finish(false)
      } else if (ev.key === 'Alt' && swap !== ev.altKey) {
        // Pressing or releasing Alt switches between merge and swap without moving the pointer.
        ev.preventDefault()
        swap = ev.altKey
        update()
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
  }

  /* ----------------------------- Context menu ----------------------------- */

  const onContextMenu = (e: MouseEvent) => {
    const item = itemAt(e.target)
    if (!item || item.type === 'header') {
      e.preventDefault()
      return
    }
    setActiveKey(item.key)
    setMenuItem(item)
  }

  /* -------------------------------- Render -------------------------------- */

  const rows: ReactNode[] = []
  const indices = new Set<number>()
  for (let i = start; i <= end; i++) indices.add(i)
  // Keep the focused row mounted so keyboard focus survives scrolling.
  if (activeIndex < items.length) indices.add(activeIndex)
  for (const i of [...indices].sort((a, b) => a - b)) {
    const item = items[i]
    const pos = {
      index: i,
      itemKey: item.key,
      top: offsets[i],
      height: ROW_HEIGHT[item.type],
      focusable: i === activeIndex,
    }
    rows.push(renderRow(item, pos, { doc, t, editingKey, drag }))
  }

  return (
    <>
      <ContextMenu onOpenChange={(open) => !open && setMenuItem(null)}>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            role="tree"
            tabIndex={-1}
            aria-label={t.colors.title}
            className="h-full overflow-y-auto overscroll-contain"
            onClick={onClick}
            onFocus={onFocus}
            onBlur={onListBlur}
            onKeyDown={onKeyDown}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onContextMenu={onContextMenu}
            data-testid="colors-list"
          >
            <div className="relative" style={{ height: total }}>
              {rows}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[220px]">
          {menuItem && (
            <RowMenu item={menuItem} t={t} onEditGroup={onEditGroup} onEditStop={onEditStop} />
          )}
        </ContextMenuContent>
      </ContextMenu>
      {drag &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 flex h-7 animate-fade-in items-center gap-1.5 rounded-md bg-surface-3 pr-2 pl-1 text-xs whitespace-nowrap text-fg shadow-popover"
            // The palette lives in the right sidebar: past the middle of the window the label
            // opens to the left of the pointer so it never runs off the screen.
            style={
              drag.x > window.innerWidth / 2
                ? { right: window.innerWidth - drag.x + 12, top: drag.y + 10 }
                : { left: drag.x + 14, top: drag.y + 10 }
            }
          >
            <ColorSwatch
              color={liveColor(doc, drag.source.sample, drag.source.color)}
              size={18}
              className="rounded-sm"
            />
            {drag.over ? (
              <>
                <span className="text-fg-muted">
                  {drag.swap ? t.colors.drag.swapWith : t.colors.drag.mergeInto}
                </span>
                <ColorSwatch
                  color={liveColor(doc, drag.over.sample, drag.over.color)}
                  size={14}
                  className="rounded-xs"
                />
                <span className="font-mono tabular-nums">
                  {displayHex(liveHex(drag.over.sample, drag.over.color))}
                </span>
              </>
            ) : (
              <span className="font-mono text-fg-muted tabular-nums">
                {displayHex(liveHex(drag.source.sample, drag.source.color))}
              </span>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

interface RenderContext {
  doc: Animation | null
  t: Dict
  editingKey: string | null
  drag: DragState | null
}

type Pos = { index: number; itemKey: string; top: number; height: number; focusable: boolean }

function renderRow(
  item: ListItem,
  pos: Pos,
  { doc, t, editingKey, drag }: RenderContext,
): ReactNode {
  switch (item.type) {
    case 'header':
      return (
        <SectionHeaderRow
          key={item.key}
          {...pos}
          title={item.title}
          count={item.count}
          collapsed={item.collapsed}
          first={item.first}
        />
      )
    case 'color': {
      const { group } = item
      const live = liveColor(doc, group.sample, group.color)
      return (
        <ColorRow
          key={item.key}
          {...pos}
          hex={rgb8ToHex(colorToRgb8(live))}
          swatchAlpha={group.color.a}
          alpha={group.alpha}
          members={group.members}
          kinds={group.kinds}
          count={group.count}
          animated={group.animatedCount > 0}
          kindTooltip={kindSummary(group.usages, t, group.layerCount)}
          expanded={item.expanded}
          editing={editingKey === item.key}
          dragSource={drag?.sourceKey === item.key}
          dropTarget={drag?.overKey === item.key}
          t={t}
        />
      )
    }
    case 'gradient':
      return (
        <GradientRow
          key={item.key}
          {...pos}
          group={item.group}
          css={liveGradientCss(doc, item.group)}
          expanded={item.expanded}
          t={t}
        />
      )
    case 'stop': {
      const stop = item.group.sample.stops[item.index]
      const live = liveColor(doc, stop, stop.color)
      return (
        <StopRow
          key={item.key}
          {...pos}
          hex={rgb8ToHex(colorToRgb8(live))}
          opacity={live.a}
          offset={stop.stopOffset ?? 0}
          showAlpha={item.group.sample.opacity.length > 0}
          editing={editingKey === item.key}
          t={t}
        />
      )
    }
    case 'usage': {
      const d = doc
        ? describeUsage(doc, item.usage, t)
        : { crumbs: [], kind: t.colors.kinds[item.usage.kind], detail: '' }
      return (
        <UsageRow
          key={item.key}
          {...pos}
          icon={KIND_ICONS[item.usage.kind]}
          crumbs={d.crumbs}
          kind={d.kind}
          detail={d.detail}
          animated={item.usage.animated}
          hoverTitle={[d.crumbs.join(' › '), d.kind].join(' · ')}
        />
      )
    }
    case 'gusage': {
      const d = doc
        ? describeGradientUsage(doc, item.usage, t)
        : { crumbs: [], kind: t.colors.gradientKinds[item.usage.kind], detail: '' }
      return (
        <UsageRow
          key={item.key}
          {...pos}
          icon={GRADIENT_KIND_ICONS[item.usage.kind]}
          crumbs={d.crumbs}
          kind={d.kind}
          detail={d.detail}
          animated={item.usage.animated}
          hoverTitle={[d.crumbs.join(' › '), d.kind].join(' · ')}
        />
      )
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                Context menu                                */
/* -------------------------------------------------------------------------- */

/**
 * Opens a popover after the context menu has closed and returned focus; opening it in the same
 * tick would let that focus change dismiss the popover immediately.
 */
function afterMenuCloses(fn: () => void): void {
  setTimeout(fn, 0)
}

interface RowMenuProps {
  item: ListItem
  t: Dict
  onEditGroup: (group: ColorGroup) => void
  onEditStop: (group: GradientGroup, index: number) => void
}

function RowMenu({ item, t, onEditGroup, onEditStop }: RowMenuProps) {
  const usages = itemUsages(item)
  const modified = hasModifiedUsages(usages)
  const reset = (
    <MenuItem
      kind="context"
      icon={RotateCcw}
      disabled={!modified}
      onSelect={() => resetUsages(latestUsages(usages))}
    >
      {t.colors.context.reset}
    </MenuItem>
  )
  const copyHexItem = (usage: ColorUsage, fallback: RGBA) => {
    const hex = liveHex(usage, fallback)
    return (
      <MenuItem
        kind="context"
        icon={ClipboardCopy}
        shortcut="mod+c"
        onSelect={() => copyHex(hex, t)}
      >
        {t.colors.context.copyHex(`#${displayHex(hex)}`)}
      </MenuItem>
    )
  }

  switch (item.type) {
    case 'color': {
      const { group } = item
      return (
        <>
          <MenuItem
            kind="context"
            icon={Pencil}
            onSelect={() => afterMenuCloses(() => onEditGroup(group))}
          >
            {t.colors.context.replace}
          </MenuItem>
          {copyHexItem(group.sample, group.color)}
          <ThemeColorMenuItem usages={group.usages} />
          <MenuSeparator kind="context" />
          <MenuItem
            kind="context"
            icon={MousePointer2}
            onSelect={() => selectLayersOf(group.usages)}
          >
            {t.colors.context.selectLayers}
          </MenuItem>
          <MenuItem kind="context" icon={Rows3} onSelect={() => toggleExpanded(item.key)}>
            {item.expanded ? t.colors.context.hideUsages : t.colors.context.showUsages}
          </MenuItem>
          {group.members.length > 1 && (
            <MenuItem
              kind="context"
              icon={Blend}
              onSelect={() =>
                replaceUsages(
                  latestUsages(group.usages),
                  liveColor(getDoc(), group.sample, group.color),
                  {
                    label: t.colors.history.unify,
                  },
                )
              }
            >
              {t.colors.context.unify(group.members.length)}
            </MenuItem>
          )}
          <MenuSeparator kind="context" />
          {reset}
        </>
      )
    }
    case 'gradient': {
      const { group } = item
      return (
        <>
          <MenuItem kind="context" icon={Rainbow} onSelect={() => toggleExpanded(item.key)}>
            {item.expanded ? t.colors.context.hideStops : t.colors.context.showStops}
          </MenuItem>
          <MenuItem
            kind="context"
            icon={ClipboardCopy}
            shortcut="mod+c"
            onSelect={() => copyCss(group, t)}
          >
            {t.colors.context.copyCss}
          </MenuItem>
          <MenuSeparator kind="context" />
          <MenuItem
            kind="context"
            icon={MousePointer2}
            onSelect={() => selectLayersOf(group.usages)}
          >
            {t.colors.context.selectLayersGradient}
          </MenuItem>
          <MenuItem
            kind="context"
            icon={Rows3}
            onSelect={() => toggleExpanded(gradientUsagesKey(group))}
          >
            {item.usagesExpanded ? t.colors.context.hideUsages : t.colors.context.showUsages}
          </MenuItem>
          <MenuSeparator kind="context" />
          {reset}
        </>
      )
    }
    case 'stop': {
      const stop = item.group.sample.stops[item.index]
      return (
        <>
          <MenuItem
            kind="context"
            icon={Pencil}
            onSelect={() => afterMenuCloses(() => onEditStop(item.group, item.index))}
          >
            {t.colors.context.editStop}
          </MenuItem>
          {stop && copyHexItem(stop, stop.color)}
          <MenuSeparator kind="context" />
          {reset}
        </>
      )
    }
    case 'usage':
    case 'gusage':
      return (
        <>
          <MenuItem
            kind="context"
            icon={MousePointer2}
            onSelect={() => selectUsageNode(item.usage)}
          >
            {t.colors.context.selectNode}
          </MenuItem>
          <MenuItem kind="context" icon={Braces} onSelect={() => revealInJson(item.usage.path)}>
            {t.colors.context.showInJson}
          </MenuItem>
          {item.type === 'usage' && copyHexItem(item.usage, item.usage.color)}
          <MenuSeparator kind="context" />
          {reset}
        </>
      )
    default:
      return null
  }
}
