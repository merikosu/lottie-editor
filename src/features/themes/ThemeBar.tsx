/**
 * Theme switcher of the Themes section: Default and every theme of the package. The selected
 * theme is the one the rows edit and the canvas shows. Arrow keys move the selection (a radio
 * group); double-click or F2 renames; Delete removes; the context menu has the rest.
 */
import { ClipboardCopy, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  Tooltip,
  toast,
} from '@/components/ui'
import { useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import {
  copyId,
  createTheme,
  currentPackage,
  duplicateTheme,
  removeTheme,
  renameThemeTo,
  selectTheme,
  setStartingTheme,
} from './actions'
import { InlineRename } from './InlineRename'
import { isThemeNameTaken, type ThemeInfo } from './model'
import { setThemesUi, useRenamingTheme } from './store'

const NAME_MAX_LENGTH = 64

interface ThemeBarProps {
  themes: readonly ThemeInfo[]
  /** Selected theme (null: Default). */
  selectedId: string | null
  /** Theme players start with (null: Default). */
  initialId: string | null
  /** New themes can be added (the document's source can hold themes). */
  allowNew: boolean
}

interface Item {
  id: string | null
  name: string
}

/** First "Theme n" name that is not taken. */
function freshName(t: Dict, themes: readonly ThemeInfo[]): string {
  for (let n = themes.length + 1; ; n++) {
    const name = t.themes.newThemeName(n)
    if (!themes.some((th) => th.name.toLowerCase() === name.toLowerCase())) return name
  }
}

export function ThemeBar({ themes, selectedId, initialId, allowNew }: ThemeBarProps) {
  const t = useT()
  const renaming = useRenamingTheme()
  const groupRef = useRef<HTMLDivElement>(null)
  // Chip the context menu belongs to (`id` null: Default).
  const [menuFor, setMenuFor] = useState<Item | null>(null)
  const items: Item[] = [{ id: null, name: t.themes.defaultTheme }, ...themes]

  const focusChip = (id: string | null) =>
    requestAnimationFrame(() =>
      groupRef.current
        ?.querySelector<HTMLElement>(`[data-theme-chip="${CSS.escape(id ?? '')}"]`)
        ?.focus(),
    )

  const validate = (exceptId?: string) => (name: string) => {
    if (!name) return t.themes.errors.empty
    if (name.length > NAME_MAX_LENGTH) return t.themes.errors.invalidId
    if (isThemeNameTaken(currentPackage(), name, exceptId)) return t.themes.errors.nameTaken
    return null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const item = items[index]
    const move = (to: number) => {
      const target = items[(to + items.length) % items.length]
      selectTheme(target.id)
      focusChip(target.id)
    }
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        move(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        move(index - 1)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(items.length - 1)
        break
      case 'F2':
        if (!item.id) return
        setThemesUi({ renamingTheme: item.id })
        break
      case 'Delete':
      case 'Backspace':
        if (!item.id) return
        removeTheme(item.id)
        focusChip(null)
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const onContextMenu = (e: MouseEvent) => {
    const chip = (e.target as Element).closest<HTMLElement>('[data-theme-chip]')
    const item = chip ? items.find((i) => (i.id ?? '') === chip.dataset.themeChip) : undefined
    if (!item) {
      e.preventDefault()
      return
    }
    setMenuFor(item)
  }

  return (
    <ContextMenu onOpenChange={(open) => !open && setMenuFor(null)}>
      <ContextMenuTrigger asChild>
        <div
          ref={groupRef}
          role="radiogroup"
          // The chips are the tab stops (roving focus): the group itself is focusable only by code.
          tabIndex={-1}
          aria-label={t.themes.themeGroup}
          className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-md bg-surface-2 p-0.5"
          onContextMenu={onContextMenu}
          data-testid="themes-bar"
        >
          {items.map((item, index) =>
            item.id !== null && renaming === item.id ? (
              <InlineRename
                key={item.id}
                value={item.name}
                aria-label={t.themes.themeName}
                validate={validate(item.id)}
                className="w-[128px]"
                onCommit={(name) => {
                  renameThemeTo(item.id!, name)
                  focusChip(item.id)
                }}
                onCancel={() => {
                  setThemesUi({ renamingTheme: null })
                  focusChip(item.id)
                }}
              />
            ) : (
              <Chip
                key={item.id ?? ''}
                item={item}
                checked={item.id === selectedId}
                menuOpen={menuFor !== null && menuFor.id === item.id}
                initial={item.id !== null && item.id === initialId}
                t={t}
                onKeyDown={(e) => onKeyDown(e, index)}
              />
            ),
          )}
          {renaming === 'new' ? (
            <InlineRename
              value={freshName(t, themes)}
              commitUnchanged
              aria-label={t.themes.themeName}
              validate={validate()}
              className="w-[128px]"
              onCommit={(name) => {
                const id = createTheme(name)
                focusChip(id)
              }}
              onCancel={() => setThemesUi({ renamingTheme: null })}
            />
          ) : (
            allowNew && (
              <IconButton
                icon={Plus}
                size="sm"
                label={t.themes.newTheme}
                onClick={() => setThemesUi({ renamingTheme: 'new' })}
                data-testid="themes-new"
              />
            )
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[232px]">
        {menuFor && <ChipMenu item={menuFor} initialId={initialId} t={t} />}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function Chip({
  item,
  checked,
  menuOpen,
  initial,
  t,
  onKeyDown,
}: {
  item: Item
  checked: boolean
  /** Its context menu is open. */
  menuOpen: boolean
  initial: boolean
  t: Dict
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
}) {
  const tip = item.id
    ? [t.themes.chip.id(item.id), initial ? t.themes.chip.initial : null]
        .filter(Boolean)
        .join(' · ')
    : undefined
  const chip = (
    <button
      type="button"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- chips rename on double-click and have a context menu: a native radio can't
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      data-theme-chip={item.id ?? ''}
      onClick={() => selectTheme(item.id)}
      onDoubleClick={() => item.id && setThemesUi({ renamingTheme: item.id })}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex h-6 max-w-[140px] min-w-0 items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-fg-subtle transition-colors duration-100 select-none hover:text-fg',
        'aria-checked:bg-surface-1 aria-checked:text-fg aria-checked:shadow-thumb dark:aria-checked:bg-surface-3',
        menuOpen && !checked && 'bg-hover text-fg',
      )}
    >
      {initial && (
        <span className="size-1 shrink-0 rounded-full bg-current opacity-60" aria-hidden />
      )}
      <span className="truncate">{item.name}</span>
    </button>
  )
  return tip ? (
    <Tooltip content={tip} side="top">
      {chip}
    </Tooltip>
  ) : (
    chip
  )
}

function ChipMenu({ item, initialId, t }: { item: Item; initialId: string | null; t: Dict }) {
  const id = item.id
  const startsHere = id === initialId
  const startItem = (
    <MenuCheckboxItem
      kind="context"
      checked={startsHere}
      disabled={startsHere}
      onCheckedChange={() => setStartingTheme(id)}
    >
      {t.themes.menu.initial}
    </MenuCheckboxItem>
  )
  if (id === null) return startItem
  return (
    <>
      <MenuItem
        kind="context"
        icon={Pencil}
        shortcut="f2"
        onSelect={() => setTimeout(() => setThemesUi({ renamingTheme: id }), 0)}
      >
        {t.themes.menu.rename}
      </MenuItem>
      <MenuItem kind="context" icon={Copy} onSelect={() => duplicateTheme(id)}>
        {t.themes.menu.duplicate}
      </MenuItem>
      <MenuItem
        kind="context"
        icon={ClipboardCopy}
        onSelect={() =>
          void copyId(id).then((ok) => {
            if (!ok) toast.error(t.themes.copyFailed)
          })
        }
      >
        {t.themes.menu.copyThemeId}
      </MenuItem>
      <MenuSeparator kind="context" />
      {startItem}
      <MenuSeparator kind="context" />
      <MenuItem
        kind="context"
        icon={Trash2}
        shortcut="delete"
        danger
        onSelect={() => removeTheme(id)}
      >
        {t.themes.menu.deleteTheme}
      </MenuItem>
    </>
  )
}
