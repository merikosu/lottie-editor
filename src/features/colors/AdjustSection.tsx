/**
 * "Adjust" section: hue / saturation / lightness / tint for every color in scope, plus
 * one-shot Invert and Grayscale.
 *
 * Sliders are relative to the colors at the start of an adjustment session, so moving a slider
 * back to 0 restores them exactly. Each slider drag (or burst of arrow-key steps) is one undo
 * step. The session ends when the document changes for another reason (undo, other edits) or
 * the scope changes; the sliders then return to 0 and describe changes relative to the new
 * colors.
 */
import { Contrast, DropletOff, RotateCcw } from 'lucide-react'
import { Slider as RadixSlider } from 'radix-ui'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  ColorField,
  IconButton,
  Section,
  Tooltip,
  type ChangeGesture,
} from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { useT } from '@/i18n'
import { hexToRgba, rgbaToHex, type RGBA } from '@/lib/color'
import { uid } from '@/lib/id'
import { throttle } from '@/lib/timing'
import type { ColorAdjustment, ColorUsage } from '@/lottie/colors'
import type { Animation } from '@/lottie/types'
import { getDoc, useDocument } from '@/store/document'
import { ADJUST_SECTION_ID, adjustUsages, grayscaleUsages, invertUsages } from './actions'
import { setColorsPrefs, useColorsPrefs, useColorsUi, type ColorScope } from './store'
import { scopedUsagesNow } from './useColorData'
import { useDocumentColors } from './useDocumentColors'

type Param = 'hue' | 'saturation' | 'lightness' | 'tint'
type Params = Record<Param, number>

const ZERO: Params = { hue: 0, saturation: 0, lightness: 0, tint: 0 }
const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 }

interface Session {
  /** Usages (with their colors) at the start of the session: the base of every adjustment. */
  usages: ColorUsage[]
  params: Params
  /** Document after our last write; any other document ends the session. */
  doc: Animation | null
  /** Session id of the document the usages belong to. */
  docId: string | null
  scopeKey: string
}

function toAdjustment(params: Params, tintColor: RGBA): ColorAdjustment {
  return {
    hue: params.hue,
    saturation: params.saturation,
    lightness: params.lightness,
    tint: params.tint ? { color: tintColor, amount: params.tint / 100 } : undefined,
  }
}

export interface AdjustSectionProps {
  /** Usages in scope (for the one-shot buttons). */
  usages: ColorUsage[]
  scope: ColorScope
  /** Identifies the scope's content; a change ends the session. */
  scopeKey: string
  /** A slider drag starts / ends (the list keeps its rows still meanwhile). */
  onGestureStart: () => void
  onGestureEnd: () => void
}

export function AdjustSection({
  usages,
  scope,
  scopeKey,
  onGestureStart,
  onGestureEnd,
}: AdjustSectionProps) {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const tintHex = useColorsPrefs((s) => s.tintColor)
  const tintColor = hexToRgba(tintHex) ?? WHITE
  // The ref is the source of truth for event handlers (several changes can arrive in one
  // event); the state copy renders the sliders.
  const sessionRef = useRef<Session | null>(null)
  const [session, setSessionState] = useState<Session | null>(null)
  const setSession = (next: Session | null) => {
    sessionRef.current = next
    setSessionState(next)
  }
  const isLive = (s: Session | null, current: Animation | null): s is Session =>
    !!s && s.doc === current && s.scopeKey === scopeKey
  const params = isLive(session, doc) ? session.params : ZERO
  const active = Object.values(params).some((v) => v !== 0)
  const labels: Record<Param, string> = {
    hue: t.colors.history.hue,
    saturation: t.colors.history.saturation,
    lightness: t.colors.history.lightness,
    tint: t.colors.history.tint,
  }

  // Runs the latest pending write at most every 33 ms (live preview at ~30 Hz).
  const write = useMemo(() => throttle((task: () => void) => task(), 33), [])
  useEffect(() => () => write.flush(), [write])

  const writeAdjustment = (
    base: ColorUsage[],
    next: ColorAdjustment,
    label: string,
    gesture: ChangeGesture,
  ) =>
    write(() => {
      const s = sessionRef.current
      // Never write captured usages into a document that replaced theirs.
      if (!s || s.usages !== base || useDocument.getState().meta?.id !== s.docId) return
      adjustUsages(base, next, label, gesture)
      setSession({ ...s, doc: getDoc() })
    })

  /** The live session, or a new one based on the colors in scope right now. */
  const currentSession = (): Session => {
    const current = sessionRef.current
    return isLive(current, getDoc())
      ? current
      : {
          usages: scopedUsagesNow(scope),
          params: ZERO,
          doc: getDoc(),
          docId: useDocument.getState().meta?.id ?? null,
          scopeKey,
        }
  }

  const change = (param: Param, value: number, g: ChangeGesture) => {
    const base = currentSession()
    if (base.params[param] === value && g.final) {
      write.flush()
      onGestureEnd()
      return
    }
    const next: Session = { ...base, params: { ...base.params, [param]: value } }
    setSession(next)
    if (!g.final) onGestureStart()
    writeAdjustment(next.usages, toAdjustment(next.params, tintColor), labels[param], g)
    if (g.final) {
      write.flush()
      onGestureEnd()
    }
  }

  /** A new tint color re-applies the current tint amount (one undo step per picker gesture). */
  const changeTintColor = (color: RGBA, g: ChangeGesture) => {
    setColorsPrefs({ tintColor: rgbaToHex(color) })
    const current = sessionRef.current
    if (!isLive(current, getDoc()) || current.params.tint === 0) return
    writeAdjustment(current.usages, toAdjustment(current.params, color), labels.tint, g)
    if (g.final) write.flush()
  }

  const reset = () => {
    const current = sessionRef.current
    write.cancel()
    if (isLive(current, getDoc())) adjustUsages(current.usages, {}, t.colors.history.resetAdjust)
    setSession(null)
  }

  const oneShot = (apply: (u: ColorUsage[]) => boolean) => {
    write.flush()
    apply(scopedUsagesNow(scope))
    setSession(null)
  }

  // `colors.adjust` command: focus the first slider once the section is rendered. Radix keeps a
  // new slider's thumb hidden until it has measured it, so this waits for it (a few frames).
  const focusRequested = useColorsUi((s) => s.focusAdjust)
  const hueRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusRequested) return
    let frame = 0
    let tries = 0
    const attempt = () => {
      const thumb = hueRef.current?.querySelector<HTMLElement>('[role="slider"]')
      if (thumb?.offsetParent) thumb.focus()
      else if (tries++ < 10) {
        frame = requestAnimationFrame(attempt)
        return
      }
      useColorsUi.setState({ focusAdjust: false })
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [focusRequested])

  return (
    <Section
      id={ADJUST_SECTION_ID}
      title={scope === 'selection' ? t.colors.adjust.titleSelection : t.colors.adjust.title}
      // The palette is the main job of the panel: the sliders stay out of its way until asked for.
      defaultCollapsed
      className="shrink-0 border-t border-b-0"
      actions={
        active && (
          <IconButton
            icon={RotateCcw}
            label={t.colors.adjust.reset}
            tooltipSide="top"
            onClick={reset}
          />
        )
      }
    >
      <div ref={hueRef}>
        <AdjustRow
          label={t.colors.adjust.hue}
          value={params.hue}
          min={-180}
          max={180}
          suffix="°"
          onChange={(v, g) => change('hue', v, g)}
        />
      </div>
      <AdjustRow
        label={t.colors.adjust.saturation}
        value={params.saturation}
        min={-100}
        max={100}
        onChange={(v, g) => change('saturation', v, g)}
      />
      <AdjustRow
        label={t.colors.adjust.lightness}
        value={params.lightness}
        min={-100}
        max={100}
        onChange={(v, g) => change('lightness', v, g)}
      />
      <AdjustRow
        label={t.colors.adjust.tint}
        value={params.tint}
        min={0}
        max={100}
        suffix="%"
        onChange={(v, g) => change('tint', v, g)}
        leading={<TintColorField color={tintColor} onChange={changeTintColor} />}
      />
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        <Tooltip content={t.colors.adjust.invertHint}>
          <Button
            size="sm"
            icon={Contrast}
            disabled={usages.length === 0}
            onClick={() => oneShot(invertUsages)}
          >
            {t.colors.adjust.invert}
          </Button>
        </Tooltip>
        <Tooltip content={t.colors.adjust.grayscaleHint}>
          <Button
            size="sm"
            icon={DropletOff}
            disabled={usages.length === 0}
            onClick={() => oneShot(grayscaleUsages)}
          >
            {t.colors.adjust.grayscale}
          </Button>
        </Tooltip>
      </div>
    </Section>
  )
}

/** Tint color swatch (a component so the document palette is only read while it is shown). */
function TintColorField({
  color,
  onChange,
}: {
  color: RGBA
  onChange: (c: RGBA, g: ChangeGesture) => void
}) {
  const t = useT()
  const swatches = useDocumentColors()
  return (
    <Tooltip content={t.colors.adjust.tintColor} side="left">
      <div className="shrink-0">
        <ColorField
          value={color}
          onChange={onChange}
          alpha={false}
          showHex={false}
          swatches={swatches}
          className="w-6 justify-center pl-0"
        />
      </div>
    </Tooltip>
  )
}

interface AdjustRowProps {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  /** Control placed before the slider (e.g. the tint color). */
  leading?: ReactNode
  onChange: (value: number, gesture: ChangeGesture) => void
}

function AdjustRow({ label, value, min, max, suffix, leading, onChange }: AdjustRowProps) {
  const t = useT()
  const resetToZero = () => {
    if (value !== 0) onChange(0, { key: uid('adjust'), final: true })
  }
  return (
    <div className="grid h-6 grid-cols-[84px_minmax(0,1fr)_52px] items-center gap-2">
      <Tooltip content={t.colors.adjust.resetValue} side="left">
        <span className="truncate text-xs text-fg-muted" onDoubleClick={resetToZero}>
          {label}
        </span>
      </Tooltip>
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <CenteredSlider
          label={label}
          value={value}
          min={min}
          max={max}
          onChange={onChange}
          onReset={resetToZero}
        />
      </div>
      <NumberField
        value={value}
        min={min}
        max={max}
        precision={0}
        suffix={suffix}
        aria-label={label}
        inputClassName="px-1 text-right"
        onChange={onChange}
      />
    </div>
  )
}

/**
 * Slider whose fill grows from 0 towards the value (from the center for ranges around 0).
 *
 * Gestures: a pointer drag is one gesture (changes, then a final commit). Radix reports a
 * keyboard step as commit-then-change with the same value, so steps are emitted once, as
 * final changes that share a key while they come in quick succession.
 */
function CenteredSlider({
  label,
  value,
  min,
  max,
  onChange,
  onReset,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number, gesture: ChangeGesture) => void
  onReset: () => void
}) {
  const pointerKey = useRef<string | null>(null)
  const nudge = useRef<{ key: string; at: number } | null>(null)
  const lastEmitted = useRef<number | null>(null)

  const emitStep = (v: number) => {
    const now = performance.now()
    const key = nudge.current && now - nudge.current.at < 1000 ? nudge.current.key : uid('adjust')
    nudge.current = { key, at: now }
    lastEmitted.current = v
    onChange(v, { key, final: true })
  }

  const pct = (v: number) => ((v - min) / (max - min)) * 100
  const zero = pct(Math.min(Math.max(0, min), max))
  const current = pct(value)
  return (
    <RadixSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={1}
      onPointerDown={() => {
        pointerKey.current = uid('adjust')
        lastEmitted.current = null
      }}
      onPointerUp={() => {
        // Radix commits after this handler; forget the drag once it has.
        setTimeout(() => (pointerKey.current = null), 0)
      }}
      onValueChange={([v]) => {
        if (pointerKey.current) {
          lastEmitted.current = v
          onChange(v, { key: pointerKey.current, final: false })
        } else if (v !== lastEmitted.current) {
          emitStep(v)
        }
      }}
      onValueCommit={([v]) => {
        if (pointerKey.current) {
          lastEmitted.current = v
          onChange(v, { key: pointerKey.current, final: true })
          pointerKey.current = null
        } else {
          emitStep(v)
        }
      }}
      onDoubleClick={onReset}
      className="relative flex h-4 w-full min-w-0 touch-none items-center select-none"
    >
      <RadixSlider.Track className="relative h-[3px] grow rounded-full bg-line-strong">
        {min < 0 && (
          <span className="absolute top-1/2 left-1/2 h-[7px] w-px -translate-x-1/2 -translate-y-1/2 bg-fg-faint" />
        )}
        <span
          className="absolute inset-y-0 rounded-full bg-accent"
          style={{ left: `${Math.min(zero, current)}%`, width: `${Math.abs(current - zero)}%` }}
        />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={label}
        className="block size-3 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15),0_1px_3px_rgb(0_0_0/0.4)] focus-visible:outline-2 focus-visible:outline-accent"
      />
    </RadixSlider.Root>
  )
}
