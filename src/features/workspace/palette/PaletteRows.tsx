/**
 * Rows of the command palette. The highlighted row uses the menu highlight (accent fill), so
 * the palette reads as the same family as the app's menus.
 */
import { Command } from 'cmdk'
import { ArrowRightToLine, Check, Gauge } from 'lucide-react'
import type { ReactNode } from 'react'
import { Kbd } from '@/components/ui'
import { LayerKindIcon } from '@/components/lottie/icons'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/format'
import { Highlight } from './Highlight'
import { formatSpeed } from './quick-actions'
import type { PaletteRow } from './sections'

const itemClass = cn(
  'group relative flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm text-fg outline-none select-none',
  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-fg',
  'data-[disabled=true]:text-fg-subtle',
)

/** Secondary text on the right of a row. */
const metaClass =
  'shrink-0 truncate text-xs text-fg-subtle group-data-[selected=true]:text-accent-fg/75'
/** Section name next to a search result: quieter than other secondary text. */
const groupClass =
  'shrink-0 truncate text-xs text-fg-faint group-data-[selected=true]:text-accent-fg/60'
const iconClass =
  'shrink-0 text-fg-muted group-data-[selected=true]:text-accent-fg group-data-[disabled=true]:text-fg-faint'

function Row({
  row,
  onSelect,
  disabled,
  children,
}: {
  row: PaletteRow
  onSelect: (row: PaletteRow) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Command.Item
      value={row.value}
      disabled={disabled}
      onSelect={() => onSelect(row)}
      className={itemClass}
      data-testid={`palette-${row.type}`}
    >
      {children}
    </Command.Item>
  )
}

function IconSlot({ children }: { children?: ReactNode }) {
  return <span className="flex size-4 shrink-0 items-center justify-center">{children}</span>
}

/** Title of a command row, with the service description after it when there is one. */
function CommandTitle({
  title,
  hint,
  positions,
}: {
  title: string
  hint?: string
  positions: number[]
}) {
  if (!hint) {
    return (
      <span className="min-w-0 flex-1 truncate">
        <Highlight text={title} positions={positions} />
      </span>
    )
  }
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="shrink-0">
        <Highlight text={title} positions={positions} />
      </span>
      <span className={cn(metaClass, 'min-w-0 shrink')}>{hint}</span>
    </span>
  )
}

export function PaletteRowView({
  row,
  onSelect,
  fps,
  speed,
}: {
  row: PaletteRow
  onSelect: (row: PaletteRow) => void
  /** Frame rate of the open animation (for time hints). */
  fps: number
  /** Current preview speed. */
  speed: number
}) {
  const t = useT()
  const p = t.workspace.palette
  switch (row.type) {
    case 'command': {
      const c = row.command
      const Icon = c.icon
      // Where the result runs matters more than its section; a described service needs neither.
      const context = row.destination
        ? p.opensIn[row.destination]
        : row.showGroup && !c.hint
          ? c.groupLabel
          : null
      return (
        <Row row={row} onSelect={onSelect} disabled={!row.available}>
          <IconSlot>{Icon && <Icon size={16} className={iconClass} />}</IconSlot>
          <CommandTitle title={c.title} hint={c.hint} positions={row.positions} />
          {row.available ? (
            <>
              {context && <span className={groupClass}>{context}</span>}
              {c.checked && (
                <>
                  <Check
                    size={14}
                    className="shrink-0 text-accent-text group-data-[selected=true]:text-accent-fg"
                  />
                  <span className="sr-only">{p.checked}</span>
                </>
              )}
              {c.shortcut && (
                <Kbd
                  shortcut={c.shortcut}
                  className="shrink-0 pl-1 group-data-[selected=true]:text-accent-fg/80"
                />
              )}
            </>
          ) : (
            c.reason && <span className={metaClass}>{c.reason}</span>
          )}
        </Row>
      )
    }
    case 'layer': {
      const l = row.layer
      return (
        <Row row={row} onSelect={onSelect}>
          <IconSlot>
            <LayerKindIcon
              kind={l.kind}
              size={16}
              className="group-data-[selected=true]:text-accent-fg"
            />
          </IconSlot>
          <span className={cn('min-w-0 flex-1 truncate', l.hidden && 'opacity-60')}>
            <Highlight text={l.name} positions={row.positions} />
          </span>
          {l.comp && <span className={cn(metaClass, 'max-w-[45%]')}>{l.comp}</span>}
          {l.ordinal !== undefined && (
            <span className={cn(metaClass, 'tabular-nums')}>#{l.ordinal}</span>
          )}
        </Row>
      )
    }
    case 'frame': {
      const a = row.action
      return (
        <Row row={row} onSelect={onSelect} disabled={!a.inRange}>
          <IconSlot>
            <ArrowRightToLine size={16} className={iconClass} />
          </IconSlot>
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {p.goToFrame(String(a.frame))}
          </span>
          <span className={cn(metaClass, 'tabular-nums')}>
            {a.inRange
              ? formatTimecode(a.frame, fps)
              : p.frameRange(String(a.first), String(a.last))}
          </span>
        </Row>
      )
    }
    case 'speed':
      return (
        <Row row={row} onSelect={onSelect}>
          <IconSlot>
            <Gauge size={16} className={iconClass} />
          </IconSlot>
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {p.setSpeed(formatSpeed(row.action.speed))}
          </span>
          <span className={cn(metaClass, 'tabular-nums')}>
            {p.currentSpeed(formatSpeed(speed))}
          </span>
        </Row>
      )
  }
}
