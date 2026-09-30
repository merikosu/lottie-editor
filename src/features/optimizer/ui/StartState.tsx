/**
 * The optimizer before any file: the page is the drop zone (the window-wide drop overlay says
 * so while dragging). One title, one line, the ways in, and the three presets to choose from.
 */
import { FolderOpen, Gauge } from 'lucide-react'
import { Button, Kbd } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { PRESET_IDS, type PresetId } from '@/lottie/optimizer'
import { useDocument } from '@/store/document'
import { optimizeEditorDocument } from '../model/intake'
import { presetOf, useOptimizerSettings } from '../model/settings'
import { addSample, chooseFiles, setQueuePreset } from './actions'

const FORMATS = ['.json', '.lottie', '.tgs', '.zip']
const SAMPLES = ['bounce', 'loader', 'like'] as const

function PresetCard({ id, selected }: { id: PresetId; selected: boolean }) {
  const t = useT()
  return (
    <label
      data-testid={`opt-start-preset-${id}`}
      className={cn(
        'group flex min-w-0 cursor-default flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color] duration-100',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
        selected
          ? 'border-accent bg-accent-subtle/40'
          : 'border-line bg-surface-1 hover:border-line-strong',
      )}
    >
      <input
        type="radio"
        name="optimizer-preset"
        value={id}
        checked={selected}
        onChange={() => setQueuePreset(id)}
        className="sr-only"
      />
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'flex size-3 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_var(--le-line-strong)]',
            selected && 'bg-accent shadow-none',
          )}
        >
          {selected && <span className="size-1 rounded-full bg-accent-fg" />}
        </span>
        <span className="truncate text-sm font-medium text-fg">{t.optimizer.presets[id]}</span>
        {id === 'balanced' && (
          <span className="ml-auto shrink-0 text-2xs text-fg-subtle">
            {t.optimizer.presets.recommended}
          </span>
        )}
      </span>
      <span className="text-xs text-fg-muted">{t.optimizer.presets.about[id]}</span>
    </label>
  )
}

export function StartState() {
  const t = useT()
  const fileName = useDocument((s) => s.meta?.fileName ?? null)
  const preset = useOptimizerSettings((s) => presetOf(s.options))
  return (
    <div className="flex min-h-full items-center justify-center px-8 py-12" data-testid="opt-start">
      <div className="flex w-full max-w-[760px] animate-fade-in flex-col items-center text-center">
        <h1 className="text-xl font-semibold text-fg">{t.optimizer.start.title}</h1>
        <p className="mt-2 max-w-[460px] text-base text-fg-muted">
          {t.optimizer.start.description}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="primary"
            size="lg"
            icon={FolderOpen}
            onClick={chooseFiles}
            data-testid="opt-choose"
          >
            {t.optimizer.start.choose}
          </Button>
          {fileName && (
            <Button
              variant="secondary"
              size="lg"
              icon={Gauge}
              onClick={optimizeEditorDocument}
              className="max-w-[320px]"
              data-testid="opt-start-document"
            >
              {t.optimizer.start.optimizeDocument(fileName)}
            </Button>
          )}
        </div>

        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-fg-subtle">
          {FORMATS.map((f) => (
            <code
              key={f}
              className="rounded-xs bg-surface-2 px-1 py-px font-mono text-2xs text-fg-muted"
            >
              {f}
            </code>
          ))}
          <span aria-hidden className="px-0.5">
            ·
          </span>
          <span>{t.optimizer.start.manyAtOnce}</span>
          <span aria-hidden className="px-0.5">
            ·
          </span>
          <span>{t.optimizer.start.paste}</span>
          <Kbd shortcut="mod+v" />
        </p>

        <fieldset className="mt-12 grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
          <legend className="sr-only">{t.optimizer.presets.label}</legend>
          {PRESET_IDS.map((id) => (
            <PresetCard key={id} id={id} selected={preset === id} />
          ))}
        </fieldset>

        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-1 text-xs text-fg-subtle">
          <span>{t.optimizer.start.trySample}</span>
          {SAMPLES.map((id, i) => (
            <span key={id} className="inline-flex items-center gap-1">
              {i > 0 && <span aria-hidden>·</span>}
              <button
                type="button"
                onClick={() => void addSample(id)}
                className="rounded-xs text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-fg hover:decoration-fg-subtle"
              >
                {t.io.samples.names[id]}
              </button>
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}
