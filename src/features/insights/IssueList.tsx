/**
 * The virtualized issue tree: severity groups, issue rows (title, where, affected players,
 * hover actions), expandable details (description, per-player verdicts, fix and tools) and the
 * list of places. Keyboard: ↑↓ move, → expands, ← collapses or goes to the parent, Enter
 * toggles or shows a place.
 */
import {
  Braces,
  ChevronRight,
  Copy,
  Ellipsis,
  LocateFixed,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { LayerKindIcon, ShapeTypeIcon } from '@/components/lottie/icons'
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
  Tooltip,
} from '@/components/ui'
import { useLanguage, useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { layerKind } from '@/lottie/layers'
import { getAt, isLayerPath, isShapePath, type NodePath } from '@/lottie/path'
import type { Animation, Layer } from '@/lottie/types'
import type { Issue } from '@/lottie/validate'
import { canFixPlace, copyIssue, fixIssue, runTool, showInJson, showPlaces } from './actions'
import {
  canShow,
  issueAbout,
  issueTitle,
  levelText,
  locate,
  placesSummary,
  playerChips,
  sortedPlatforms,
  showTarget,
  toolAction,
  verdictText,
  type FormatOptions,
  type ToolAction,
} from './format'
import { LevelIcon, SeverityIcon, TruncatedText } from './parts'
import { buildRows, isNavigable, parentIndex, ROW_HEIGHTS, type Row } from './rows'
import { setActiveRow, toggleExpanded, toggleGroup, useInsightsPrefs, useIssuesUi } from './store'
import { LEVEL_TEXT } from './tones'
import { useVirtualRows } from './useVirtualRows'

interface RowContext {
  o: FormatOptions
  /** The analyzed document (issue paths point into it). */
  doc: Animation | null
  /** Several players are checked: show which ones an issue affects. */
  showPlayers: boolean
  /** Moves the focus back to the list (e.g. after a fix removed the focused row). */
  refocus: () => void
}

const MAX_CHIPS = 3

/* ---------------------------------------------------------------------------- */
/*                                     List                                     */
/* ---------------------------------------------------------------------------- */

export function IssueList({
  issues,
  doc,
  showPlayers,
}: {
  issues: readonly Issue[]
  doc: Animation | null
  showPlayers: boolean
}) {
  const t = useT()
  const lang = useLanguage()
  const expanded = useIssuesUi((s) => s.expanded)
  const active = useIssuesUi((s) => s.active)
  const collapsed = useInsightsPrefs((s) => s.collapsed)
  const rows = useMemo(() => buildRows(issues, expanded, collapsed), [issues, expanded, collapsed])
  const scrollRef = useRef<HTMLDivElement>(null)
  const refocus = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), [])
  const ctx = useMemo<RowContext>(
    () => ({ o: { t, lang }, doc, showPlayers, refocus }),
    [t, lang, doc, showPlayers, refocus],
  )

  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map())
  const onMeasure = useCallback((key: string, height: number) => {
    setMeasured((m) => (m.get(key) === height ? m : new Map(m).set(key, height)))
  }, [])
  const heights = useMemo(
    () =>
      rows.map((r) =>
        r.kind === 'details' ? (measured.get(r.key) ?? ROW_HEIGHTS.details) : ROW_HEIGHTS[r.kind],
      ),
    [rows, measured],
  )
  const range = useVirtualRows(heights, scrollRef)

  const activeIndex = active ? rows.findIndex((r) => r.key === active) : -1
  const [keyboard, setKeyboard] = useState(false)
  const [focused, setFocused] = useState(false)

  // Keep the keyboard row in view (it may be outside the rendered window).
  const reveal = useRef(false)
  useEffect(() => {
    if (!reveal.current || activeIndex < 0) return
    reveal.current = false
    const el = scrollRef.current
    if (!el) return
    const top = range.offsets[activeIndex]
    const bottom = range.offsets[activeIndex + 1]
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [activeIndex, range.offsets])

  const moveTo = (index: number) => {
    const row = rows[index]
    if (!row) return
    reveal.current = true
    setActiveRow(row.key)
  }
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir) {
      if (isNavigable(rows[i])) return moveTo(i)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.metaKey || e.ctrlKey) return
    const index = activeIndex >= 0 ? activeIndex : -1
    const row = rows[index]
    let handled = true
    switch (e.key) {
      case 'ArrowDown':
        step(index, 1)
        break
      case 'ArrowUp':
        if (index < 0) step(rows.length, -1)
        else step(index, -1)
        break
      case 'Home':
        step(-1, 1)
        break
      case 'End':
        step(rows.length, -1)
        break
      case 'ArrowRight':
        if (row?.kind === 'group' && row.collapsed) toggleGroup(row.severity, false)
        else if (row?.kind === 'issue' && !row.expanded) toggleExpanded(row.issue.id, true)
        else step(index, 1)
        break
      case 'ArrowLeft':
        if (row?.kind === 'group' && !row.collapsed) toggleGroup(row.severity, true)
        else if (row?.kind === 'issue' && row.expanded) toggleExpanded(row.issue.id, false)
        else if (row) moveTo(parentIndex(rows, index))
        break
      case 'Enter':
      case ' ':
        if (row?.kind === 'group') toggleGroup(row.severity)
        else if (row?.kind === 'issue') toggleExpanded(row.issue.id)
        else if (row?.kind === 'place') showPlaces([row.path])
        break
      default:
        handled = false
    }
    if (handled) {
      e.preventDefault()
      setKeyboard(true)
    }
  }

  /** The row under a click, unless the click hit a button or menu inside it. */
  const rowOf = (e: MouseEvent<HTMLDivElement>): Row | null => {
    const el = e.target as HTMLElement
    if (el.closest('button, [role="menuitem"]')) return null
    const rowEl = el.closest<HTMLElement>('[data-row-index]')
    if (!rowEl || !e.currentTarget.contains(rowEl)) return null
    return rows[Number(rowEl.dataset.rowIndex)] ?? null
  }
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const row = rowOf(e)
    if (!row) return
    if (isNavigable(row)) setActiveRow(row.key)
    if (row.kind === 'group') toggleGroup(row.severity)
    else if (row.kind === 'issue') toggleExpanded(row.issue.id)
    else if (row.kind === 'place') showPlaces([row.path])
  }
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const row = rowOf(e)
    if (row?.kind === 'issue' && canShow(row.issue)) showPlaces(row.issue.paths)
  }

  const listId = 'insights-issues'
  const visible = rows.slice(range.start, range.end + 1)
  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label={t.insights.panel.label}
      aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      tabIndex={0}
      data-testid="issues-list"
      onKeyDown={onKeyDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onFocus={(e) => {
        if (e.target !== e.currentTarget) return
        setFocused(true)
        // Entering with Tab starts on the first row.
        if (activeIndex < 0) step(-1, 1)
      }}
      onBlur={(e) => {
        if (e.target === e.currentTarget) setFocused(false)
      }}
      onPointerDown={() => setKeyboard(false)}
      className="relative min-h-0 flex-1 overflow-y-auto outline-none"
    >
      <div className="relative" style={{ height: range.total }}>
        {visible.map((row, i) => {
          const index = range.start + i
          return (
            <div
              key={row.key}
              data-row-index={index}
              className="absolute inset-x-0"
              style={{ top: range.offsets[index] }}
            >
              <RowView
                id={`${listId}-${index}`}
                row={row}
                ctx={ctx}
                active={row.key === active}
                ring={row.key === active && focused && keyboard}
                onMeasure={onMeasure}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------- */
/*                                     Rows                                     */
/* ---------------------------------------------------------------------------- */

interface RowProps {
  /** DOM id of the row (the tree's active descendant). */
  id: string
  row: Row
  ctx: RowContext
  active: boolean
  /** Keyboard focus ring. */
  ring: boolean
  onMeasure: (key: string, height: number) => void
}

const RowView = memo(function RowView({ id, row, ctx, active, ring, onMeasure }: RowProps) {
  switch (row.kind) {
    case 'group':
      return <GroupRow id={id} row={row} ctx={ctx} ring={ring} />
    case 'issue':
      return <IssueRow id={id} row={row} ctx={ctx} active={active} ring={ring} />
    case 'details':
      return (
        <Measured rowKey={row.key} onMeasure={onMeasure}>
          <IssueDetails issue={row.issue} ctx={ctx} />
        </Measured>
      )
    case 'place':
      return <PlaceRow id={id} row={row} ctx={ctx} ring={ring} />
    case 'more':
      return (
        <div
          id={id}
          role="treeitem"
          aria-level={3}
          className={cn(
            'flex h-6 items-center pr-3 pl-[34px] text-xs text-fg-subtle',
            ring && ringClass,
          )}
        >
          {ctx.o.t.insights.panel.notListed(row.hidden)}
        </div>
      )
  }
})

const ringClass = 'shadow-[inset_0_0_0_1px_var(--le-accent)]'

function Measured({
  rowKey,
  onMeasure,
  children,
}: {
  rowKey: string
  onMeasure: (key: string, height: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => onMeasure(rowKey, el.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [rowKey, onMeasure])
  return <div ref={ref}>{children}</div>
}

function GroupRow({
  id,
  row,
  ctx,
  ring,
}: {
  id: string
  row: Extract<Row, { kind: 'group' }>
  ctx: RowContext
  ring: boolean
}) {
  const label = ctx.o.t.insights.panel.groups[row.severity]
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={1}
      aria-expanded={!row.collapsed}
      aria-label={`${label} ${row.count}`}
      data-testid={`issues-group-${row.severity}`}
      className={cn(
        'group flex h-7 cursor-default items-center gap-1 pr-3 pl-2 text-xs font-semibold text-fg hover:bg-hover',
        ring && ringClass,
      )}
    >
      <ChevronRight
        size={12}
        className={cn(
          'shrink-0 text-fg-subtle transition-transform duration-150 group-hover:text-fg-muted',
          !row.collapsed && 'rotate-90',
        )}
      />
      <span className="truncate">{label}</span>
      <span className="font-normal text-fg-subtle tabular-nums">{row.count}</span>
    </div>
  )
}

/** Fix button label and tooltip; fixes that may change the look say so. */
function fixTexts(issue: Issue, t: Dict): { label: string; hint: string } {
  const label = issue.fix ? t.insights.fixes[issue.fix] : ''
  return { label, hint: issue.safe ? label : `${label} · ${t.insights.panel.changesLook}` }
}

function IssueRow({
  id,
  row,
  ctx,
  active,
  ring,
}: {
  id: string
  row: Extract<Row, { kind: 'issue' }>
  ctx: RowContext
  active: boolean
  ring: boolean
}) {
  const { issue } = row
  const { o, doc, showPlayers } = ctx
  const t = o.t
  const title = issueTitle(issue, o, doc)
  const where = placesSummary(issue, doc, t)
  const chips = showPlayers ? playerChips(issue.platforms, t) : []
  const shown = chips.length > MAX_CHIPS ? chips.slice(0, MAX_CHIPS - 1) : chips
  const hidden = chips.slice(shown.length)
  const showable = canShow(issue)
  const fix = issue.fix ? fixTexts(issue, t) : null

  const content = (
    <div
      id={id}
      role="treeitem"
      aria-level={2}
      aria-expanded={row.expanded}
      aria-label={title}
      data-testid="issue-row"
      data-code={issue.code}
      className={cn(
        'group/row flex h-11 cursor-default items-start gap-2 pt-1.5 pr-2 pl-3 hover:bg-hover',
        ring && ringClass,
      )}
    >
      <SeverityIcon severity={issue.severity} className="mt-px" />
      <div className="flex min-w-0 flex-1 flex-col">
        <TruncatedText className={cn('h-4 text-sm text-fg', row.expanded && 'font-medium')}>
          {title}
        </TruncatedText>
        <div className="flex h-4 min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
          <TruncatedText className="flex-1">{where}</TruncatedText>
          {shown.map((chip) => (
            <Tooltip
              key={chip.key}
              content={t.insights.panel.playerVerdict(chip.full, t.insights.verdicts[chip.level])}
              side="bottom"
            >
              <span className="shrink-0 text-2xs font-medium text-fg-subtle">{chip.label}</span>
            </Tooltip>
          ))}
          {hidden.length > 0 && (
            <Tooltip
              content={hidden
                .map((c) => t.insights.panel.playerVerdict(c.full, t.insights.verdicts[c.level]))
                .join(' · ')}
              side="bottom"
            >
              <span className="shrink-0 text-2xs font-medium text-fg-subtle">
                {t.insights.panel.moreChips(hidden.length)}
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      {(fix || showable) && !row.expanded && (
        <div
          className={cn(
            '-mt-0.5 hidden shrink-0 items-center gap-0.5 group-hover/row:flex',
            active && ring && 'flex',
          )}
        >
          {fix && (
            <IconButton
              size="xs"
              icon={Wrench}
              label={fix.hint}
              onClick={() => fixIssue(issue)}
              data-testid="issue-fix"
            />
          )}
          {showable && (
            <IconButton
              size="xs"
              icon={LocateFixed}
              label={issue.paths.length > 1 ? t.insights.panel.showAll : t.insights.panel.show}
              onClick={() => showPlaces(issue.paths)}
              data-testid="issue-show"
            />
          )}
        </div>
      )}
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(e) => {
          // The row may be gone (fixed): keep the keyboard in the list.
          e.preventDefault()
          ctx.refocus()
        }}
      >
        <IssueMenuItems issue={issue} ctx={ctx} kind="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Menu items shared by the row context menu and the details overflow menu. */
function IssueMenuItems({
  issue,
  ctx,
  kind,
}: {
  issue: Issue
  ctx: RowContext
  kind: 'context' | 'dropdown'
}) {
  const t = ctx.o.t
  const showable = canShow(issue)
  const jsonPath = issue.paths.find((p) => p.length > 0)
  const tool = toolAction(issue)
  return (
    <>
      {issue.fix && (
        <MenuItem kind={kind} icon={Wrench} onSelect={() => fixIssue(issue)}>
          {t.insights.fixes[issue.fix]}
        </MenuItem>
      )}
      {tool && (
        <MenuItem kind={kind} onSelect={() => runTool(tool)}>
          {toolLabel(tool, t)}
        </MenuItem>
      )}
      {showable && (
        <MenuItem kind={kind} icon={LocateFixed} onSelect={() => showPlaces(issue.paths)}>
          {issue.paths.length > 1 ? t.insights.panel.showAll : t.insights.panel.show}
        </MenuItem>
      )}
      {jsonPath && (
        <MenuItem kind={kind} icon={Braces} onSelect={() => showInJson(jsonPath)}>
          {t.insights.panel.showInJson}
        </MenuItem>
      )}
      {(issue.fix || tool || showable || jsonPath) && <MenuSeparator kind={kind} />}
      <MenuItem kind={kind} icon={Copy} onSelect={() => void copyIssue(issue)}>
        {t.insights.panel.copyDetails}
      </MenuItem>
    </>
  )
}

function toolLabel(tool: ToolAction, t: Dict): string {
  return t.insights.actions[tool]
}

/* ---------------------------------- Details ---------------------------------- */

function IssueDetails({ issue, ctx }: { issue: Issue; ctx: RowContext }) {
  const { o, doc } = ctx
  const t = o.t
  const about = issueAbout(issue, o, doc)
  const platforms = sortedPlatforms(issue.platforms)
  const tool = toolAction(issue)
  const fix = issue.fix ? fixTexts(issue, t) : null
  const showable = canShow(issue)
  const showLabel = issue.paths.length > 1 ? t.insights.panel.showAll : t.insights.panel.show
  return (
    <div className="flex flex-col gap-2 pt-0.5 pr-2 pb-3 pl-[34px]" data-testid="issue-details">
      {about && <p className="selectable text-xs text-fg-muted">{about}</p>}
      {platforms.length > 0 && (
        <div className="flex flex-col" aria-label={t.insights.panel.players}>
          {platforms.map((p) => (
            <div key={p.player} className="flex h-5 min-w-0 items-center gap-1.5 text-xs">
              <LevelIcon level={p.level} size={12} />
              <span className="min-w-0 flex-1 truncate text-fg-muted">
                {t.insights.players[p.player].full}
              </span>
              <Tooltip content={levelText(p.player, p.level, t)} side="left">
                <span className={cn('shrink-0', LEVEL_TEXT[p.level])}>
                  {verdictText(p.player, p.level, t)}
                </span>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-start gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {fix && (
            <Tooltip content={issue.safe ? undefined : t.insights.panel.changesLook} side="bottom">
              <Button
                size="sm"
                variant="secondary"
                icon={issue.safe ? Wrench : TriangleAlert}
                onClick={() => {
                  fixIssue(issue)
                  ctx.refocus()
                }}
                data-testid="issue-details-fix"
              >
                {fix.label}
              </Button>
            </Tooltip>
          )}
          {tool && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => runTool(tool)}
              data-testid="issue-tool"
            >
              {toolLabel(tool, t)}
            </Button>
          )}
          {showable && !fix && !tool && (
            <Button
              size="sm"
              variant="ghost"
              icon={LocateFixed}
              onClick={() => showPlaces(issue.paths)}
              className="-ml-2"
            >
              {showLabel}
            </Button>
          )}
        </div>
        {showable && (fix || tool) && (
          <IconButton
            icon={LocateFixed}
            label={showLabel}
            onClick={() => showPlaces(issue.paths)}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={Ellipsis} label={t.common.more} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <IssueMenuItems issue={issue} ctx={ctx} kind="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/* ----------------------------------- Places ---------------------------------- */

function PlaceIcon({ doc, path }: { doc: Animation | null; path: NodePath }) {
  // Properties show the icon of the layer or shape item they belong to.
  const nodePath = doc ? showTarget(doc, path).node : null
  const node = doc && nodePath ? getAt(doc, nodePath) : undefined
  if (nodePath && node && typeof node === 'object') {
    if (isLayerPath(nodePath)) return <LayerKindIcon kind={layerKind(node as Layer)} size={12} />
    const ty = (node as { ty?: unknown }).ty
    // Shape types are two letters; anything else in a damaged file gets the generic icon.
    if (isShapePath(nodePath) && typeof ty === 'string' && /^[a-z]{2}$/.test(ty)) {
      return <ShapeTypeIcon item={node as { ty: string }} size={12} />
    }
  }
  return <Braces size={12} className="shrink-0 text-fg-faint" aria-hidden />
}

function PlaceRow({
  id,
  row,
  ctx,
  ring,
}: {
  id: string
  row: Extract<Row, { kind: 'place' }>
  ctx: RowContext
  ring: boolean
}) {
  const { o, doc } = ctx
  const t = o.t
  const loc = doc ? locate(doc, row.path, t) : { comp: null, parts: [] }
  const text = loc.parts.join(' › ')
  const perPlaceFix = canFixPlace(row.issue)
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={3}
      data-testid="issue-place"
      className={cn(
        'group/place flex h-6 cursor-default items-center gap-1.5 pr-2 pl-[34px] text-xs hover:bg-hover',
        ring && ringClass,
      )}
    >
      <PlaceIcon doc={doc} path={row.path} />
      <TruncatedText
        tooltip={loc.comp ? `${loc.comp} › ${text}` : text}
        className="flex-1 text-fg-muted"
      >
        {loc.comp && <span className="text-fg-subtle">{loc.comp} › </span>}
        {text}
      </TruncatedText>
      <div className="hidden shrink-0 items-center gap-0.5 group-hover/place:flex">
        {perPlaceFix && (
          <Tooltip content={fixTexts(row.issue, t).hint} side="bottom">
            <Button size="xs" variant="ghost" onClick={() => fixIssue(row.issue, [row.path])}>
              {t.insights.panel.fix}
            </Button>
          </Tooltip>
        )}
        <IconButton
          size="xs"
          icon={Braces}
          label={t.insights.panel.showInJson}
          onClick={() => showInJson(row.path)}
        />
      </div>
    </div>
  )
}
