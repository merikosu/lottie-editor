/**
 * Effects of one layer: add (the effects lottie-web renders), reorder by dragging, and the
 * per-effect header and parameters. Layers without effects keep an empty section header with
 * the add button, so effects can be added anywhere.
 */
import { Plus } from 'lucide-react'
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuSeparator,
  Section,
} from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import {
  canHaveEffects,
  effectContext,
  type AddableEffectKind,
  type EffectContext,
} from '@/lottie/effects'
import { getAt, pathKey, type NodePath } from '@/lottie/path'
import type { Effect, Layer, Mask } from '@/lottie/types'
import { getDoc, useDocument } from '@/store/document'
import { toggleSection } from '@/store/prefs'
import { CountTitle } from '../../components/Row'
import { addEffect, moveEffectTo } from '../../effects-actions'
import { useNodesAt } from '../../hooks'
import { nameText } from '../../model/names'
import type { CompTime } from '../../model/time'
import { useInspectorRequests, type EffectRevealRequest } from '../../state'
import { EffectItem } from './EffectItem'
import { EFFECT_ICONS } from './icons'

const SECTION_ID = 'inspector.effects'
const EMPTY_EFFECTS: Effect[] = []
const EMPTY_MASKS: Mask[] = []

/** Add menu groups: color, light and blur, geometry. */
const ADD_GROUPS: AddableEffectKind[][] = [
  ['fill', 'tint', 'tritone'],
  ['dropShadow', 'gaussianBlur'],
  ['stroke', 'transform'],
]

/** Reveal requests older than this are stale (the section mounted for another reason). */
const REVEAL_MAX_AGE = 2000
let lastRevealToken = 0

/**
 * Keys that follow an effect through reorders: type + name + occurrence. A rename starts a
 * new key (the expansion state resets, which is harmless).
 */
function effectKeys(effects: readonly Effect[]): string[] {
  const seen = new Map<string, number>()
  return effects.map((e) => {
    const base = `${e?.mn ?? e?.ty}\u0001${nameText(e?.nm)}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}\u0001${n}`
  })
}

/** Effects of one layer (memoized: pass a stable `path`). */
export const EffectsSection = memo(function EffectsSection({
  path,
  time,
}: {
  path: NodePath
  time: CompTime
}) {
  const t = useT()
  const reads = useMemo(
    () => [
      [...path, 'ef'],
      [...path, 'masksProperties'],
      [...path, 'ty'],
    ],
    [path],
  )
  const [stored, storedMasks, ty] = useNodesAt<unknown>(reads)
  const effects = Array.isArray(stored) ? (stored as Effect[]) : EMPTY_EFFECTS
  const masks = Array.isArray(storedMasks) ? (storedMasks as Mask[]) : EMPTY_MASKS
  const keys = useMemo(() => effectKeys(effects), [effects])
  // Defaults that depend on the layer, as a string so the selector compares by value.
  const contextJson = useDocument((s) => (s.doc ? JSON.stringify(effectContext(s.doc, path)) : ''))
  const context = useMemo<EffectContext>(
    () => (contextJson ? (JSON.parse(contextJson) as EffectContext) : { center: [0, 0], masks: 0 }),
    [contextJson],
  )

  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const scrollTo = useRef<number | null>(null)
  const focusAfter = useRef<number | null>(null)
  const layerKey = pathKey(path)

  const onMove = useCallback((from: number, to: number) => moveEffectTo(path, from, to), [path])
  const { drag, onDragStart, consumeDragClick } = useReorder(listRef, effects.length, onMove)

  const onExpandedChange = useCallback(
    (key: string, expanded: boolean) => setOpen((o) => ({ ...o, [key]: expanded })),
    [],
  )
  const onRenamingChange = useCallback((key: string | null) => setRenaming(key), [])
  const onRemoveFocus = useCallback((index: number) => {
    focusAfter.current = index
  }, [])
  const onRenamed = useCallback(
    (index: number, expanded: boolean) => {
      const list = getAt<Effect[]>(getDoc(), [...path, 'ef'])
      const key = Array.isArray(list) ? effectKeys(list)[index] : undefined
      if (key) setOpen((o) => ({ ...o, [key]: expanded }))
    },
    [path],
  )

  // A new effect (added here or by a command) opens and scrolls into view.
  useEffect(() => {
    const apply = (r: EffectRevealRequest | null) => {
      if (!r || r.layer !== layerKey || r.token <= lastRevealToken) return
      if (Date.now() - r.at > REVEAL_MAX_AGE) return
      lastRevealToken = r.token
      const list = getAt<Effect[]>(getDoc(), [...path, 'ef'])
      const key = Array.isArray(list) ? effectKeys(list)[r.index] : undefined
      if (!key) return
      setOpen((o) => ({ ...o, [key]: true }))
      toggleSection(SECTION_ID, false)
      scrollTo.current = r.index
    }
    apply(useInspectorRequests.getState().revealEffect)
    return useInspectorRequests.subscribe((s, prev) => {
      if (s.revealEffect !== prev.revealEffect) apply(s.revealEffect)
    })
  }, [layerKey, path])

  useEffect(() => {
    const list = listRef.current
    if (scrollTo.current !== null) {
      const el = list?.querySelector(`[data-effect-index="${scrollTo.current}"]`)
      scrollTo.current = null
      el?.scrollIntoView({ block: 'nearest' })
    }
    if (focusAfter.current !== null) {
      const index = Math.min(focusAfter.current, effects.length - 1)
      focusAfter.current = null
      const target =
        index >= 0
          ? list?.querySelector<HTMLElement>(`[data-effect-index="${index}"] [data-effect-name]`)
          : list?.closest('section')?.querySelector<HTMLElement>('[data-testid="effects-add"]')
      target?.focus()
    }
  }, [effects])

  if (typeof ty !== 'number' || !canHaveEffects({ ty } as Pick<Layer, 'ty'>)) return null
  const empty = effects.length === 0

  return (
    <Section
      id={SECTION_ID}
      static={empty}
      title={
        empty ? (
          // Lined up with the titles of collapsible sections (after their chevron).
          <span className="pl-3 text-fg-muted">{t.inspector.sections.effects}</span>
        ) : (
          <CountTitle title={t.inspector.sections.effects} count={effects.length} />
        )
      }
      actions={<AddEffectMenu layerPath={path} masks={masks.length} />}
      contentClassName={empty ? 'pb-0' : undefined}
    >
      {!empty && (
        <div
          ref={listRef}
          className={cn('relative flex flex-col gap-1.5', drag && 'select-none')}
          data-testid="effects-list"
        >
          {effects.map((effect, i) => (
            <EffectItem
              key={keys[i]}
              itemKey={keys[i]}
              layerPath={path}
              index={i}
              effect={effect}
              count={effects.length}
              masks={masks}
              time={time}
              context={context}
              expanded={open[keys[i]] ?? effects.length === 1}
              onExpandedChange={onExpandedChange}
              renaming={renaming === keys[i]}
              onRenamingChange={onRenamingChange}
              dragging={drag?.from === i}
              onDragStart={onDragStart}
              consumeDragClick={consumeDragClick}
              onRemoveFocus={onRemoveFocus}
              onRenamed={onRenamed}
            />
          ))}
          {drag?.y != null && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent"
              style={{ top: drag.y - 1 }}
            />
          )}
        </div>
      )}
    </Section>
  )
})

/* -------------------------------------------------------------------------- */
/*                                  Add menu                                  */
/* -------------------------------------------------------------------------- */

function AddEffectMenu({ layerPath, masks }: { layerPath: NodePath; masks: number }) {
  const t = useT()
  const te = t.inspector.effects
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton icon={Plus} label={te.add} data-testid="effects-add" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[184px]">
        {ADD_GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <MenuSeparator />}
            {group.map((kind) => {
              // lottie-web strokes masks only (and fails on a missing one).
              const blocked = kind === 'stroke' && masks === 0
              return (
                <MenuItem
                  key={kind}
                  icon={EFFECT_ICONS[kind]}
                  disabled={blocked}
                  onSelect={() => addEffect([layerPath], kind)}
                >
                  {te.kinds[kind]}
                  {blocked && <span className="pl-1.5 text-xs">({te.needsMask})</span>}
                </MenuItem>
              )
            })}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Reorder                                  */
/* -------------------------------------------------------------------------- */

interface DragState {
  from: number
  /** Insertion line position in the list (px), null when the drop would change nothing. */
  y: number | null
}

/**
 * Drag-to-reorder for the effect headers: past a small threshold the pointer's position
 * picks an insertion slot (shown as a line); Escape cancels. The click that ends a drag is
 * swallowed so it doesn't toggle the effect.
 */
function useReorder(
  listRef: RefObject<HTMLDivElement | null>,
  count: number,
  onMove: (from: number, to: number) => void,
) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const suppressClick = useRef(false)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  const onDragStart = useCallback(
    (e: ReactPointerEvent, from: number) => {
      suppressClick.current = false
      if (e.button !== 0 || count < 2 || cleanup.current) return
      const startY = e.clientY
      let started = false
      let slot: number | null = null

      const measure = (clientY: number) => {
        const list = listRef.current
        if (!list) return
        const items = [...list.querySelectorAll<HTMLElement>(':scope > [data-effect-index]')].map(
          (el) => el.getBoundingClientRect(),
        )
        let k = items.findIndex((r) => clientY < r.top + r.height / 2)
        if (k < 0) k = items.length
        // Dropping right above or below itself changes nothing.
        slot = k === from || k === from + 1 ? null : k
        const top = list.getBoundingClientRect().top
        let y: number | null = null
        if (slot !== null) {
          if (slot === 0) y = items[0].top - top - 3
          else if (slot === items.length) y = items[slot - 1].bottom - top + 3
          else y = (items[slot - 1].bottom + items[slot].top) / 2 - top
        }
        setDrag({ from, y })
      }

      const end = (commit: boolean) => {
        cleanup.current?.()
        if (!started) return
        suppressClick.current = true
        setDrag(null)
        if (commit && slot !== null) onMove(from, slot > from ? slot - 1 : slot)
      }
      const onPointerMove = (ev: PointerEvent) => {
        if (!started) {
          if (Math.abs(ev.clientY - startY) < 4) return
          started = true
          document.documentElement.style.cursor = 'grabbing'
        }
        measure(ev.clientY)
      }
      const onPointerUp = () => end(true)
      const onPointerCancel = () => end(false)
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || !started) return
        ev.preventDefault()
        ev.stopPropagation()
        end(false)
      }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerCancel)
      window.addEventListener('keydown', onKeyDown, true)
      cleanup.current = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        window.removeEventListener('keydown', onKeyDown, true)
        document.documentElement.style.cursor = ''
        cleanup.current = null
      }
    },
    [count, listRef, onMove],
  )

  const consumeDragClick = useCallback(() => {
    const was = suppressClick.current
    suppressClick.current = false
    return was
  }, [])

  return { drag, onDragStart, consumeDragClick }
}
