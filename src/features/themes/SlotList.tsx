/**
 * The theme colors (slots) of the animation with their value in the selected theme: Default
 * edits the document, a theme edits its own values (values that look like Default are dimmed,
 * so the ones a theme changes stand out). Hover highlights what a color paints; double-click
 * renames; one context menu for all rows.
 */
import {
  Braces,
  ClipboardCopy,
  MousePointer2,
  Palette,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ColorPicker,
  ColorSwatch,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
  NumberField,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tooltip,
  toast,
  type ChangeGesture,
} from '@/components/ui'
import { fieldFrame, fieldSizes } from '@/components/ui/field'
import { useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { hexToRgba, rgbaToHex, type RGBA } from '@/lib/color'
import { emit } from '@/lib/events'
import { uid } from '@/lib/id'
import { isEditableTarget } from '@/lib/platform'
import { documentPalette } from '@/lottie/colors'
import { isValidSlotId, type SlotInfo, type SlotRole } from '@/lottie/slots'
import { getDoc, useDocument } from '@/store/document'
import {
  copyId,
  highlightSlot,
  removeThemeColor,
  renameThemeColor,
  resetThemeValue,
  selectSlotLayers,
  setDefaultColor,
  setDefaultValue,
  setThemeColor,
  setThemeValue,
} from './actions'
import { InlineRename } from './InlineRename'
import type { ThemeInfo } from './model'
import { setThemesUi, useRenamingSlot } from './store'
import { colorsCss, slotView, type SlotView } from './view'

interface SlotListProps {
  slots: readonly SlotInfo[]
  /** Selected theme (null: Default). */
  theme: ThemeInfo | null
  animationId: string | null
}

/** Opens a popover after the context menu has closed and returned focus. */
function afterMenuCloses(fn: () => void): void {
  setTimeout(fn, 0)
}

export function SlotList({ slots, theme, animationId }: SlotListProps) {
  const t = useT()
  const renaming = useRenamingSlot()
  const [menuSlot, setMenuSlot] = useState<string | null>(null)
  // Row whose value editor is open (opened from the menu or by keyboard).
  const [editing, setEditing] = useState<string | null>(null)
  // Leaving the section (a selection replaces the document view) ends any highlight.
  useEffect(() => () => highlightSlot(null), [])

  const views = useMemo(
    () => new Map(slots.map((s) => [s.id, slotView(s, theme, animationId)])),
    [slots, theme, animationId],
  )

  const onContextMenu = (e: MouseEvent) => {
    const row = (e.target as Element).closest<HTMLElement>('[data-slot-id]')
    if (!row) {
      e.preventDefault()
      return
    }
    setMenuSlot(row.dataset.slotId ?? null)
  }

  const menuInfo = menuSlot ? slots.find((s) => s.id === menuSlot) : undefined
  const menuView = menuSlot ? views.get(menuSlot) : undefined

  return (
    <ContextMenu onOpenChange={(open) => !open && setMenuSlot(null)}>
      <ContextMenuTrigger asChild>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the list is the context menu trigger of its rows */}
        <ul
          aria-label={t.themes.title}
          className="-mx-1.5 flex flex-col"
          onContextMenu={onContextMenu}
          data-testid="themes-slots"
        >
          {slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              view={views.get(slot.id)!}
              theme={theme}
              renaming={renaming === slot.id}
              editing={editing === slot.id}
              onEditingChange={(open) => setEditing(open ? slot.id : null)}
              menuOpen={menuSlot === slot.id}
              slots={slots}
            />
          ))}
        </ul>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[220px]">
        {menuInfo && menuView && (
          <SlotMenu
            slot={menuInfo}
            view={menuView}
            theme={theme}
            t={t}
            onEdit={() => afterMenuCloses(() => setEditing(menuInfo.id))}
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/* -------------------------------------------------------------------------- */
/*                                     Row                                    */
/* -------------------------------------------------------------------------- */

interface SlotRowProps {
  slot: SlotInfo
  view: SlotView
  theme: ThemeInfo | null
  renaming: boolean
  editing: boolean
  onEditingChange: (open: boolean) => void
  menuOpen: boolean
  slots: readonly SlotInfo[]
}

function usageSummary(slot: SlotInfo, t: Dict): string {
  if (slot.refs.length === 0) return t.themes.row.unused
  const roles: SlotRole[] = []
  for (const r of slot.refs) if (!roles.includes(r.role)) roles.push(r.role)
  const layers = new Set(slot.refs.map((r) => (r.layerPath ?? r.path).join('/'))).size
  return [
    roles.map((r) => t.themes.roles[r]).join(', '),
    t.themes.row.uses(slot.refs.length, layers),
  ].join(' · ')
}

function SlotRow({
  slot,
  view,
  theme,
  renaming,
  editing,
  onEditingChange,
  menuOpen,
  slots,
}: SlotRowProps) {
  const t = useT()
  const unused = slot.refs.length === 0

  const validate = (name: string) => {
    if (!name) return t.themes.errors.empty
    if (!isValidSlotId(name)) return t.themes.errors.invalidId
    if (slots.some((s) => s.id === name && s.id !== slot.id)) return t.themes.errors.nameTaken
    return null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    // React bubbles keys from the row's portaled popover (the color picker) up to here: only the
    // row's own controls count, or Backspace on the picker's hue slider would delete the color.
    if (!e.currentTarget.contains(e.target as Node)) return
    if (e.key === 'F2') {
      e.preventDefault()
      setThemesUi({ renamingSlot: slot.id })
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditableTarget(e.target)) {
      e.preventDefault()
      e.stopPropagation()
      removeThemeColor(slot.id)
    }
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover highlights the canvas; F2/Delete bubble from the row's own controls
    <li
      data-slot-id={slot.id}
      data-testid="themes-slot"
      onPointerEnter={() => highlightSlot(slot.id)}
      onPointerLeave={() => highlightSlot(null)}
      onKeyDown={onKeyDown}
      className={cn(
        'group/slot flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 transition-colors duration-100 hover:bg-hover',
        (menuOpen || editing) && 'bg-hover',
      )}
    >
      {renaming ? (
        <InlineRename
          value={slot.id}
          aria-label={t.themes.slotName}
          validate={validate}
          className="flex-1"
          onCommit={(name) => renameThemeColor(slot.id, name)}
          onCancel={() => setThemesUi({ renamingSlot: null })}
        />
      ) : (
        <Tooltip content={usageSummary(slot, t)} side="left">
          <span
            className={cn(
              'min-w-0 flex-1 cursor-default truncate text-sm select-none',
              unused ? 'text-fg-subtle' : 'text-fg',
            )}
            onDoubleClick={() => setThemesUi({ renamingSlot: slot.id })}
          >
            {slot.id}
          </span>
        </Tooltip>
      )}
      {theme && view.overridden && !view.sameAsDefault && (
        <IconButton
          icon={RotateCcw}
          size="xs"
          label={t.themes.row.reset}
          className="opacity-0 group-focus-within/slot:opacity-100 group-hover/slot:opacity-100 focus-visible:opacity-100"
          onClick={() => resetThemeValue(theme.id, slot.id)}
          data-testid="themes-slot-reset"
        />
      )}
      <ValueControl
        slot={slot}
        view={view}
        theme={theme}
        open={editing}
        onOpenChange={onEditingChange}
      />
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/*                               Value controls                               */
/* -------------------------------------------------------------------------- */

interface ValueControlProps {
  slot: SlotInfo
  view: SlotView
  theme: ThemeInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CONTROL_WIDTH = 'w-[108px]'

function ValueControl({ slot, view, theme, open, onOpenChange }: ValueControlProps) {
  const t = useT()
  const value = view.value
  // In a theme, values that look like Default are quiet: the ones the theme changes stand out.
  const dim = !!theme && view.sameAsDefault

  switch (value.type) {
    case 'color':
    case 'animated': {
      const onChange = (color: RGBA, gesture: ChangeGesture) => {
        if (theme) setThemeColor(theme.id, slot.id, color, gesture)
        else setDefaultColor(slot.id, color, gesture)
      }
      return (
        <ColorControl
          label={t.themes.row.edit(slot.id)}
          color={value.type === 'color' ? value.color : (value.colors[0] ?? null)}
          animatedColors={value.type === 'animated' ? value.colors : null}
          dim={dim}
          hint={
            value.type === 'animated'
              ? t.themes.row.animatedHint
              : dim
                ? t.themes.row.inherited
                : undefined
          }
          open={open}
          onOpenChange={onOpenChange}
          onChange={onChange}
        />
      )
    }
    case 'number':
      return (
        <Tooltip content={dim ? t.themes.row.inherited : undefined} side="left">
          <div className={cn(CONTROL_WIDTH, 'shrink-0')}>
            <NumberField
              value={value.value}
              precision={2}
              aria-label={t.themes.row.edit(slot.id)}
              inputClassName={dim ? 'text-fg-subtle' : undefined}
              onChange={(v, gesture) => {
                if (theme) setThemeValue(theme.id, slot.id, v, 'Scalar', gesture)
                else setDefaultValue(slot.id, v, gesture)
              }}
            />
          </div>
        </Tooltip>
      )
    case 'vector': {
      const type = slot.kind === 'position' ? 'Position' : 'Vector'
      const set = (index: number, v: number, gesture: ChangeGesture) => {
        const next = [...value.value]
        next[index] = v
        if (theme) setThemeValue(theme.id, slot.id, next, type, gesture)
        else setDefaultValue(slot.id, next, gesture)
      }
      return (
        <div className={cn(CONTROL_WIDTH, 'grid shrink-0 grid-cols-2 gap-1')}>
          {[0, 1].map((i) => (
            <NumberField
              key={i}
              value={value.value[i] ?? 0}
              precision={1}
              aria-label={`${t.themes.row.edit(slot.id)} ${i === 0 ? 'X' : 'Y'}`}
              inputClassName={dim ? 'text-fg-subtle' : undefined}
              onChange={(v, gesture) => set(i, v, gesture)}
            />
          ))}
        </div>
      )
    }
    case 'other':
      return (
        <Tooltip content={t.themes.row.readOnly} side="left">
          <span
            className={cn(
              CONTROL_WIDTH,
              'flex h-6 shrink-0 items-center rounded-sm px-2 text-xs text-fg-subtle',
            )}
          >
            <span className="truncate">{t.themes.kinds[value.kind]}</span>
          </span>
        </Tooltip>
      )
  }
}

interface ColorControlProps {
  label: string
  color: RGBA | null
  /** Colors of an animated value (the swatch shows them side by side). */
  animatedColors: readonly RGBA[] | null
  /** Inherited from Default: the hex is dimmed. */
  dim: boolean
  hint?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (color: RGBA, gesture: ChangeGesture) => void
}

/** Swatch + hex field like the inspector's color fields; the swatch opens the picker. */
function ColorControl({
  label,
  color,
  animatedColors,
  dim,
  hint,
  open,
  onOpenChange,
  onChange,
}: ColorControlProps) {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const palette = useMemo(() => (doc ? documentPalette(doc).slice(0, 16) : []), [doc])
  // Hex being typed; null when not editing.
  const [draft, setDraft] = useState<string | null>(null)
  const hex = color ? rgbaToHex(color).slice(1).toUpperCase() : ''
  const animated = !!animatedColors && animatedColors.length > 0

  const commitHex = () => {
    const parsed = draft === null ? null : hexToRgba(draft)
    setDraft(null)
    if (parsed) onChange({ ...parsed, a: 1 }, { key: uid('hex'), final: true })
  }

  const swatch = (
    <button
      type="button"
      aria-label={label}
      className="flex shrink-0 items-center rounded-xs"
      onClick={() => onOpenChange(!open)}
    >
      {animated ? (
        <span
          className="relative inline-block size-4 shrink-0 overflow-hidden rounded-xs"
          style={{ background: colorsCss(animatedColors) }}
        >
          <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]" />
        </span>
      ) : (
        <ColorSwatch color={color ?? { r: 0, g: 0, b: 0, a: 0 }} size={16} />
      )}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div
          className={cn(fieldFrame, fieldSizes.sm, CONTROL_WIDTH, 'shrink-0 gap-1.5 pl-1')}
          data-testid="themes-slot-color"
        >
          {hint ? (
            <Tooltip content={hint} side="left">
              {swatch}
            </Tooltip>
          ) : (
            swatch
          )}
          <input
            aria-label={t.common.hexColor}
            value={draft ?? (animated ? '' : hex)}
            placeholder={animated ? t.themes.row.animated : undefined}
            spellCheck={false}
            onFocus={(e) => {
              setDraft(animated ? '' : hex)
              e.target.select()
            }}
            onChange={(e) =>
              setDraft(
                e.target.value
                  .replace(/[^0-9a-f#]/gi, '')
                  .replace('#', '')
                  .slice(0, 6),
              )
            }
            onBlur={commitHex}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setDraft(null)
                requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
              }
            }}
            className={cn(
              'h-full w-full min-w-0 bg-transparent font-mono text-sm uppercase outline-none placeholder:font-sans placeholder:text-fg-subtle placeholder:normal-case',
              dim && draft === null ? 'text-fg-subtle' : 'text-fg',
            )}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent side="left" align="start" className="p-3">
        <ColorPicker
          value={color ?? { r: 0, g: 0, b: 0, a: 1 }}
          alpha={false}
          swatches={palette}
          onChange={(c, gesture) => onChange({ ...c, a: 1 }, gesture)}
        />
      </PopoverContent>
    </Popover>
  )
}

/* -------------------------------------------------------------------------- */
/*                                Context menu                                */
/* -------------------------------------------------------------------------- */

interface SlotMenuProps {
  slot: SlotInfo
  view: SlotView
  theme: ThemeInfo | null
  t: Dict
  onEdit: () => void
}

function SlotMenu({ slot, view, theme, t, onEdit }: SlotMenuProps) {
  const editable = view.value.type !== 'other'
  const isColor = view.value.type === 'color' || view.value.type === 'animated'
  const first = slot.refs[0]
  return (
    <>
      {editable && (
        <MenuItem kind="context" icon={isColor ? Palette : SlidersHorizontal} onSelect={onEdit}>
          {isColor ? t.themes.menu.editColor : t.themes.menu.editValue}
        </MenuItem>
      )}
      <MenuItem
        kind="context"
        icon={Pencil}
        shortcut="f2"
        onSelect={() => afterMenuCloses(() => setThemesUi({ renamingSlot: slot.id }))}
      >
        {t.themes.menu.rename}
      </MenuItem>
      <MenuSeparator kind="context" />
      <MenuItem
        kind="context"
        icon={MousePointer2}
        disabled={!slot.refs.some((r) => r.layerPath)}
        onSelect={() => selectSlotLayers(slot.id)}
      >
        {t.themes.menu.selectLayers}
      </MenuItem>
      <MenuItem
        kind="context"
        icon={Braces}
        disabled={!first}
        onSelect={() => {
          const path = slot.defined ? ['slots', slot.id] : first?.path
          if (path) emit('reveal-code', { path })
        }}
      >
        {t.themes.menu.showInJson}
      </MenuItem>
      <MenuItem
        kind="context"
        icon={ClipboardCopy}
        onSelect={() =>
          void copyId(slot.id).then((ok) => {
            if (!ok) toast.error(t.themes.copyFailed)
          })
        }
      >
        {t.themes.menu.copySlotId}
      </MenuItem>
      {theme && view.overridden && !view.sameAsDefault && (
        <MenuItem
          kind="context"
          icon={RotateCcw}
          onSelect={() => resetThemeValue(theme.id, slot.id)}
        >
          {t.themes.menu.reset}
        </MenuItem>
      )}
      <MenuSeparator kind="context" />
      <MenuItem
        kind="context"
        icon={Trash2}
        shortcut="delete"
        danger
        onSelect={() => {
          removeThemeColor(slot.id)
          // The row goes away under the pointer: nothing is left to highlight.
          if (getDoc()) highlightSlot(null)
        }}
      >
        {t.themes.menu.remove}
      </MenuItem>
    </>
  )
}
