/**
 * Sticky 32px header: icon, inline-editable name, type/timing subtitle, visibility toggle
 * and an overflow menu (commands by id, reveal helpers).
 */
import {
  Braces,
  Crosshair,
  Ellipsis,
  Eye,
  EyeOff,
  ListTree,
  Lock,
  LockOpen,
  Pencil,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
} from '@/components/ui'
import type { IconProps } from '@/commands/registry'
import { isCommandEnabled, primaryShortcut, runCommand, useCommand } from '@/commands/registry'
import { useT } from '@/i18n'
import { emit } from '@/lib/events'
import { cn } from '@/lib/cn'
import type { NodePath } from '@/lottie/path'
import { setPrefs } from '@/store/prefs'
import { useInspectorRequests } from '../state'

export interface HeaderProps {
  icon: ComponentType<IconProps> | LucideIcon
  /** Classes for the icon (e.g. the layer kind color). */
  iconClassName?: string
  name: string
  /** Shown when `name` is empty. */
  placeholder?: string
  subtitle?: string
  /** Enables inline rename. */
  onRename?: (name: string) => void
  /** Visibility toggle (layers and shape items). */
  hidden?: boolean | null
  onToggleHidden?: () => void
  /** Canvas lock (layers and shape items): shown as a button while locked, and in the menu. */
  locked?: boolean
  onToggleLocked?: () => void
  /** Node paths for the reveal actions. */
  paths?: NodePath[]
  /** Command ids listed first in the overflow menu. */
  commands?: string[]
  extraMenu?: ReactNode
}

export function InspectorHeader({
  icon: Icon,
  iconClassName,
  name,
  placeholder,
  subtitle,
  onRename,
  hidden,
  onToggleHidden,
  locked,
  onToggleLocked,
  paths = [],
  commands = [],
  extraMenu,
}: HeaderProps) {
  const t = useT()
  const th = t.inspector.header
  const [editing, setEditing] = useState(false)
  const canRename = !!onRename

  // Other features ask for a rename by bumping the request token.
  useEffect(() => {
    if (!canRename) return
    return useInspectorRequests.subscribe((s, prev) => {
      if (s.renameToken !== prev.renameToken) setEditing(true)
    })
  }, [canRename])

  const primary = paths[paths.length - 1]
  const hasMenu = commands.length > 0 || !!primary || !!extraMenu

  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-line pr-1.5 pl-3">
      <Icon size={14} className={cn('shrink-0', iconClassName ?? 'text-fg-subtle')} />
      {/* The name keeps its full width when it fits; the subtitle gets what is left. */}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-2">
        {editing && onRename ? (
          <NameInput
            initial={name}
            placeholder={placeholder}
            onDone={(next) => {
              setEditing(false)
              if (next !== null && next !== name) onRename(next)
            }}
          />
        ) : onRename ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            // The full name too: long names are truncated.
            title={name ? `${name}\n${th.clickToRename}` : th.clickToRename}
            className="-mx-1 h-6 min-w-[3ch] truncate rounded-sm px-1 text-left text-sm font-medium text-fg hover:bg-hover"
          >
            {name || <span className="text-fg-subtle">{placeholder}</span>}
          </button>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium text-fg" title={name || undefined}>
            {name || placeholder}
          </span>
        )}
        {subtitle && !editing && (
          <span className="min-w-0 truncate text-xs text-fg-subtle tabular-nums">{subtitle}</span>
        )}
      </div>
      {locked && onToggleLocked && (
        <IconButton
          icon={Lock}
          label={th.lockedHint}
          onClick={onToggleLocked}
          className="text-fg-muted"
        />
      )}
      {onToggleHidden && (
        <IconButton
          icon={hidden ? EyeOff : Eye}
          label={hidden ? th.show : th.hide}
          onClick={onToggleHidden}
          className={cn(hidden && 'text-fg-subtle')}
        />
      )}
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={Ellipsis} label={th.moreActions} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRename && (
              <MenuItem icon={Pencil} onSelect={() => setTimeout(() => setEditing(true), 0)}>
                {th.rename}
              </MenuItem>
            )}
            {commands.map((id) => (
              <CommandItem key={id} id={id} />
            ))}
            {onToggleLocked && (
              <MenuItem icon={locked ? LockOpen : Lock} onSelect={onToggleLocked}>
                {locked ? th.unlock : th.lock}
              </MenuItem>
            )}
            {extraMenu}
            {primary && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={ListTree}
                  onSelect={() => {
                    setPrefs({ leftTab: 'layers' })
                    emit('reveal-node', { path: primary })
                  }}
                >
                  {th.revealInLayers}
                </MenuItem>
                <MenuItem icon={Crosshair} onSelect={() => emit('zoom-to-node', { path: primary })}>
                  {th.zoomTo}
                </MenuItem>
                <MenuItem icon={Braces} onSelect={() => emit('reveal-code', { path: primary })}>
                  {th.showInJson}
                </MenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/** Menu item for a registered command (hidden when the command does not exist). */
export function CommandItem({ id }: { id: string }) {
  const t = useT()
  const cmd = useCommand(id)
  if (!cmd) return null
  return (
    <MenuItem
      icon={cmd.icon}
      shortcut={primaryShortcut(cmd)}
      disabled={!isCommandEnabled(cmd)}
      danger={id === 'edit.delete'}
      onSelect={() => runCommand(id)}
    >
      {cmd.title(t)}
    </MenuItem>
  )
}

function NameInput({
  initial,
  placeholder,
  onDone,
}: {
  initial: string
  placeholder?: string
  onDone: (value: string | null) => void
}) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value.trim())
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null)
        }
      }}
      className="col-span-2 -mx-1 h-6 min-w-0 rounded-sm bg-surface-2 px-1 text-sm font-medium text-fg shadow-[inset_0_0_0_1px_var(--le-accent)] outline-none"
    />
  )
}
