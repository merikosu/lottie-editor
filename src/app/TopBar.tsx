import { Command as CommandIcon, Download, Menu as MenuIcon, Redo2, Undo2 } from 'lucide-react'
import { Fragment, useRef, useState } from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  MenuSub,
  Menubar,
  MenubarContent,
  MenubarMenu,
  MenubarTrigger,
  Tooltip,
  type MenuKind,
} from '@/components/ui'
import {
  isCommandEnabled,
  primaryShortcut,
  runCommand,
  useCommands,
  type Command,
} from '@/commands/registry'
import { useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { isDirty, setDocumentMeta, useDocument } from '@/store/document'
import { setCommandPaletteOpen } from '@/store/ui'
import { SaveStatus } from '@/features/io'
import { ErrorBoundary } from './ErrorBoundary'
import { renamedFileName, stemLength } from './file-name'
import { Logo } from './Logo'
import { navigate, useRoute } from './router'
import { ServiceSwitcher } from './ServiceSwitcher'
import { MENUS, type MenuEntry } from './menus'

/** Removes unregistered commands, empty submenus and duplicate/edge separators. */
function resolveEntries(entries: MenuEntry[], commands: Map<string, Command>): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const e of entries) {
    if (e === '-') {
      if (out.length && out[out.length - 1] !== '-') out.push(e)
    } else if (typeof e === 'string') {
      if (commands.has(e)) out.push(e)
    } else {
      const items = resolveEntries(e.items, commands)
      if (items.length) out.push({ ...e, items })
    }
  }
  while (out[out.length - 1] === '-') out.pop()
  return out
}

function MenuEntries({
  entries,
  commands,
  t,
  kind = 'menubar',
}: {
  entries: MenuEntry[]
  commands: Map<string, Command>
  t: Dict
  kind?: MenuKind
}) {
  return (
    <>
      {entries.map((e, i) => {
        if (e === '-') return <MenuSeparator kind={kind} key={`sep-${i}`} />
        if (typeof e !== 'string') {
          return (
            <MenuSub kind={kind} key={`sub-${i}`} label={e.label(t)}>
              <MenuEntries entries={e.items} commands={commands} t={t} kind={kind} />
            </MenuSub>
          )
        }
        const cmd = commands.get(e)!
        const enabled = isCommandEnabled(cmd)
        if (cmd.checked) {
          return (
            <MenuCheckboxItem
              kind={kind}
              key={cmd.id}
              checked={cmd.checked()}
              disabled={!enabled}
              shortcut={primaryShortcut(cmd)}
              onSelect={() => runCommand(cmd.id)}
            >
              {cmd.title(t)}
            </MenuCheckboxItem>
          )
        }
        return (
          <MenuItem
            kind={kind}
            key={cmd.id}
            icon={cmd.icon}
            disabled={!enabled}
            shortcut={primaryShortcut(cmd)}
            onSelect={() => runCommand(cmd.id)}
          >
            {cmd.title(t)}
          </MenuItem>
        )
      })}
    </>
  )
}

/** All menus in one dropdown, for narrow windows. */
function CompactMenu({ className }: { className?: string }) {
  const t = useT()
  const commands = useCommands()
  useDocument((s) => s.revision)
  return (
    <div className={className}>
      <DropdownMenu>
        <Tooltip content={t.app.menu.all}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t.app.menu.all}
              className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg"
            >
              <MenuIcon size={16} />
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent>
          {MENUS.map((menu) => {
            const entries = resolveEntries(menu.items, commands)
            if (!entries.length) return null
            return (
              <MenuSub kind="dropdown" key={menu.id} label={menu.label(t)}>
                <MenuEntries entries={entries} commands={commands} t={t} kind="dropdown" />
              </MenuSub>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function AppMenubar({ className }: { className?: string }) {
  const t = useT()
  const commands = useCommands()
  // Re-render menus on document/history changes so enabled/checked states are fresh when opened.
  useDocument((s) => s.revision)
  const [open, setOpen] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  // Where focus was when a menu was opened from outside the menubar (with the mouse): closing
  // the menus gives it back there, as desktop editors do. Left on a trigger, the menubar's
  // roving focus would take the editor's single-key shortcuts (End, Space) until a click.
  const returnFocus = useRef<Element | null>(null)
  const openRef = useRef('')

  const onValueChange = (value: string) => {
    if (value && !openRef.current) {
      const active = document.activeElement
      returnFocus.current = active && !rootRef.current?.contains(active) ? active : null
    }
    openRef.current = value
    setOpen(value)
  }
  const onCloseAutoFocus = (e: Event) => {
    // Moving to another menu of the bar, or a menubar entered with the keyboard: Radix knows best.
    if (openRef.current || !returnFocus.current) return
    const back = returnFocus.current
    returnFocus.current = null
    e.preventDefault()
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) {
      back.focus({ preventScroll: true })
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }

  return (
    <Menubar
      ref={rootRef}
      value={open}
      onValueChange={onValueChange}
      className={cn('flex items-center gap-0.5', className)}
    >
      {MENUS.map((menu) => {
        const entries = resolveEntries(menu.items, commands)
        if (!entries.length) return null
        return (
          <MenubarMenu key={menu.id} value={menu.id}>
            <MenubarTrigger>{menu.label(t)}</MenubarTrigger>
            <MenubarContent onCloseAutoFocus={onCloseAutoFocus}>
              {open === menu.id && <MenuEntries entries={entries} commands={commands} t={t} />}
            </MenubarContent>
          </MenubarMenu>
        )
      })}
    </Menubar>
  )
}

/**
 * The open document's file name. Double-click (or Enter / F2 while it has focus) renames it: the
 * name without its extension is selected, and the extension stays (see file-name.ts). The
 * tooltip gives the full name when it is cut off, and whether it changed since the last export.
 */
function DocumentTitle() {
  const t = useT()
  const meta = useDocument((s) => s.meta)
  const hasDoc = useDocument((s) => s.doc !== null)
  const dirty = useDocument(isDirty)
  // The name being typed; null when not renaming.
  const [draft, setDraft] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)

  if (!meta || !hasDoc) return null

  const startRename = () => setDraft(meta.fileName)
  const finish = (commit: boolean, refocus: boolean) => {
    const name = commit && draft !== null ? renamedFileName(meta.fileName, draft) : null
    if (name && name !== meta.fileName) setDocumentMeta({ fileName: name })
    setDraft(null)
    // Keyboard users stay on the title; a click elsewhere keeps the focus it moved.
    if (refocus) requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }))
  }
  const measure = () => {
    const el = nameRef.current
    setTruncated(!!el && el.scrollWidth > el.clientWidth + 1)
  }
  const status = dirty ? t.app.unsaved : t.app.saved

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {draft !== null ? (
        <input
          autoFocus
          aria-label={t.app.fileName}
          value={draft}
          // Grows with the name, within reason (the title area is shared with the menus).
          size={Math.min(48, Math.max(16, draft.length + 2))}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.setSelectionRange(0, stemLength(e.currentTarget.value))}
          onBlur={() => finish(true, false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              finish(true, true)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              finish(false, true)
            }
          }}
          className="h-6 max-w-full min-w-0 rounded-sm bg-surface-2 px-2 text-sm font-medium text-fg shadow-[inset_0_0_0_1px_var(--le-accent)] outline-none"
        />
      ) : (
        <Tooltip
          side="bottom"
          content={
            truncated ? (
              <span className="flex flex-col gap-0.5">
                <span className="font-medium break-all">{meta.fileName}</span>
                <span className="text-fg-muted">{status}</span>
              </span>
            ) : (
              status
            )
          }
        >
          <button
            ref={buttonRef}
            type="button"
            data-testid="document-title"
            onPointerEnter={measure}
            onFocus={measure}
            onDoubleClick={startRename}
            // Enter and Space (a click without a pointer) rename too; F2 as in file managers.
            onClick={(e) => e.detail === 0 && startRename()}
            onKeyDown={(e) => {
              if (e.key === 'F2') {
                // Not the "Rename layer" shortcut: the title has the focus.
                e.preventDefault()
                startRename()
              }
            }}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-medium text-fg hover:bg-hover"
          >
            <span ref={nameRef} className="truncate">
              {meta.fileName}
            </span>
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full transition-opacity',
                dirty ? 'bg-fg-muted opacity-100' : 'opacity-0',
              )}
              aria-hidden
            />
          </button>
        </Tooltip>
      )}
      <ErrorBoundary name="save-status" compact>
        <SaveStatus />
      </ErrorBoundary>
    </div>
  )
}

export function TopBar() {
  const t = useT()
  const route = useRoute()
  const commands = useCommands()
  const hasDoc = useDocument((s) => s.doc !== null)
  const pastLabel = useDocument((s) => s.past[s.past.length - 1]?.label)
  const futureLabel = useDocument((s) => s.future[0]?.label)
  const exportCmd = commands.get('file.export')

  return (
    <header className="relative z-10 flex h-10 shrink-0 items-center gap-1 border-b border-line bg-surface-1 px-2">
      <Tooltip content={t.app.services.home}>
        <button
          type="button"
          aria-label={t.app.services.home}
          onClick={() => navigate('home')}
          className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-hover"
        >
          <Logo size={20} />
        </button>
      </Tooltip>
      <div className="mr-1.5 ml-1 shrink-0">
        <ServiceSwitcher compact={route === 'edit'} />
      </div>
      {route === 'edit' && (
        <>
          <AppMenubar className="hidden min-[1180px]:flex" />
          <CompactMenu className="min-[1180px]:hidden" />
        </>
      )}
      <div className="flex min-w-0 flex-1 justify-center px-4">
        {(route === 'edit' || route === 'customize') && <DocumentTitle />}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {hasDoc && (route === 'edit' || route === 'customize') && (
          <Fragment>
            <IconButton
              icon={Undo2}
              label={pastLabel ? t.app.history.undo(pastLabel) : t.app.history.nothingToUndo}
              shortcut="mod+z"
              disabled={!pastLabel}
              onClick={() => runCommand('edit.undo')}
            />
            <IconButton
              icon={Redo2}
              label={futureLabel ? t.app.history.redo(futureLabel) : t.app.history.nothingToRedo}
              shortcut="mod+shift+z"
              disabled={!futureLabel}
              onClick={() => runCommand('edit.redo')}
            />
            <div className="mx-1.5 h-4 w-px bg-line-strong" />
          </Fragment>
        )}
        <IconButton
          icon={CommandIcon}
          label={t.app.commandPalette}
          shortcut="mod+k"
          onClick={() => setCommandPaletteOpen(true)}
        />
        {hasDoc && exportCmd && (route === 'edit' || route === 'customize') && (
          <Tooltip content={exportCmd.title(t)} shortcut={primaryShortcut(exportCmd)}>
            <Button
              variant="primary"
              size="sm"
              icon={Download}
              className="ml-1.5"
              onClick={() => runCommand('file.export')}
            >
              {t.app.export}
            </Button>
          </Tooltip>
        )}
      </div>
    </header>
  )
}
