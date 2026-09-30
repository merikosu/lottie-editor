import { Ellipsis } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { ContextMenu as RadixContextMenu, DropdownMenu as RadixDropdown } from 'radix-ui'
import {
  ContextMenu,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  type MenuKind,
} from '@/components/ui'
import { menuContentClass } from '@/components/ui/menu'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

/**
 * After a menu closes, focus returns to its row — unless the chosen action moved focus
 * somewhere useful (inline rename, font popover, JSON editor), which Radix would undo.
 */
function restoreFocus(e: Event, rowId: string | null) {
  e.preventDefault()
  const active = document.activeElement
  if (active && active !== document.body && !active.closest('[role="menu"]')) return
  const row = rowId
    ? document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(rowId)}"]`)
    : null
  row?.focus({ preventScroll: true })
}

/** Moves keyboard focus between the rows of the same list. */
function focusSibling(row: HTMLElement, key: string): boolean {
  const list = row.closest('[role="listbox"]')
  if (!list) return false
  const rows = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))
  const index = rows.indexOf(row)
  let next = -1
  if (key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1)
  else if (key === 'ArrowUp') next = Math.max(0, index - 1)
  else if (key === 'Home') next = 0
  else if (key === 'End') next = rows.length - 1
  if (next < 0 || next === index) return next >= 0
  rows[next].focus()
  rows[next].scrollIntoView({ block: 'nearest' })
  return true
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

/* --------------------------------- List ---------------------------------- */

interface AssetListProps {
  label: string
  /** Menu items for the row with this id (shared context menu of the list). */
  renderMenu: (id: string, kind: MenuKind) => ReactNode
  /** Called when a row is right-clicked (selects it). */
  onRowContext: (id: string) => void
  children: ReactNode
}

/**
 * A section's rows. One context menu serves every row (instead of one per row), which keeps
 * lists of hundreds of assets cheap to mount.
 */
export function AssetList({ label, renderMenu, onRowContext, children }: AssetListProps) {
  const [menuId, setMenuId] = useState<string | null>(null)
  const onContextMenu = (e: MouseEvent) => {
    const row = (e.target as Element).closest('[data-asset-id]')
    const id = row?.getAttribute('data-asset-id')
    // Outside a row (gaps): no menu at all.
    if (!id) {
      e.preventDefault()
      return
    }
    setMenuId(id)
    onRowContext(id)
  }
  return (
    // Non-modal: actions like "Rename" or "Show in JSON" must be able to move focus.
    <ContextMenu modal={false} onOpenChange={(open) => !open && setMenuId(null)}>
      <ContextMenuTrigger asChild>
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a <select> can't hold rich rows
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="flex flex-col gap-px outline-none"
          onContextMenu={onContextMenu}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content
          collisionPadding={8}
          className={menuContentClass}
          onCloseAutoFocus={(e) => restoreFocus(e, menuId)}
        >
          {menuId !== null && renderMenu(menuId, 'context')}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </ContextMenu>
  )
}

/* ---------------------------------- Row ---------------------------------- */

export interface AssetRowProps {
  id: string
  selected: boolean
  /** Tab stop of the list while none of its rows is selected (roving tab index). */
  tabbable?: boolean
  thumb: ReactNode
  title: ReactNode
  /** Full title for the tooltip when it is truncated. */
  titleText: string
  badge?: ReactNode
  meta: ReactNode
  /** Right-aligned text on the first line (usage). */
  trailing?: ReactNode
  trailingHint?: string
  /** Items of the "…" menu (the same items as the list's context menu). */
  menu: (kind: MenuKind) => ReactNode
  onSelect: () => void
  /** Enter. */
  onOpen?: () => void
  /** Double-click / F2. */
  onRename?: () => void
  /** Delete / Backspace (only when allowed). */
  onDelete?: () => void
  /** Inline editor replacing the title while renaming. */
  renaming?: ReactNode
  /** Accepts dropped files (e.g. image replacement). */
  onDropFiles?: (files: File[]) => void
  dropLabel?: string
  dragOver?: boolean
  onDragOverChange?: (over: boolean) => void
  /** Extra content positioned relative to the row (popover anchors). */
  children?: ReactNode
  testId?: string
  /** Many rows: let the browser skip rendering off-screen ones. */
  lazy?: boolean
}

/**
 * 48px asset row: thumbnail, two lines of text, usage and actions. Tooltips and the "…" menu
 * only mount while the row is active (hovered, focused or selected); idle rows are plain DOM.
 */
export function AssetRow(props: AssetRowProps) {
  const t = useT()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)
  const active = hovered || focused || menuOpen || props.selected || !!props.renaming

  // Keep keyboard focus on the selected row when the selection changes from elsewhere.
  useEffect(() => {
    if (!props.selected) return
    const row = rowRef.current
    const list = row?.closest('[role="listbox"]')
    if (
      row &&
      list?.contains(document.activeElement) &&
      document.activeElement !== row &&
      !props.renaming
    ) {
      row.focus({ preventScroll: true })
    }
  }, [props.selected, props.renaming])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    let handled = true
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key))
      handled = focusSibling(e.currentTarget, e.key)
    else if (e.key === 'Enter') props.onOpen?.()
    else if (e.key === 'F2' && props.onRename) props.onRename()
    else if ((e.key === 'Delete' || e.key === 'Backspace') && props.onDelete) props.onDelete()
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) setMenuOpen(true)
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const dropHandlers = props.onDropFiles
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          props.onDragOverChange?.(true)
        },
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: (e: DragEvent) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          props.onDragOverChange?.(false)
        },
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return
          // preventDefault marks the drop as handled; it still bubbles so the window-wide drop
          // overlay hides right away (it leaves handled drops alone).
          e.preventDefault()
          props.onDragOverChange?.(false)
          props.onDropFiles?.(Array.from(e.dataTransfer.files))
        },
      }
    : {}

  const titleNode = (
    <span
      ref={titleRef}
      onPointerEnter={() => {
        const el = titleRef.current
        setTruncated(!!el && el.scrollWidth > el.clientWidth)
      }}
      className="min-w-0 truncate text-sm text-fg"
    >
      {props.title}
    </span>
  )
  const trailingNode =
    props.trailing !== undefined ? (
      <span className="ml-auto shrink-0 pl-1 text-xs whitespace-nowrap text-fg-subtle tabular-nums">
        {props.trailing}
      </span>
    ) : null

  return (
    <div
      ref={rowRef}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- rich rows (thumbnail, badges, menu) can't be native <option>s
      role="option"
      aria-selected={props.selected}
      tabIndex={props.selected || props.tabbable ? 0 : -1}
      data-testid={props.testId}
      data-asset-id={props.id}
      onClick={props.onSelect}
      onFocus={(e) => {
        if (e.target !== e.currentTarget) return
        setFocused(true)
        if (!props.selected) props.onSelect()
      }}
      onBlur={(e) => {
        if (e.target === e.currentTarget) setFocused(false)
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDoubleClick={props.onRename}
      onKeyDown={onKeyDown}
      {...dropHandlers}
      className={cn(
        'group relative flex h-12 items-center gap-2.5 rounded-md pr-1 pl-2 outline-none select-none',
        'transition-colors duration-100 focus-visible:shadow-[inset_0_0_0_1px_var(--le-accent)]',
        props.selected ? 'bg-selected' : 'hover:bg-hover',
        props.dragOver && 'bg-accent-subtle shadow-[inset_0_0_0_1px_var(--le-accent)]',
      )}
      style={
        props.lazy ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 48px' } : undefined
      }
    >
      {props.thumb}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {props.renaming ?? (
          <div className="flex min-w-0 items-center gap-1.5">
            {active && truncated ? (
              <Tooltip content={props.titleText} side="top" align="start">
                {titleNode}
              </Tooltip>
            ) : (
              titleNode
            )}
            {props.badge}
            {trailingNode &&
              (active && props.trailingHint ? (
                <Tooltip content={props.trailingHint} side="top">
                  {trailingNode}
                </Tooltip>
              ) : (
                trailingNode
              ))}
          </div>
        )}
        <div className="min-w-0 truncate text-xs text-fg-subtle tabular-nums">
          {props.dragOver && props.dropLabel ? (
            <span className="text-accent-text">{props.dropLabel}</span>
          ) : (
            props.meta
          )}
        </div>
      </div>
      {active ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={Ellipsis}
              label={t.assets.rowActions}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                props.onSelect()
              }}
              className={cn(
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
                props.selected && 'opacity-100',
              )}
            />
          </DropdownMenuTrigger>
          <RadixDropdown.Portal>
            <RadixDropdown.Content
              align="end"
              sideOffset={4}
              collisionPadding={8}
              className={menuContentClass}
              onCloseAutoFocus={(e) => restoreFocus(e, props.id)}
            >
              {props.menu('dropdown')}
            </RadixDropdown.Content>
          </RadixDropdown.Portal>
        </DropdownMenu>
      ) : (
        // Same footprint as the button, so rows don't shift when it appears.
        <span className="size-6 shrink-0" aria-hidden />
      )}
      {props.children}
    </div>
  )
}

interface RenameFieldProps {
  initial: string
  /** Returns an error message for invalid values, or null. */
  validate?: (value: string) => string | null
  onCommit: (value: string) => void
  onCancel: () => void
  label: string
}

/** Inline rename input with the metrics of the row title. */
export function RenameField({ initial, validate, onCommit, onCancel, label }: RenameFieldProps) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const error = validate?.(value) ?? null

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    if (done.current) return
    done.current = true
    if (error || value.trim() === initial) onCancel()
    else onCommit(value.trim())
  }

  return (
    <Tooltip content={error} disabled={!error} side="top" align="start">
      <input
        ref={inputRef}
        value={value}
        aria-label={label}
        aria-invalid={!!error}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (!error) commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            done.current = true
            onCancel()
          }
        }}
        onBlur={commit}
        className={cn(
          '-ml-1 h-5 w-full min-w-0 rounded-sm bg-surface-2 px-1 text-sm text-fg outline-none',
          error
            ? 'shadow-[inset_0_0_0_1px_var(--le-danger)]'
            : 'shadow-[inset_0_0_0_1px_var(--le-accent)]',
        )}
      />
    </Tooltip>
  )
}
