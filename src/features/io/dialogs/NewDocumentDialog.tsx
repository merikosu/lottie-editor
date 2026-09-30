import { ArrowLeftRight } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import {
  Button,
  Dialog,
  IconButton,
  NumberField,
  SegmentedControl,
  TextInput,
} from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { createNewAnimation } from '../open'

type PresetId = 'square' | 'post' | 'landscape' | 'portrait' | 'icon' | 'custom'
type FpsChoice = '24' | '25' | '30' | '60' | 'custom'

const PRESETS: { id: Exclude<PresetId, 'custom'>; w: number; h: number }[] = [
  { id: 'square', w: 512, h: 512 },
  { id: 'post', w: 1080, h: 1080 },
  { id: 'landscape', w: 1920, h: 1080 },
  { id: 'portrait', w: 1080, h: 1920 },
  { id: 'icon', w: 256, h: 256 },
]

const PRESET_IDS: PresetId[] = [...PRESETS.map((p) => p.id), 'custom']

interface Settings {
  preset: PresetId
  width: number
  height: number
  fps: FpsChoice
  customFps: number
  seconds: number
}

const DEFAULTS: Settings = {
  preset: 'square',
  width: 512,
  height: 512,
  fps: '30',
  customFps: 30,
  seconds: 3,
}
const STORAGE_KEY = 'lottie-editor:new-animation'
const MAX_SIZE = 16384

/** The preset with exactly this size, else "custom". */
function presetFor(width: number, height: number): PresetId {
  return PRESETS.find((p) => p.w === width && p.h === height)?.id ?? 'custom'
}

/** Last used settings (a convenience: remembered per browser). */
function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Settings> | null
    if (!raw) return DEFAULTS
    const s = { ...DEFAULTS, ...raw }
    // A stored preset must still match the stored size (older versions kept them apart).
    return { ...s, preset: s.preset === 'custom' ? 'custom' : presetFor(s.width, s.height) }
  } catch {
    return DEFAULTS
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Storage may be unavailable (private mode): the dialog simply starts from defaults.
  }
}

/** Rectangle with the preset's aspect ratio. */
function AspectGlyph({ w, h, dashed }: { w: number; h: number; dashed?: boolean }) {
  const box = 18
  const scale = box / Math.max(w, h)
  return (
    <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
      <span
        className={cn('rounded-[2px] border-[1.5px] border-current', dashed && 'border-dashed')}
        style={{
          width: Math.max(6, Math.round(w * scale)),
          height: Math.max(6, Math.round(h * scale)),
        }}
      />
    </span>
  )
}

function Row({
  label,
  children,
  htmlFor,
}: {
  label: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
      <label htmlFor={htmlFor} className="truncate pt-1.5 text-xs text-fg-muted">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/**
 * "New animation": name, size (preset cards plus W × H fields that are always there, so choosing
 * "Custom" never moves the dialog), frame rate and duration.
 */
export function NewDocumentDialog({ close }: DialogComponentProps<undefined>) {
  const t = useT()
  const [s, setS] = useState<Settings>(loadSettings)
  const [name, setName] = useState('')
  const sizeFieldsRef = useRef<HTMLDivElement>(null)
  const update = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }))

  const fps = s.fps === 'custom' ? s.customFps : Number(s.fps)
  const frames = Math.max(1, Math.round(s.seconds * fps))
  const valid = s.width >= 1 && s.height >= 1 && fps > 0 && s.seconds > 0

  const choosePreset = (id: PresetId) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (preset) {
      update({ preset: id, width: preset.w, height: preset.h })
      return
    }
    update({ preset: 'custom' })
    // "Custom" means "type a size": put the cursor there.
    sizeFieldsRef.current?.querySelector('input')?.focus()
  }

  // Typing a preset's size selects that preset; any other size is custom.
  const setSize = (width: number, height: number) =>
    update({ width, height, preset: presetFor(width, height) })

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!valid) return
    saveSettings(s)
    close()
    void createNewAnimation({
      name,
      width: Math.round(s.width),
      height: Math.round(s.height),
      fps,
      frames,
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      size="md"
      title={t.io.newDoc.title}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="le-new-animation"
            disabled={!valid}
            data-testid="new-create"
          >
            {t.io.newDoc.create}
          </Button>
        </>
      }
    >
      <form id="le-new-animation" onSubmit={submit} className="flex flex-col gap-4 pt-1">
        <Row label={t.io.newDoc.name} htmlFor="le-new-name">
          <TextInput
            id="le-new-name"
            size="md"
            value={name}
            autoFocus
            placeholder={t.io.newDoc.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </Row>

        <Row label={t.io.newDoc.size}>
          <fieldset className="grid grid-cols-3 gap-1.5">
            <legend className="sr-only">{t.io.newDoc.size}</legend>
            {PRESET_IDS.map((id) => {
              const preset = PRESETS.find((p) => p.id === id)
              const selected = s.preset === id
              return (
                <label
                  key={id}
                  data-testid={`preset-${id}`}
                  className={cn(
                    'flex h-11 min-w-0 items-center gap-2 rounded-md px-2 text-left transition-[background-color,box-shadow] duration-100',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
                    selected
                      ? 'bg-selected text-accent-text shadow-[inset_0_0_0_1px_var(--le-accent)]'
                      : 'bg-surface-2 text-fg-subtle shadow-[inset_0_0_0_1px_transparent] hover:shadow-[inset_0_0_0_1px_var(--le-line-strong)]',
                  )}
                >
                  <input
                    type="radio"
                    name="le-new-preset"
                    value={id}
                    checked={selected}
                    onChange={() => choosePreset(id)}
                    // Clicking the selected "Custom" card again still focuses the size fields.
                    onClick={() => id === 'custom' && selected && choosePreset(id)}
                    className="sr-only"
                  />
                  <AspectGlyph w={preset?.w ?? 4} h={preset?.h ?? 3} dashed={!preset} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-fg">
                      {t.io.newDoc.presets[id]}
                    </span>
                    <span className="truncate text-2xs text-fg-subtle tabular-nums">
                      {preset ? `${preset.w} × ${preset.h}` : t.io.newDoc.anySize}
                    </span>
                  </span>
                </label>
              )
            })}
          </fieldset>
          <div ref={sizeFieldsRef} className="mt-2 flex items-center gap-1">
            <NumberField
              value={s.width}
              onChange={(v) => setSize(v, s.height)}
              label={t.io.newDoc.widthShort}
              labelTooltip={t.common.width}
              suffix={t.common.pixelsShort}
              min={1}
              max={MAX_SIZE}
              precision={0}
              size="md"
              className="w-28"
            />
            <IconButton
              icon={ArrowLeftRight}
              label={t.io.newDoc.swap}
              onClick={() => setSize(s.height, s.width)}
            />
            <NumberField
              value={s.height}
              onChange={(v) => setSize(s.width, v)}
              label={t.io.newDoc.heightShort}
              labelTooltip={t.common.height}
              suffix={t.common.pixelsShort}
              min={1}
              max={MAX_SIZE}
              precision={0}
              size="md"
              className="w-28"
            />
          </div>
        </Row>

        <Row label={t.io.newDoc.frameRate}>
          <div className="flex items-center gap-2">
            <SegmentedControl<FpsChoice>
              value={s.fps}
              onValueChange={(fpsChoice) => update({ fps: fpsChoice })}
              aria-label={t.io.newDoc.frameRate}
              size="md"
              options={[
                { value: '24', label: '24' },
                { value: '25', label: '25' },
                { value: '30', label: '30' },
                { value: '60', label: '60' },
                { value: 'custom', label: t.io.newDoc.customFps },
              ]}
            />
            {s.fps === 'custom' && (
              <NumberField
                value={s.customFps}
                onChange={(v) => update({ customFps: v })}
                suffix={t.common.fps}
                min={1}
                max={240}
                precision={2}
                size="md"
                className="w-24"
                aria-label={t.io.newDoc.frameRate}
              />
            )}
          </div>
        </Row>

        <Row label={t.io.newDoc.duration}>
          <div className="flex items-center gap-2.5">
            <NumberField
              value={s.seconds}
              onChange={(v) => update({ seconds: v })}
              suffix={t.common.secondsShort}
              min={0.05}
              max={3600}
              step={0.5}
              scrubSpeed={0.05}
              precision={2}
              size="md"
              className="w-28"
              aria-label={t.io.newDoc.duration}
            />
            <span className="text-xs text-fg-subtle tabular-nums">
              {t.io.newDoc.frames(frames)}
            </span>
          </div>
        </Row>
      </form>
    </Dialog>
  )
}
