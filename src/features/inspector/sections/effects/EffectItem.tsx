/**
 * One effect: a header row (expand, name, support info, actions, on/off) and its parameters.
 *
 * Header gestures: click toggles the parameters, double-click renames, drag reorders (handled
 * by the section). With the header focused: F2 renames, ⌘D duplicates, ⌥↑/⌥↓ move, Delete
 * removes (these keys never reach the global shortcuts, which would act on the layer).
 */
import {
  ArrowDown,
  ArrowUp,
  Braces,
  ChevronRight,
  CopyPlus,
  Ellipsis,
  Minus,
  Pencil,
  RotateCcw,
  Trash2,
  Wrench,
} from 'lucide-react'
import {
  memo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
  Switch,
  Tooltip,
  type MenuKind,
} from '@/components/ui'
import { matchesShortcut } from '@/commands/shortcuts'
import { useT } from '@/i18n'
import { emit } from '@/lib/events'
import { cn } from '@/lib/cn'
import { isMac } from '@/lib/platform'
import { effectDefOf, type EffectContext, type EffectFix } from '@/lottie/effects'
import type { NodePath } from '@/lottie/path'
import type { Effect, Mask } from '@/lottie/types'
import {
  duplicateEffectAt,
  fixEffectAt,
  moveEffectTo,
  removeEffectAt,
  renameEffectAt,
  resetEffectAt,
  setEffectEnabledAt,
} from '../../effects-actions'
import type { CompTime } from '../../model/time'
import { effectTypeLabel, namedAfterType } from '../../model/effect-labels'
import { nameText } from '../../model/names'
import { EffectParams } from './EffectParams'
import { SupportIcon } from './SupportIcon'
import { supportInfo } from './support'

const SHORTCUTS = {
  rename: 'f2',
  duplicate: 'mod+d',
  moveUp: 'alt+up',
  moveDown: 'alt+down',
  remove: isMac ? 'backspace' : 'delete',
} as const

export interface EffectItemProps {
  layerPath: NodePath
  index: number
  effect: Effect
  /** Number of effects on the layer. */
  count: number
  masks: readonly Mask[]
  time: CompTime
  context: EffectContext
  expanded: boolean
  onExpandedChange: (key: string, expanded: boolean) => void
  /** Stable identity of the effect in the list (expansion state, React key). */
  itemKey: string
  renaming: boolean
  onRenamingChange: (key: string | null) => void
  /** Being dragged. */
  dragging: boolean
  onDragStart: (e: PointerEvent, index: number) => void
  /** True once for the click that ends a drag. */
  consumeDragClick: () => boolean
  /** Called before the effect is deleted from the keyboard or a menu (focus moves on). */
  onRemoveFocus: (index: number) => void
  /** After a rename (which changes the item's key): keeps the expansion state. */
  onRenamed: (index: number, expanded: boolean) => void
}

export const EffectItem = memo(function EffectItem(p: EffectItemProps) {
  const t = useT()
  const te = t.inspector.effects
  const { effect, index, layerPath } = p
  const type = effectTypeLabel(effect, t)
  const name = nameText(effect.nm) || type || te.effect
  const showType = !!type && !namedAfterType(name, effect, type, t)
  const enabled = effect.en !== 0
  const info = supportInfo(effect, p.masks)
  const hasParams = Array.isArray(effect.ef) && effect.ef.length > 0
  const effectPath = [...layerPath, 'ef', index]
  const rootRef = useRef<HTMLDivElement>(null)

  const toggle = () => p.onExpandedChange(p.itemKey, !p.expanded)
  const startRename = () => p.onRenamingChange(p.itemKey)
  const onHeaderClick = (e: MouseEvent) => {
    // The click ending a drag, and the second click of a double-click (rename), don't toggle.
    if (p.consumeDragClick() || e.detail > 1) return
    if (hasParams) toggle()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const ev = e.nativeEvent
    const run = (fn: () => void) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    if (matchesShortcut(ev, SHORTCUTS.rename)) run(startRename)
    else if (matchesShortcut(ev, 'backspace') || matchesShortcut(ev, 'delete'))
      run(() => {
        p.onRemoveFocus(index)
        removeEffectAt(layerPath, index)
      })
    else if (matchesShortcut(ev, SHORTCUTS.duplicate))
      run(() => duplicateEffectAt(layerPath, index))
    else if (matchesShortcut(ev, SHORTCUTS.moveUp) && index > 0)
      run(() => moveEffectTo(layerPath, index, index - 1))
    else if (matchesShortcut(ev, SHORTCUTS.moveDown) && index < p.count - 1)
      run(() => moveEffectTo(layerPath, index, index + 1))
  }

  const menu = (kind: MenuKind) => (
    <EffectMenu
      kind={kind}
      effect={effect}
      index={index}
      count={p.count}
      layerPath={layerPath}
      effectPath={effectPath}
      fixes={info?.issues.flatMap((i) => (i.fix ? [i.fix] : [])) ?? []}
      onRename={() => setTimeout(startRename, 0)}
      onRemove={() => {
        p.onRemoveFocus(index)
        removeEffectAt(layerPath, index)
      }}
    />
  )

  return (
    <div
      ref={rootRef}
      data-effect-index={index}
      data-testid="effect"
      className={cn(
        'flex min-w-0 flex-col gap-1.5',
        index > 0 && 'pt-1',
        p.dragging && 'opacity-40',
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="group/effect flex h-6 min-w-0 items-center gap-1"
            data-testid="effect-header"
          >
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={toggle}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-xs text-fg-subtle hover:text-fg',
                !hasParams && 'invisible',
              )}
            >
              <ChevronRight
                size={12}
                className={cn('transition-transform duration-100', p.expanded && 'rotate-90')}
              />
            </button>
            {p.renaming ? (
              <NameInput
                initial={name}
                label={te.actions.rename}
                onDone={(next, how) => {
                  const list = rootRef.current?.parentElement
                  p.onRenamingChange(null)
                  if (next && next !== name && renameEffectAt(layerPath, index, next))
                    p.onRenamed(index, p.expanded)
                  // Keyboard users continue on the header (a rename re-creates it); a click
                  // elsewhere keeps its focus.
                  if (how !== 'blur')
                    requestAnimationFrame(() =>
                      list
                        ?.querySelector<HTMLElement>(
                          `[data-effect-index="${index}"] [data-effect-name]`,
                        )
                        ?.focus(),
                    )
                }}
              />
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <button
                  type="button"
                  data-effect-name
                  aria-expanded={hasParams ? p.expanded : undefined}
                  title={`${name}${showType ? ` · ${type}` : ''}${effect.mn ? `\n${effect.mn}` : ''}`}
                  onPointerDown={(e) => p.onDragStart(e, index)}
                  onClick={onHeaderClick}
                  onDoubleClick={startRename}
                  onKeyDown={onKeyDown}
                  // The name keeps its full width when it fits; the type gets what is left.
                  className="-mx-1 grid h-6 min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-center gap-2 rounded-sm px-1 text-left"
                >
                  <span
                    className={cn(
                      'min-w-0 truncate text-xs font-medium',
                      enabled ? 'text-fg' : 'text-fg-subtle',
                    )}
                  >
                    {name}
                  </span>
                  {showType && (
                    <span className="min-w-0 truncate text-xs text-fg-subtle">{type}</span>
                  )}
                </button>
                {info && <SupportIcon info={info} />}
                {/* The rest of the row toggles and drags too: a bigger target, like section headers. */}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onPointerDown={(e) => p.onDragStart(e, index)}
                  onClick={onHeaderClick}
                  onDoubleClick={startRename}
                  className="h-6 min-w-2 flex-1"
                />
              </div>
            )}
            <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-focus-within/effect:opacity-100 group-hover/effect:opacity-100 has-[[data-state=open]]:opacity-100">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <IconButton icon={Ellipsis} label={te.actions.more} data-testid="effect-more" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">{menu('dropdown')}</DropdownMenuContent>
              </DropdownMenu>
              <IconButton
                icon={Minus}
                label={te.actions.removeEffect}
                shortcut={SHORTCUTS.remove}
                onClick={() => removeEffectAt(layerPath, index)}
                data-testid="effect-remove"
              />
            </div>
            {/* A wrapper as the tooltip trigger: the trigger's data-state would replace the
                switch's own (checked/unchecked), which its colors depend on. */}
            <Tooltip content={enabled ? te.turnOff : te.turnOn} side="left">
              <span className="ml-1 inline-flex">
                <Switch
                  checked={enabled}
                  aria-label={te.enabled}
                  onCheckedChange={(on) => setEffectEnabledAt(layerPath, index, on)}
                />
              </span>
            </Tooltip>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>{menu('context')}</ContextMenuContent>
      </ContextMenu>
      {p.expanded && hasParams && (
        <EffectParams
          effect={effect}
          effectPath={effectPath}
          layerPath={layerPath}
          time={p.time}
          context={p.context}
        />
      )}
    </div>
  )
})

/** Items of the effect's context and overflow menus. */
function EffectMenu({
  kind,
  effect,
  index,
  count,
  layerPath,
  effectPath,
  fixes,
  onRename,
  onRemove,
}: {
  kind: MenuKind
  effect: Effect
  index: number
  count: number
  layerPath: NodePath
  effectPath: NodePath
  fixes: EffectFix[]
  onRename: () => void
  onRemove: () => void
}) {
  const t = useT()
  const ta = t.inspector.effects.actions
  const tf = t.inspector.effects.fixes
  const def = effectDefOf(effect)
  const fixLabel = (fix: EffectFix) =>
    fix === 'setType' ? tf.setType(def ? t.inspector.effects.kinds[def.kind] : '') : tf[fix]
  return (
    <>
      <MenuItem kind={kind} icon={Pencil} shortcut={SHORTCUTS.rename} onSelect={onRename}>
        {ta.rename}
      </MenuItem>
      <MenuItem
        kind={kind}
        icon={CopyPlus}
        shortcut={SHORTCUTS.duplicate}
        onSelect={() => duplicateEffectAt(layerPath, index)}
      >
        {ta.duplicate}
      </MenuItem>
      <MenuItem
        kind={kind}
        icon={RotateCcw}
        disabled={!def || !Array.isArray(effect.ef)}
        onSelect={() => resetEffectAt(layerPath, index)}
      >
        {ta.reset}
      </MenuItem>
      <MenuSeparator kind={kind} />
      <MenuItem
        kind={kind}
        icon={ArrowUp}
        shortcut={SHORTCUTS.moveUp}
        disabled={index === 0}
        onSelect={() => moveEffectTo(layerPath, index, index - 1)}
      >
        {ta.moveUp}
      </MenuItem>
      <MenuItem
        kind={kind}
        icon={ArrowDown}
        shortcut={SHORTCUTS.moveDown}
        disabled={index >= count - 1}
        onSelect={() => moveEffectTo(layerPath, index, index + 1)}
      >
        {ta.moveDown}
      </MenuItem>
      {fixes.length > 0 && (
        <>
          <MenuSeparator kind={kind} />
          {fixes.map((fix) => (
            <MenuItem
              key={fix}
              kind={kind}
              icon={Wrench}
              onSelect={() => fixEffectAt(layerPath, index, fix)}
            >
              {fixLabel(fix)}
            </MenuItem>
          ))}
        </>
      )}
      <MenuSeparator kind={kind} />
      <MenuItem
        kind={kind}
        icon={Braces}
        onSelect={() => emit('reveal-code', { path: effectPath })}
      >
        {ta.showInJson}
      </MenuItem>
      <MenuItem kind={kind} icon={Trash2} shortcut={SHORTCUTS.remove} danger onSelect={onRemove}>
        {ta.remove}
      </MenuItem>
    </>
  )
}

/** Inline rename field with the metrics of the effect name. */
function NameInput({
  initial,
  label,
  onDone,
}: {
  initial: string
  label: string
  /** `value` null = cancelled; `how` tells whether the keyboard or a click ended it. */
  onDone: (value: string | null, how: 'enter' | 'escape' | 'blur') => void
}) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (next: string | null, how: 'enter' | 'escape' | 'blur') => {
    if (done.current) return
    done.current = true
    onDone(next, how)
  }
  return (
    <input
      autoFocus
      value={value}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(value.trim() || null, 'blur')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value.trim() || null, 'enter')
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null, 'escape')
        }
      }}
      className="-mx-1 h-6 min-w-0 flex-1 rounded-sm bg-surface-2 px-1 text-xs font-medium text-fg shadow-[inset_0_0_0_1px_var(--le-accent)] outline-none"
    />
  )
}
