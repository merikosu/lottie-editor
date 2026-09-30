/**
 * History panel (left sidebar): the opened state and every undo step, with the current state
 * highlighted and undone steps dimmed. Clicking a step goes back (or forward) to it; with the
 * list focused, ↑/↓ step through history, Home/End jump to either end, and every other
 * shortcut (⌘Z, Space, …) works as it does anywhere else.
 */
import { History, Redo2, Undo2 } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { runCommand } from '@/commands/registry'
import { EmptyState, IconButton, Tooltip } from '@/components/ui'
import { useLanguage, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { jumpToHistory, useDocument } from '@/store/document'
import { forwardToShortcuts } from './history/keys'
import { buildHistoryRows, type HistoryRow } from './history/model'
import { formatFullTime, formatHistoryTime } from './history/time'
import { TruncatedLabel } from './history/TruncatedLabel'
import { useHistoryBase } from './history/tracker'
import { scrollToReveal, useVirtualRows } from './history/useVirtualRows'

const ROW_HEIGHT = 28
/** Vertical padding of the list (py-1). */
const LIST_PADDING = 4
const REFRESH_MS = 30_000
const HOUR = 3_600_000

/**
 * Current time for relative labels ("5 min"), refreshed while the newest step is less than an
 * hour old (older ones show a fixed clock time). A step just made is never in the future, so
 * the clock is at least its time even before the next tick.
 */
function useNow(newest: number): number {
  const [tick, setTick] = useState(() => Date.now())
  const now = Math.max(tick, newest)
  const active = now - newest < HOUR
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setTick(Date.now()), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

/** Rows are windowed, so one listener on the list handles clicks on any of them. */
function onListClick(e: MouseEvent<HTMLDivElement>): void {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
  if (row) jumpToHistory(Number(row.dataset.index))
}

/** Timeline marker: a dot per state on a vertical line (solid up to the current state). */
function Marker({ row, last, current }: { row: HistoryRow; last: boolean; current: number }) {
  return (
    <span className="relative flex h-full w-5 shrink-0 items-center justify-center" aria-hidden>
      {row.index > 0 && (
        <span
          className={cn(
            'absolute top-0 left-1/2 h-1/2 w-px -translate-x-1/2',
            row.index <= current ? 'bg-line-strong' : 'bg-line',
          )}
        />
      )}
      {!last && (
        <span
          className={cn(
            'absolute bottom-0 left-1/2 h-1/2 w-px -translate-x-1/2',
            row.index < current ? 'bg-line-strong' : 'bg-line',
          )}
        />
      )}
      <span
        className={cn(
          'relative rounded-full',
          row.state === 'current' && 'size-2 bg-accent',
          row.state === 'past' && 'size-1.5 bg-fg-subtle',
          row.state === 'future' &&
            'size-1.5 bg-surface-1 shadow-[inset_0_0_0_1px_var(--le-fg-faint)]',
        )}
      />
    </span>
  )
}

/** Undone steps are dimmed; the opened state is quieter than real steps unless it is current. */
function labelColor(row: HistoryRow): string {
  if (row.state === 'future') return 'text-fg-subtle'
  if (row.initial && row.state !== 'current') return 'text-fg-muted'
  return 'text-fg'
}

interface RowViewProps {
  row: HistoryRow
  id: string
  label: string
  labelHint?: string
  time: string
  fullTime: string
  last: boolean
  current: number
  style: CSSProperties
}

function RowView({
  row,
  id,
  label,
  labelHint,
  time,
  fullTime,
  last,
  current,
  style,
}: RowViewProps) {
  return (
    <div
      id={id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- rich rows can't be native <option>s
      role="option"
      aria-selected={row.state === 'current'}
      data-state={row.state}
      data-index={row.index}
      data-testid="history-row"
      style={style}
      className={cn(
        'absolute inset-x-0 flex cursor-default items-center gap-1.5 pr-3 pl-1.5 select-none',
        row.state === 'current'
          ? 'bg-selected group-focus-visible:shadow-[inset_0_0_0_1px_var(--le-accent)]'
          : 'hover:bg-hover',
      )}
    >
      <Marker row={row} last={last} current={current} />
      <TruncatedLabel text={label} hint={labelHint} className={cn('text-sm', labelColor(row))} />
      <Tooltip content={fullTime} side="right">
        <span className="shrink-0 text-xs text-fg-subtle tabular-nums">{time}</span>
      </Tooltip>
    </div>
  )
}

function HistoryList() {
  const t = useT()
  const h = t.workspace.history
  const language = useLanguage()
  const meta = useDocument((s) => s.meta)
  const past = useDocument((s) => s.past)
  const future = useDocument((s) => s.future)
  const truncated = useHistoryBase((s) => s.truncated)
  const listId = useId()
  const scrollRef = useRef<HTMLDivElement>(null)

  const fileName = meta?.fileName ?? ''
  const loadedAt = meta?.loadedAt ?? 0
  const rows = useMemo(
    () => buildHistoryRows(past, future, { label: fileName, time: loadedAt }),
    [past, future, fileName, loadedAt],
  )
  const current = past.length
  const steps = past.length + future.length
  const range = useVirtualRows(scrollRef, rows.length, ROW_HEIGHT, 8, LIST_PADDING)
  const now = useNow(rows.reduce((max, r) => Math.max(max, r.time), 0))
  const rowId = (index: number) => `${listId}-${index}`

  // Keep the current state in view (after undo/redo from anywhere, and when the panel opens).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const top = scrollToReveal(current, el.scrollTop, el.clientHeight, ROW_HEIGHT, LIST_PADDING)
    if (top !== null) el.scrollTop = top
  }, [current])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const plain = !(e.altKey || e.metaKey || e.ctrlKey || e.shiftKey)
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1)
    const targets: Partial<Record<string, number>> = {
      ArrowUp: current - 1,
      ArrowDown: current + 1,
      Home: 0,
      End: steps,
      PageUp: current - page,
      PageDown: current + page,
    }
    const target = plain ? targets[e.key] : undefined
    if (target === undefined) {
      forwardToShortcuts(e)
      return
    }
    e.preventDefault()
    jumpToHistory(Math.max(0, Math.min(steps, target)))
  }

  const undoLabel = past.length
    ? t.app.history.undo(past[past.length - 1].label)
    : t.app.history.nothingToUndo
  const redoLabel = future.length
    ? t.app.history.redo(future[0].label)
    : t.app.history.nothingToRedo

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="history-panel">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle tabular-nums">
          {h.steps(steps)}
          {future.length > 0 && ` · ${h.undone(future.length)}`}
        </span>
        <IconButton
          icon={Undo2}
          label={undoLabel}
          shortcut="mod+z"
          disabled={!past.length}
          onClick={() => runCommand('edit.undo')}
        />
        <IconButton
          icon={Redo2}
          label={redoLabel}
          shortcut="mod+shift+z"
          disabled={!future.length}
          onClick={() => runCommand('edit.redo')}
        />
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a <select> can't hold rich rows
          role="listbox"
          tabIndex={0}
          aria-label={h.listLabel}
          aria-activedescendant={rowId(current)}
          onKeyDown={onKeyDown}
          onClick={onListClick}
          className="group relative outline-none"
          style={{ height: rows.length * ROW_HEIGHT }}
        >
          {rows.slice(range.start, range.end).map((row) => (
            <RowView
              key={row.key}
              row={row}
              id={rowId(row.index)}
              label={row.initial ? (truncated ? h.earlier : h.opened(row.label)) : row.label}
              labelHint={row.initial && truncated ? h.earlierHint : undefined}
              time={formatHistoryTime(row.time, now, language, h)}
              fullTime={formatFullTime(row.time, language)}
              last={row.index === rows.length - 1}
              current={current}
              style={{ top: row.index * ROW_HEIGHT, height: ROW_HEIGHT }}
            />
          ))}
        </div>
        {steps === 0 && (
          <EmptyState className="h-auto min-h-0 py-8" title={h.empty} description={h.emptyHint} />
        )}
      </div>
    </div>
  )
}

/** Left sidebar "History" tab. */
export function HistoryPanel() {
  const t = useT()
  const hasDoc = useDocument((s) => s.doc !== null)
  if (!hasDoc) return <EmptyState icon={History} title={t.common.noDocument} />
  return <HistoryList />
}
