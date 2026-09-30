import { Link2, Link2Off } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Dialog, IconButton, SegmentedControl, Tooltip } from '@/components/ui'
import { NumberField } from '@/features/inspector/components/number-field'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { planResize, scaleNeedsPrecomp, type Rect, type ResizeMode } from '@/lottie/canvas'
import type { Animation } from '@/lottie/types'
import { useDocument } from '@/store/document'
import { measureContent, resize } from '../actions'
import { AnchorPicker } from '../components/AnchorPicker'
import { CanvasPreview } from '../components/CanvasPreview'
import { formatPercent, formatSigned, formatSize } from '../format'
import { SIZE_PRESETS } from '../presets'
import { useConfirmKey, useInitialFocus } from '../hooks'
import { setDocopsPrefs, useDocopsPrefs } from '../store'

/** Content bounds of a document, measured in the background (null until ready). */
function useContentBounds(doc: Animation): Rect | null {
  const [state, setState] = useState<{ doc: Animation; bounds: Rect | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    void measureContent(doc, () => cancelled).then((bounds) => {
      if (!cancelled) setState({ doc, bounds })
    })
    return () => {
      cancelled = true
    }
  }, [doc])
  return state && state.doc === doc ? state.bounds : null
}

/** Label above a control (dialogs have room for it; long translations never truncate). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-fg-muted">{label}</div>
      {children}
    </div>
  )
}

/** "Canvas size…" dialog: the size section's controls with a visual preview. */
export function ResizeDialog({ close }: DialogComponentProps) {
  const doc = useDocument((s) => s.doc)
  return doc ? <ResizeDialogBody doc={doc} close={close} /> : null
}

function ResizeDialogBody({ doc, close }: { doc: Animation; close: () => void }) {
  const t = useT()
  const prefs = useDocopsPrefs()
  const [size, setSize] = useState({ w: doc.w, h: doc.h })
  const bounds = useContentBounds(doc)
  const { ref: fields, onOpenAutoFocus } = useInitialFocus<HTMLDivElement>()

  const mode = prefs.resizeMode
  const changed = size.w !== doc.w || size.h !== doc.h
  const plan = planResize(doc, size.w, size.h, { mode, anchor: prefs.anchor })
  const sameAspect = Math.abs(size.w / size.h - doc.w / doc.h) < 1e-3
  const anchorActive = mode === 'resize' || !sameAspect

  const change = (axis: 'w' | 'h', value: number) => {
    const v = Math.max(1, Math.round(value))
    setSize((prev) => {
      if (!prefs.keepAspect) return axis === 'w' ? { ...prev, w: v } : { ...prev, h: v }
      return axis === 'w'
        ? { w: v, h: Math.max(1, Math.round((v * doc.h) / doc.w)) }
        : { w: Math.max(1, Math.round((v * doc.w) / doc.h)), h: v }
    })
  }

  const apply = () => {
    if (changed && resize(size.w, size.h, mode, prefs.anchor)) close()
  }
  useConfirmKey(fields, apply, true)

  let hint: string = t.docops.dialogs.unchanged
  if (changed) {
    if (plan.mode === 'scale') {
      hint = t.docops.canvas.planScale(formatPercent(plan.scale))
      if (scaleNeedsPrecomp(doc)) hint += ` ${t.docops.canvas.planPrecomp}`
    } else {
      hint =
        plan.dx || plan.dy
          ? t.docops.canvas.planMove(formatSigned(plan.dx), formatSigned(plan.dy))
          : t.docops.canvas.planStay
    }
  }

  const presets = [
    ...SIZE_PRESETS.map((p) => ({
      key: `${p.w}x${p.h}`,
      label: formatSize(p.w, p.h),
      w: p.w,
      h: p.h,
    })),
    { key: 'x2', label: '×2', w: doc.w * 2, h: doc.h * 2 },
    {
      key: 'x0.5',
      label: '×½',
      w: Math.max(1, Math.round(doc.w / 2)),
      h: Math.max(1, Math.round(doc.h / 2)),
    },
  ]

  return (
    <Dialog
      open
      onOpenAutoFocus={onOpenAutoFocus}
      onOpenChange={(open) => !open && close()}
      title={t.docops.dialogs.resizeTitle}
      description={t.docops.dialogs.resizeDescription}
      size="md"
      className="w-[580px]"
      footerStart={
        changed ? (
          <span className="tabular-nums">
            {formatSize(doc.w, doc.h)} → {formatSize(size.w, size.h)}
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Tooltip content={t.common.apply} shortcut="mod+enter">
            <Button
              variant="primary"
              disabled={!changed}
              onClick={apply}
              data-testid="docops-resize-dialog-apply"
            >
              {t.common.apply}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_232px] gap-5">
        <div ref={fields} className="flex min-w-0 flex-col gap-3">
          <Field label={t.docops.canvas.size}>
            <div className="flex items-center gap-1.5">
              <NumberField
                label={t.docops.canvas.widthShort}
                labelTooltip={t.common.width}
                value={size.w}
                min={1}
                max={16384}
                precision={0}
                onChange={(v) => change('w', v)}
                className="flex-1"
                size="md"
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
                value={size.h}
                min={1}
                max={16384}
                precision={0}
                onChange={(v) => change('h', v)}
                className="flex-1"
                size="md"
              />
            </div>
            <div className="-ml-1.5 flex flex-wrap gap-0.5 pt-1.5">
              {presets.map((p) => {
                const active = p.w === size.w && p.h === size.h
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setSize({ w: p.w, h: p.h })}
                    className={cn(
                      'h-5 rounded-sm px-1.5 text-xs tabular-nums transition-colors duration-100',
                      active
                        ? 'bg-accent-subtle text-accent-text'
                        : 'text-fg-muted hover:bg-hover hover:text-fg',
                    )}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label={t.docops.canvas.mode}>
            <SegmentedControl<ResizeMode>
              value={mode}
              onValueChange={(resizeMode) => setDocopsPrefs({ resizeMode })}
              aria-label={t.docops.canvas.mode}
              size="md"
              fill
              options={[
                { value: 'scale', label: t.docops.canvas.modeScale },
                { value: 'resize', label: t.docops.canvas.modeResize },
              ]}
            />
          </Field>
          <Field label={t.docops.canvas.anchor}>
            <div className="flex items-start gap-3">
              <AnchorPicker
                value={prefs.anchor}
                onChange={(anchor) => setDocopsPrefs({ anchor })}
                growth={
                  mode === 'resize'
                    ? { x: Math.sign(size.w - doc.w), y: Math.sign(size.h - doc.h) }
                    : undefined
                }
                disabled={!anchorActive}
              />
              <p className="min-w-0 flex-1 text-xs text-fg-subtle" data-testid="docops-resize-hint">
                {hint}
              </p>
            </div>
          </Field>
        </div>
        <CanvasPreview doc={doc} plan={plan} bounds={bounds} />
      </div>
    </Dialog>
  )
}
