/**
 * Color editing popover shared by the Colors panel and the inspector's document section.
 *
 * It edits a fixed set of usages captured when it opens, so dragging through a color that
 * already exists never absorbs other usages. Changes are applied live (throttled to ~30 Hz)
 * and every drag, nudge sequence or typed value becomes one undo step.
 */
import { Pipette } from 'lucide-react'
import { Popover as RadixPopover } from 'radix-ui'
import { useEffect, useEffectEvent, useMemo, useRef, useState, type RefObject } from 'react'
import { RgbaColorPicker, RgbColorPicker, type RgbaColor } from 'react-colorful'
import { runCommand } from '@/commands/registry'
import { matchesShortcut } from '@/commands/shortcuts'
import {
  ColorSwatch,
  Select,
  Tooltip,
  fieldFrame,
  fieldSizes,
  type ChangeGesture,
} from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { hexToRgba, hslToRgb, rgbToHsl, rgbaToHex, type RGBA } from '@/lib/color'
import { uid } from '@/lib/id'
import { isEditableTarget } from '@/lib/platform'
import { throttle } from '@/lib/timing'
import { documentPalette, readUsageColor, type ColorUsage } from '@/lottie/colors'
import { getDoc, redo, undo, useDocument } from '@/store/document'
import { pushRecentColor, usePrefs } from '@/store/prefs'
import { replaceUsages, revertEdit } from './actions'
import { displayHex } from './format'
import { setColorsPrefs, useColorsPrefs, type PickerFormat } from './store'

export interface EditTarget {
  /** Key of the element the popover points at (`data-color-anchor`). */
  key: string
  /** Document (session id) the usages belong to; the editor closes if another one opens. */
  docId: string | null
  usages: ColorUsage[]
  /** The usage whose current value the editor shows (e.g. after an undo). */
  sample: ColorUsage
  /** Starting color (its alpha is used only when `alpha` is true). */
  color: RGBA
  /** Alpha can be edited (gradient stops with opacity stops). */
  alpha: boolean
  title: string
  subtitle: string
  /** History label of the edits. */
  label: string
}

/** A floating-ui virtual element. */
interface Measurable {
  getBoundingClientRect(): DOMRect
  /** Element whose scroll containers, size and position changes trigger a new measurement. */
  readonly contextElement?: Element
}

function anchorElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-color-anchor="${CSS.escape(key)}"]`)
}

/** Popover anchored to the element with `data-color-anchor={target.key}` (survives re-renders). */
export function ColorEditPopover({
  target,
  onClose,
  side = 'left',
}: {
  target: EditTarget | null
  onClose: () => void
  side?: 'left' | 'right' | 'top' | 'bottom'
}) {
  const lastRect = useRef<DOMRect | null>(null)
  const key = target?.key ?? null
  // Focus goes back to the anchor when the editor closes from inside (Escape, undo of another
  // step), not when the user clicked or focused something else. The props are already cleared
  // when Radix asks where to put focus, hence the refs.
  const returnFocusTo = useRef<string | null>(null)
  const interactedOutside = useRef(false)
  useEffect(() => {
    if (!key) return
    returnFocusTo.current = key
    interactedOutside.current = false
  }, [key])
  // A virtual anchor that finds its row again when measured: rows re-render and may be
  // recycled by the virtualized list while the popover stays open. Its context element lets
  // Radix follow the row (scroll, resize and move observers) without measuring every frame.
  const anchorEl = useRef<HTMLElement | null>(null)
  const anchor = useMemo<RefObject<Measurable>>(() => {
    const find = () => {
      const cached = anchorEl.current
      const element =
        cached?.isConnected && cached.dataset.colorAnchor === key
          ? cached
          : key
            ? anchorElement(key)
            : null
      anchorEl.current = element
      return element
    }
    return {
      current: {
        getBoundingClientRect: () => {
          const rect = find()?.getBoundingClientRect()
          if (rect && rect.height > 0) lastRect.current = rect
          return lastRect.current ?? new DOMRect()
        },
        get contextElement() {
          return find() ?? undefined
        },
      },
    }
  }, [key])

  return (
    <RadixPopover.Root open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <RadixPopover.Anchor virtualRef={anchor} />
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align="start"
          sideOffset={8}
          collisionPadding={8}
          data-testid="color-editor"
          className="z-50 w-[264px] animate-pop-in rounded-lg bg-surface-3 p-3 text-sm text-fg shadow-popover outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const content = e.currentTarget as HTMLElement | null
            content?.querySelector<HTMLElement>('.react-colorful__interactive')?.focus()
          }}
          onInteractOutside={() => (interactedOutside.current = true)}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            const anchorKey = returnFocusTo.current
            if (anchorKey && !interactedOutside.current) anchorElement(anchorKey)?.focus()
            interactedOutside.current = false
          }}
        >
          {target && <ColorEditor key={target.key} target={target} onClose={onClose} />}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Editor                                   */
/* -------------------------------------------------------------------------- */

const to255 = (c: RGBA): RgbaColor => ({
  r: Math.round(c.r * 255),
  g: Math.round(c.g * 255),
  b: Math.round(c.b * 255),
  a: Math.round(c.a * 100) / 100,
})
const from255 = (c: { r: number; g: number; b: number; a?: number }, a: number): RGBA => ({
  r: c.r / 255,
  g: c.g / 255,
  b: c.b / 255,
  a: c.a ?? a,
})

const sameRgb = (a: RGBA, b: RGBA) => rgbaToHex(a) === rgbaToHex(b) && Math.abs(a.a - b.a) < 0.005

function ColorEditor({ target, onClose }: { target: EditTarget; onClose: () => void }) {
  const t = useT()
  const [color, setColor] = useState<RGBA>(target.alpha ? target.color : { ...target.color, a: 1 })
  const alphaTouched = useRef(false)
  const gesture = useRef<{ key: string; endedAt: number } | null>(null)
  /** Coalesce keys of the history entries this editor made (its own steps can be undone here). */
  const ownKeys = useRef(new Set<string>())

  const { usages, label } = target
  const { docId } = target
  const write = useMemo(
    () =>
      throttle((c: RGBA, key: string, alpha: boolean, final: boolean | undefined) => {
        // Never write captured usages into a document that replaced theirs.
        if (useDocument.getState().meta?.id !== docId) return
        replaceUsages(usages, c, { label, coalesceKey: key, final, alpha })
      }, 33),
    [usages, label, docId],
  )

  // Closing the popover mid-throttle must still apply the last value.
  useEffect(() => () => write.flush(), [write])

  /**
   * Applies a change. A pointer drag in the picker is one undo step however long it pauses
   * (its updates are in progress until the pointer is released). Changes separated by less than
   * a second (arrow-key nudges) join the previous gesture, so a burst of small steps is one undo
   * step too.
   */
  const apply = (next: RGBA, g?: ChangeGesture) => {
    if (target.alpha && Math.abs(next.a - color.a) > 1e-4) alphaTouched.current = true
    const now = performance.now()
    let key = g?.key
    if (!key) {
      const recent =
        gesture.current && (gesture.current.endedAt === 0 || now - gesture.current.endedAt < 1000)
      key = recent && gesture.current ? gesture.current.key : uid('color')
    }
    const final = g ? g.final : false
    gesture.current = { key, endedAt: final ? now : 0 }
    ownKeys.current.add(key)
    setColor(next)
    write(next, key, alphaTouched.current, final)
    if (final) {
      write.flush()
      pushRecentColor(rgbaToHex(next))
    }
  }

  /** A complete change (swatch click, typed value, eyedropper). */
  const commit = (next: RGBA) => apply(next, { key: uid('color'), final: true })

  const original = target.alpha ? target.color : { ...target.color, a: 1 }
  const changed = !sameRgb(color, original)

  /** Back to the values every usage had when the editor opened (they may have differed). */
  const revert = () => {
    write.cancel()
    const key = uid('color')
    ownKeys.current.add(key)
    if (useDocument.getState().meta?.id === docId) revertEdit(usages, label, key)
    gesture.current = null
    alphaTouched.current = false
    setColor(original)
  }

  /** Shows the value the document has now (after an undo or redo). */
  const syncFromDocument = () => {
    const doc = getDoc()
    const current = doc ? readUsageColor(doc, target.sample) : null
    if (current) setColor(target.alpha ? current : { ...current, a: 1 })
  }

  // Undo / redo work inside the popover (app shortcuts are off in dialogs) for its own steps.
  // Any other step may change the document's structure under the usages being edited, so the
  // editor closes first.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return // text fields keep their own undo
    const isUndo = matchesShortcut(e, 'mod+z')
    const isRedo = matchesShortcut(e, 'mod+shift+z') || matchesShortcut(e, 'mod+y')
    if (!isUndo && !isRedo) return
    e.preventDefault()
    e.stopPropagation()
    write.flush()
    const { past, future } = useDocument.getState()
    const entry = isUndo ? past[past.length - 1] : future[0]
    if (!entry) return
    if (entry.coalesceKey && ownKeys.current.has(entry.coalesceKey)) {
      gesture.current = null
      if (isUndo) undo()
      else redo()
      syncFromDocument()
    } else {
      onClose()
      runCommand(isUndo ? 'edit.undo' : 'edit.redo')
    }
  })

  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const listener = (e: KeyboardEvent) => onKeyDown(e)
    el.addEventListener('keydown', listener)
    return () => el.removeEventListener('keydown', listener)
  }, [])

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <Header
        target={target}
        color={color}
        original={original}
        changed={changed}
        onRevert={revert}
        onPick={commit}
      />
      {/* A new pointer drag always starts a new undo step (keyboard nudges may join). */}
      <div className="le-color-picker" onPointerDownCapture={() => (gesture.current = null)}>
        {target.alpha ? (
          <RgbaColorPicker
            color={to255(color)}
            onChange={(c) => apply(from255(c, color.a))}
            onChangeEnd={(c) =>
              apply(
                from255(c, color.a),
                gesture.current ? { key: gesture.current.key, final: true } : undefined,
              )
            }
          />
        ) : (
          <RgbColorPicker
            color={to255(color)}
            onChange={(c) => apply(from255(c, 1))}
            onChangeEnd={(c) =>
              apply(
                from255(c, 1),
                gesture.current ? { key: gesture.current.key, final: true } : undefined,
              )
            }
          />
        )}
      </div>
      <ValueFields color={color} alpha={target.alpha} onChange={apply} onCommit={commit} />
      <Swatches
        current={rgbaToHex(color)}
        onPick={(hex) => {
          const c = hexToRgba(hex)
          if (c) commit({ ...c, a: color.a })
        }}
        labels={t.colors.picker}
      />
    </div>
  )
}

/* ---------------------------------- Header --------------------------------- */

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> }
}

function Header({
  target,
  color,
  original,
  changed,
  onRevert,
  onPick,
}: {
  target: EditTarget
  color: RGBA
  original: RGBA
  changed: boolean
  onRevert: () => void
  onPick: (c: RGBA) => void
}) {
  const t = useT()
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
  const pickFromScreen = async () => {
    if (!EyeDropper) return
    try {
      const res = await new EyeDropper().open()
      const c = hexToRgba(res.sRGBHex)
      if (c) onPick({ ...c, a: color.a })
    } catch {
      /* cancelled by the user */
    }
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 shrink-0 overflow-hidden rounded-md shadow-[0_0_0_1px_var(--le-line-strong)]">
        <Tooltip content={t.colors.picker.original}>
          <button
            type="button"
            onClick={onRevert}
            disabled={!changed}
            aria-label={t.colors.picker.original}
            className="relative block h-7 w-[18px] checkerboard-sm disabled:pointer-events-none"
          >
            <span className="absolute inset-0" style={{ background: cssColor(original) }} />
          </button>
        </Tooltip>
        <span
          className="relative block h-7 w-[18px] checkerboard-sm"
          aria-label={t.colors.picker.current}
        >
          <span className="absolute inset-0" style={{ background: cssColor(color) }} />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{target.title}</div>
        <div className="truncate text-xs text-fg-subtle">{target.subtitle}</div>
      </div>
      {EyeDropper && (
        <Tooltip content={t.colors.picker.eyedropper}>
          <button
            type="button"
            onClick={pickFromScreen}
            aria-label={t.colors.picker.eyedropper}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Pipette size={14} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

function cssColor(c: RGBA): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`
}

/* ---------------------------------- Fields --------------------------------- */

function ValueFields({
  color,
  alpha,
  onChange,
  onCommit,
}: {
  color: RGBA
  alpha: boolean
  onChange: (c: RGBA, g: ChangeGesture) => void
  onCommit: (c: RGBA) => void
}) {
  const t = useT()
  const format = useColorsPrefs((s) => s.pickerFormat)
  const p = t.colors.picker
  const rgb = to255(color)
  const hsl = rgbToHsl(color)
  const setHsl = (patch: Partial<{ h: number; s: number; l: number }>, g: ChangeGesture) => {
    const next = { h: hsl.h, s: hsl.s * 100, l: hsl.l * 100, ...patch }
    onChange({ ...hslToRgb({ h: next.h, s: next.s / 100, l: next.l / 100 }), a: color.a }, g)
  }
  return (
    <div className="flex items-center gap-1">
      <Select<PickerFormat>
        value={format}
        onValueChange={(pickerFormat) => setColorsPrefs({ pickerFormat })}
        aria-label={p.format}
        className="w-[58px] shrink-0 px-1.5"
        options={[
          { value: 'hex', label: p.hex },
          { value: 'rgb', label: p.rgb },
          { value: 'hsl', label: p.hsl },
        ]}
      />
      {format === 'hex' && <HexField color={color} onCommit={onCommit} />}
      {format === 'rgb' && (
        <>
          <ChannelField
            label={p.red}
            value={rgb.r}
            max={255}
            onChange={(v, g) => onChange({ ...color, r: v / 255 }, g)}
          />
          <ChannelField
            label={p.green}
            value={rgb.g}
            max={255}
            onChange={(v, g) => onChange({ ...color, g: v / 255 }, g)}
          />
          <ChannelField
            label={p.blue}
            value={rgb.b}
            max={255}
            onChange={(v, g) => onChange({ ...color, b: v / 255 }, g)}
          />
        </>
      )}
      {format === 'hsl' && (
        <>
          <ChannelField
            label={p.hue}
            value={Math.round(hsl.h)}
            max={360}
            onChange={(v, g) => setHsl({ h: v }, g)}
          />
          <ChannelField
            label={p.saturation}
            value={Math.round(hsl.s * 100)}
            max={100}
            onChange={(v, g) => setHsl({ s: v }, g)}
          />
          <ChannelField
            label={p.lightness}
            value={Math.round(hsl.l * 100)}
            max={100}
            onChange={(v, g) => setHsl({ l: v }, g)}
          />
        </>
      )}
      {alpha && (
        <NumberField
          className="w-[46px] shrink-0"
          inputClassName="px-1 text-right"
          value={Math.round(color.a * 100)}
          min={0}
          max={100}
          precision={0}
          suffix="%"
          aria-label={p.alpha}
          onChange={(v, g) => onChange({ ...color, a: v / 100 }, g)}
        />
      )}
    </div>
  )
}

function ChannelField({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: number
  max: number
  onChange: (value: number, gesture: ChangeGesture) => void
}) {
  return (
    <Tooltip content={label}>
      <div className="min-w-0 flex-1">
        <NumberField
          inputClassName="px-1 text-center"
          value={value}
          min={0}
          max={max}
          precision={0}
          aria-label={label}
          onChange={onChange}
        />
      </div>
    </Tooltip>
  )
}

/** Hex input: typed text is applied on Enter or blur; Escape restores the current color. */
function HexField({ color, onCommit }: { color: RGBA; onCommit: (c: RGBA) => void }) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? displayHex(rgbaToHex(color))
  const commit = () => {
    const parsed = draft === null ? null : hexToRgba(draft)
    setDraft(null)
    if (parsed && rgbaToHex(parsed) !== rgbaToHex(color)) onCommit({ ...parsed, a: color.a })
  }
  return (
    <div className={cn(fieldFrame, fieldSizes.sm, 'min-w-0 flex-1')}>
      <span className="pl-2 text-xs text-fg-faint">#</span>
      <input
        aria-label={t.colors.picker.hex}
        value={text}
        spellCheck={false}
        autoComplete="off"
        onFocus={(e) => {
          setDraft(text)
          const input = e.target
          requestAnimationFrame(() => input.select())
        }}
        onChange={(e) =>
          setDraft(
            e.target.value
              .replace(/[^0-9a-f]/gi, '')
              .slice(0, 6)
              .toUpperCase(),
          )
        }
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            requestAnimationFrame(() => (e.target as HTMLInputElement).select())
          } else if (
            e.key === 'Escape' &&
            draft !== null &&
            draft !== displayHex(rgbaToHex(color))
          ) {
            // First Escape restores the text; the next one closes the popover.
            e.preventDefault()
            e.stopPropagation()
            setDraft(displayHex(rgbaToHex(color)))
          }
        }}
        className="h-full w-full min-w-0 bg-transparent px-1 font-mono text-xs tracking-wide text-fg uppercase outline-none"
      />
    </div>
  )
}

/* --------------------------------- Swatches -------------------------------- */

function Swatches({
  current,
  onPick,
  labels,
}: {
  current: string
  onPick: (hex: string) => void
  labels: { documentSwatches: string; recentSwatches: string }
}) {
  const recent = usePrefs((s) => s.recentColors)
  // Read once for the popover's lifetime (no subscription): the palette changes while the user
  // edits it, and recomputing it for every live edit of a big document is wasted work.
  const [docSwatches] = useState(() => {
    const doc = getDoc()
    return doc ? documentPalette(doc).slice(0, 20) : []
  })
  const recentSwatches = recent.filter((c) => !docSwatches.includes(c)).slice(0, 10)
  return (
    <div className="flex flex-col gap-2">
      {docSwatches.length > 0 && (
        <SwatchGrid
          label={labels.documentSwatches}
          colors={docSwatches}
          current={current}
          onPick={onPick}
        />
      )}
      {recentSwatches.length > 0 && (
        <SwatchGrid
          label={labels.recentSwatches}
          colors={recentSwatches}
          current={current}
          onPick={onPick}
        />
      )}
    </div>
  )
}

function SwatchGrid({
  label,
  colors,
  current,
  onPick,
}: {
  label: string
  colors: string[]
  current: string
  onPick: (hex: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="grid grid-cols-10 gap-1">
        {colors.map((c) => (
          <Tooltip key={c} content={`#${displayHex(c)}`}>
            <button
              type="button"
              aria-label={`#${displayHex(c)}`}
              aria-pressed={c === current}
              onClick={() => onPick(c)}
              className={cn(
                'rounded-sm outline-offset-1 transition-shadow duration-100',
                c === current
                  ? 'shadow-[0_0_0_1.5px_var(--le-surface-3),0_0_0_3px_var(--le-accent)]'
                  : 'hover:shadow-[0_0_0_1.5px_var(--le-surface-3),0_0_0_3px_var(--le-line-strong)]',
              )}
            >
              <ColorSwatch color={c} size={20} className="rounded-sm" />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
