import { Crop, Link2, Link2Off, Proportions, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  FieldRow,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Section,
  SegmentedControl,
  Spinner,
  Tooltip,
} from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { useT } from '@/i18n'
import { planResize, scaleNeedsPrecomp, type ResizeMode } from '@/lottie/canvas'
import { useDocument } from '@/store/document'
import { openDialog } from '@/store/ui'
import { fitToContent, resize } from './actions'
import { AnchorPicker } from './components/AnchorPicker'
import { PresetMenu, type PresetOption } from './components/PresetMenu'
import { ResultNote } from './components/ResultNote'
import { formatPercent, formatSigned, formatSize } from './format'
import { useCancelKey, useConfirmKey } from './hooks'
import { SIZE_PRESETS, aspectRatio } from './presets'
import { setDocopsPrefs, useDocopsPrefs, useDocopsState } from './store'

/** First keyboard stop of a block (a roving-focus group is reached through its tab stop). */
const TABBABLE =
  '[tabindex="0"], button:not([tabindex="-1"]):not(:disabled), input:not([tabindex="-1"]):not(:disabled)'

interface Draft {
  w: number
  h: number
  /** Canvas size the draft was made for: a draft for another size is stale. */
  baseW: number
  baseH: number
}

/** Inspector section (nothing selected): canvas size, resize canvas / scale content / fit to content. */
export function DocumentSizeSection() {
  const hasDoc = useDocument((s) => s.doc !== null)
  return hasDoc ? <CanvasSection /> : null
}

function CanvasSection() {
  const t = useT()
  const w = useDocument((s) => s.doc?.w ?? 0)
  const h = useDocument((s) => s.doc?.h ?? 0)
  const needsPrecomp = useDocument((s) => (s.doc ? scaleNeedsPrecomp(s.doc) : false))
  const prefs = useDocopsPrefs()
  const busy = useDocopsState((s) => s.busy === 'fit')
  const [draft, setDraft] = useState<Draft | null>(null)
  const container = useRef<HTMLDivElement>(null)

  const pending =
    draft && draft.baseW === w && draft.baseH === h && (draft.w !== w || draft.h !== h)
      ? draft
      : null
  const width = pending?.w ?? w
  const height = pending?.h ?? h
  const mode = prefs.resizeMode

  const change = (axis: 'w' | 'h', value: number) => {
    const v = Math.max(1, Math.round(value))
    let nw = axis === 'w' ? v : width
    let nh = axis === 'h' ? v : height
    if (prefs.keepAspect && w > 0 && h > 0) {
      if (axis === 'w') nh = Math.max(1, Math.round((v * h) / w))
      else nw = Math.max(1, Math.round((v * w) / h))
    }
    setDraft({ w: nw, h: nh, baseW: w, baseH: h })
  }

  const isPending = pending !== null
  const pendingBlock = useRef<HTMLDivElement>(null)
  /**
   * Leaves the pending state. Keyboard users keep their place: when the controls they were in
   * go away, focus returns to the width field instead of the page.
   */
  const finish = (fromKeyboard: boolean) => {
    const inside = fromKeyboard && !!pendingBlock.current?.contains(document.activeElement)
    setDraft(null)
    if (inside) requestAnimationFrame(() => container.current?.querySelector('input')?.focus())
  }
  const apply = (fromKeyboard: boolean) => {
    if (pending && resize(pending.w, pending.h, mode, prefs.anchor)) finish(fromKeyboard)
  }
  // ⌘↩ anywhere in the section applies; Escape cancels (a field being typed in reverts too).
  useConfirmKey(container, () => apply(true), true)
  useCancelKey(container, () => finish(true), isPending)
  // Committing a size with Tab sends focus toward "Fit to content", which the pending controls
  // replace at that very moment: the browser then lands on one of them, or on the page. Start
  // at the first one instead (the mode), once the browser is done moving focus.
  useEffect(() => {
    if (!isPending) return
    const id = setTimeout(() => {
      const block = pendingBlock.current
      const active = document.activeElement
      if (!block || (active && active !== document.body && !block.contains(active))) return
      const first = block.querySelector<HTMLElement>(TABBABLE)
      if (first && !first.contains(active)) first.focus()
    })
    return () => clearTimeout(id)
  }, [isPending])

  const plan = pending
    ? planResize({ w, h }, pending.w, pending.h, { mode, anchor: prefs.anchor })
    : null
  const sameAspect = pending ? Math.abs(pending.w / pending.h - w / h) < 1e-3 : true
  const showAnchor = !!pending && (mode === 'resize' || !sameAspect)
  let hint: string | null = null
  if (plan) {
    if (plan.mode === 'scale') {
      hint = t.docops.canvas.planScale(formatPercent(plan.scale))
      if (needsPrecomp) hint += ` ${t.docops.canvas.planPrecomp}`
    } else {
      hint =
        plan.dx || plan.dy
          ? t.docops.canvas.planMove(formatSigned(plan.dx), formatSigned(plan.dy))
          : t.docops.canvas.planStay
    }
  }

  const presetOptions: PresetOption[] = SIZE_PRESETS.map((p) => ({
    value: `${p.w}x${p.h}`,
    label: formatSize(p.w, p.h),
    hint: aspectRatio(p.w, p.h),
  }))
  const presetActions: PresetOption[] = [
    { value: 'x2', label: t.docops.canvas.presetDouble, hint: formatSize(w * 2, h * 2) },
    {
      value: 'x0.5',
      label: t.docops.canvas.presetHalf,
      hint: formatSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))),
    },
    { value: 'dialog', label: t.docops.commands.resize },
  ]
  const pickPreset = (value: string) => {
    if (value === 'dialog') {
      openDialog('resize')
      return
    }
    let nw: number
    let nh: number
    if (value === 'x2') {
      nw = w * 2
      nh = h * 2
    } else if (value === 'x0.5') {
      nw = Math.max(1, Math.round(w / 2))
      nh = Math.max(1, Math.round(h / 2))
    } else {
      const [a, b] = value.split('x').map(Number)
      nw = a
      nh = b
    }
    setDraft({ w: nw, h: nh, baseW: w, baseH: h })
  }

  return (
    <Section
      id="docops.canvas"
      title={t.docops.canvas.title}
      actions={
        <PresetMenu
          label={t.docops.canvas.presets}
          icon={Proportions}
          options={presetOptions}
          value={`${width}x${height}`}
          actions={presetActions}
          onSelect={pickPreset}
          testId="docops-size-presets"
        />
      }
    >
      <div ref={container} className="flex flex-col gap-1.5" data-testid="docops-canvas">
        <FieldRow label={t.docops.canvas.size}>
          <NumberField
            label={t.docops.canvas.widthShort}
            labelTooltip={t.common.width}
            value={width}
            min={1}
            max={16384}
            precision={0}
            onChange={(v) => change('w', v)}
            className="flex-1"
          />
          <IconButton
            icon={prefs.keepAspect ? Link2 : Link2Off}
            label={t.docops.canvas.keepAspect}
            active={prefs.keepAspect}
            onClick={() => setDocopsPrefs({ keepAspect: !prefs.keepAspect })}
            className="-mx-0.5"
          />
          <NumberField
            label={t.docops.canvas.heightShort}
            labelTooltip={t.common.height}
            value={height}
            min={1}
            max={16384}
            precision={0}
            onChange={(v) => change('h', v)}
            className="flex-1"
          />
        </FieldRow>

        {pending && (
          <div ref={pendingBlock} className="flex flex-col gap-2 pt-1">
            <SegmentedControl<ResizeMode>
              value={mode}
              onValueChange={(resizeMode) => setDocopsPrefs({ resizeMode })}
              aria-label={t.docops.canvas.mode}
              fill
              options={[
                { value: 'scale', label: t.docops.canvas.modeScale },
                { value: 'resize', label: t.docops.canvas.modeResize },
              ]}
            />
            <div className="flex items-start gap-3">
              {showAnchor && (
                <AnchorPicker
                  value={prefs.anchor}
                  onChange={(anchor) => setDocopsPrefs({ anchor })}
                  growth={
                    mode === 'resize'
                      ? { x: Math.sign(pending.w - w), y: Math.sign(pending.h - h) }
                      : undefined
                  }
                />
              )}
              <p className="min-w-0 flex-1 pt-0.5 text-xs text-fg-subtle">{hint}</p>
            </div>
            <div className="flex justify-end gap-1.5">
              {/* detail 0: activated with the keyboard (Enter or Space) */}
              <Button size="sm" variant="ghost" onClick={(e) => finish(e.detail === 0)}>
                {t.common.cancel}
              </Button>
              <Tooltip content={t.common.apply} shortcut="mod+enter">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={(e) => apply(e.detail === 0)}
                  data-testid="docops-resize-apply"
                >
                  {t.common.apply}
                </Button>
              </Tooltip>
            </div>
          </div>
        )}

        {!pending && (
          <div className="flex items-center gap-1">
            <Tooltip content={t.docops.canvas.fitHint}>
              <Button
                size="sm"
                variant="secondary"
                icon={busy ? undefined : Crop}
                disabled={busy}
                onClick={() => void fitToContent()}
                className="min-w-0 flex-1"
                data-testid="docops-fit"
              >
                {busy ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner size={12} />
                    {t.docops.canvas.measuring}
                  </span>
                ) : (
                  t.docops.canvas.fit
                )}
              </Button>
            </Tooltip>
            <FitOptions />
          </div>
        )}
        <ResultNote scope="canvas" />
      </div>
    </Section>
  )
}

/** Popover with the fit-to-content options (remembered). */
function FitOptions() {
  const t = useT()
  const padding = useDocopsPrefs((s) => s.fitPadding)
  const includeOffCanvas = useDocopsPrefs((s) => s.fitIncludeOffCanvas)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          icon={SlidersHorizontal}
          label={t.docops.canvas.fitOptions}
          variant="secondary"
          data-testid="docops-fit-options"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-2.5">
        <div className="text-xs font-semibold text-fg">{t.docops.canvas.fitOptions}</div>
        <FieldRow label={t.docops.canvas.padding}>
          <NumberField
            value={padding}
            min={0}
            max={2000}
            precision={0}
            suffix={t.common.pixelsShort}
            onChange={(v) => setDocopsPrefs({ fitPadding: Math.max(0, Math.round(v)) })}
            className="flex-1"
          />
        </FieldRow>
        <label className="flex cursor-default items-start gap-2 text-sm text-fg">
          <Checkbox
            checked={includeOffCanvas}
            onCheckedChange={(fitIncludeOffCanvas) => setDocopsPrefs({ fitIncludeOffCanvas })}
            className="mt-px"
          />
          <span className="min-w-0">
            {t.docops.canvas.includeOffCanvas}
            <span className="mt-0.5 block text-xs text-fg-subtle">
              {t.docops.canvas.includeOffCanvasHint}
            </span>
          </span>
        </label>
      </PopoverContent>
    </Popover>
  )
}
