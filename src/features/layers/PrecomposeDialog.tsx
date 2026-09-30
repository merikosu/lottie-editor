/**
 * "Precompose…" dialog (After Effects' options): the name of the new composition, whether the
 * attributes move with the layers or stay on the new precomp layer, whether the composition is
 * trimmed to the layers, and notes on what the operation has to do to keep the animation
 * looking the same (matte partners, null copies of parents, stacking, blend modes).
 */
import { Info } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import { Button, Checkbox, Dialog, TextInput } from '@/components/ui'
import { layerDisplayName } from '@/components/lottie/labels'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatDecimal } from '@/lib/format'
import { planPrecompose, type PrecomposeMode, type PrecomposePlan } from '@/lottie/layer-ops'
import { getAt } from '@/lottie/path'
import type { Animation, Layer } from '@/lottie/types'
import { useDocument } from '@/store/document'
import {
  compositionName,
  defaultPrecompName,
  precomposeSelection,
  precomposeTargets,
  setPrecomposePrefs,
  usePrecomposePrefs,
} from './precompose'

export function PrecomposeDialog({ close }: DialogComponentProps) {
  const doc = useDocument((s) => s.doc)
  const selection = useDocument((s) => s.selection)
  const plan = useMemo(() => {
    const targets = precomposeTargets(selection)
    return doc && targets ? planPrecompose(doc, targets) : null
  }, [doc, selection])
  // Opened without precomposable layers (or they went away): nothing to ask.
  useEffect(() => {
    if (!plan) close()
  }, [plan, close])
  return doc && plan ? <PrecomposeForm doc={doc} plan={plan} close={close} /> : null
}

function PrecomposeForm({
  doc,
  plan,
  close,
}: {
  doc: Animation
  plan: PrecomposePlan
  close: () => void
}) {
  const t = useT()
  const text = t.layers.precompose
  const prefs = usePrecomposePrefs()
  const suggested = useMemo(() => defaultPrecompName(doc, plan, t), [doc, plan, t])
  const [name, setName] = useState(suggested)
  const input = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)

  const layers = getAt<Layer[]>(doc, plan.compPath) ?? []
  const label = (i: number) => layerDisplayName(layers[i], i, t)
  const canLeave = plan.leave === null
  const mode: PrecomposeMode = prefs.mode === 'leave' && canLeave ? 'leave' : 'move'
  const comp = compositionName(doc, plan.compPath)
  const size = (s: { w: number; h: number }) => text.size(formatDecimal(s.w), formatDecimal(s.h))
  const own = layers[plan.selected[0]]
  const span = mode === 'leave' && own ? { ip: own.ip, op: own.op } : plan.span
  const moving = mode === 'leave' ? plan.selected : plan.moved

  const apply = () => {
    if (precomposeSelection({ name, mode, adjustDuration: prefs.adjustDuration })) close()
  }
  const latestApply = useRef(apply)
  useEffect(() => {
    latestApply.current = apply
  })
  // Enter confirms from any control, as in After Effects: radios and checkboxes swallow it.
  useEffect(() => {
    const el = form.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      // A held Enter (the one that ran the command) must not confirm right away.
      if (e.key !== 'Enter' || e.isComposing || e.repeat) return
      e.preventDefault()
      latestApply.current()
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [])

  const notes: string[] = []
  if (mode === 'move') {
    const n = text.notes
    const one = (list: number[], single: (s: string) => string, many: (k: number) => string) => {
      if (list.length === 1) notes.push(single(label(list[0])))
      else if (list.length > 1) notes.push(many(list.length))
    }
    one(plan.matteAdded, n.mattesOne, n.mattesMany)
    one(plan.parentsCopied, n.copiedOne, n.copiedMany)
    one(plan.parentsLeft, n.leftOne, n.leftMany)
    if (plan.between.length) notes.push(n.between(plan.between.length))
    if (plan.blendModes) notes.push(n.blendModes)
  }
  if (plan.expressions) notes.push(text.notes.expressions)

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      onOpenAutoFocus={(e) => {
        // The name first, selected, like After Effects.
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }}
      title={text.title}
      description={
        moving.length === 1
          ? text.descriptionOne(label(moving[0]))
          : text.descriptionMany(moving.length)
      }
      size="sm"
      className="w-[440px]"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={apply} data-testid="precompose-apply">
            {text.apply}
          </Button>
        </>
      }
    >
      <form
        ref={form}
        data-testid="precompose-dialog"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-muted">{text.name}</span>
          <TextInput
            ref={input}
            size="md"
            value={name}
            placeholder={suggested}
            onChange={(e) => setName(e.target.value)}
            aria-label={text.name}
            data-testid="precompose-name"
          />
        </label>

        <RadioGroup.Root
          value={mode}
          onValueChange={(value) => setPrecomposePrefs({ mode: value as PrecomposeMode })}
          aria-label={text.title}
          className="flex flex-col gap-3"
        >
          <ModeOption
            value="move"
            title={text.move}
            hint={text.moveHint}
            meta={size(plan.size)}
            testId="precompose-mode-move"
          />
          <ModeOption
            value="leave"
            title={comp ? text.leave(comp) : text.leaveHere}
            hint={canLeave ? text.leaveHint : text.leaveUnavailable[plan.leave!]}
            meta={plan.leaveSize ? size(plan.leaveSize) : undefined}
            disabled={!canLeave}
            testId="precompose-mode-leave"
          />
        </RadioGroup.Root>

        <label className="flex cursor-default items-start gap-2 text-sm text-fg">
          <Checkbox
            checked={prefs.adjustDuration}
            onCheckedChange={(adjustDuration) => setPrecomposePrefs({ adjustDuration })}
            className="mt-px"
            aria-label={text.adjust}
          />
          <span className="min-w-0">
            {text.adjust}
            <span className="mt-0.5 block text-xs text-fg-subtle tabular-nums">
              {text.span(formatDecimal(span.ip), formatDecimal(span.op))}
            </span>
          </span>
        </label>

        {notes.length > 0 && (
          <ul
            className="flex flex-col gap-1.5 border-t border-line pt-3"
            data-testid="precompose-notes"
          >
            {notes.map((note) => (
              <li key={note} className="flex items-start gap-2 text-xs text-fg-muted">
                <Info size={12} aria-hidden className="mt-0.5 shrink-0 text-fg-subtle" />
                <span className="min-w-0">{note}</span>
              </li>
            ))}
          </ul>
        )}
      </form>
    </Dialog>
  )
}

/** One of the two modes: a radio with a title, a hint (or why it is unavailable) and a size. */
function ModeOption({
  value,
  title,
  hint,
  meta,
  disabled,
  testId,
}: {
  value: PrecomposeMode
  title: ReactNode
  hint: ReactNode
  meta?: string
  disabled?: boolean
  testId: string
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2">
      <RadioGroup.Item
        id={id}
        value={value}
        disabled={disabled}
        data-testid={testId}
        className={cn(
          'mt-px inline-flex size-3.5 shrink-0 items-center justify-center rounded-full',
          'shadow-[inset_0_0_0_1px_var(--le-line-strong)] transition-colors duration-100',
          'focus-visible:outline-offset-1 disabled:opacity-40',
          'data-[state=checked]:bg-accent data-[state=checked]:shadow-none',
        )}
      >
        <RadioGroup.Indicator className="block size-1.5 rounded-full bg-accent-fg" />
      </RadioGroup.Item>
      <label
        htmlFor={id}
        className={cn(
          'min-w-0 flex-1 cursor-default text-sm',
          disabled ? 'text-fg-subtle' : 'text-fg',
        )}
      >
        <span className="flex items-baseline gap-3">
          <span className="min-w-0">{title}</span>
          {meta && (
            <span className="ml-auto shrink-0 text-xs text-fg-subtle tabular-nums">{meta}</span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-fg-subtle">{hint}</span>
      </label>
    </div>
  )
}
