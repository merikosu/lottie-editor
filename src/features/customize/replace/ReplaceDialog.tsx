import { FileUp, ImageUp, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { Dialog as RadixDialog } from 'radix-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { nodeDisplayName } from '@/components/lottie/labels'
import type { DialogComponentProps } from '@/commands/dialogs'
import {
  Button,
  Checkbox,
  ColorField,
  IconButton,
  NumberField,
  SegmentedControl,
  Slider,
  Spinner,
  Tooltip,
  type ChangeGesture,
} from '@/components/ui'
import { useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { hexToRgba, rgbaToHex } from '@/lib/color'
import { pathKey } from '@/lottie/path'
import { evaluateVector } from '@/lottie/property'
import {
  analyseOriginalStyle,
  ReplaceError,
  type FitMode,
  type PaintSample,
  type ReplaceWarning,
} from '@/lottie/replace'
import { getDoc } from '@/store/document'
import { useUi } from '@/store/ui'
import { PlayButton, Scrubber } from '../preview/Scrubber'
import { Thumb } from '../panel/Thumb'
import { instancesOf } from '../lib/targets'
import { setCustomizePrefs, useCustomizePrefs, useCustomizeUi } from '../store'
import { DEFAULT_SETTINGS, type ReplaceSettings, type StyleChoice } from './compute'
import { svgWarningLines } from './messages'
import type { ReplaceDialogProps } from './open'
import { ReplaceSession, StaleSessionError } from './session'
import {
  contentOf,
  isReplaceFile,
  maxImageSide,
  readReplaceSource,
  REPLACE_ACCEPT,
  SourceError,
  type ReplaceSource,
} from './source'

/** After the last dragover, the drop highlight goes away (drags that left the window). */
const DRAG_IDLE_MS = 250

/** What went wrong, and why when the file itself says (an SVG with only text, say). */
interface DialogError {
  message: string
  reasons: string[]
}

const failure = (message: string): DialogError => ({ message, reasons: [] })

function describeError(err: unknown, t: Dict): DialogError {
  const e = t.customize.replace.errors
  if (err instanceof SourceError)
    return { message: e[err.code](err.fileName), reasons: svgWarningLines(err.svgWarnings, t) }
  if (err instanceof StaleSessionError) return failure(e.stale)
  if (err instanceof ReplaceError && err.code === 'invalid-target') return failure(e.target)
  return failure(e.failed)
}

/** Hex of a sampled paint at `frame` (the first stop of a gradient). */
function paintHex(sample: PaintSample | null, frame: number): string | null {
  if (!sample) return null
  const item = sample.item
  if (item.ty === 'fl' || item.ty === 'st') {
    const c = evaluateVector(item.c, frame, [0, 0, 0])
    return rgbaToHex({ r: c[0] ?? 0, g: c[1] ?? 0, b: c[2] ?? 0, a: 1 })
  }
  const g = evaluateVector(item.g.k, frame, [])
  return g.length >= 4 ? rgbaToHex({ r: g[1], g: g[2], b: g[3], a: 1 }) : null
}

function isImageDrag(e: DragEvent): boolean {
  const items = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === 'file')
  return items.length > 0 && items.every((i) => i.type.startsWith('image/'))
}

function pickFile(onPick: (file: File) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = REPLACE_ACCEPT
  input.hidden = true
  input.addEventListener(
    'change',
    () => {
      const file = input.files?.[0]
      input.remove()
      if (file) onPick(file)
    },
    { once: true },
  )
  input.addEventListener('cancel', () => input.remove(), { once: true })
  document.body.appendChild(input)
  input.click()
}

function Group({
  label,
  children,
  disabled,
}: {
  label?: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 border-t border-line px-4 py-3',
        disabled && 'pointer-events-none opacity-40',
      )}
      aria-disabled={disabled || undefined}
    >
      {label && <div className="text-xs font-semibold text-fg">{label}</div>}
      {children}
    </div>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  const text = <span className="truncate text-xs text-fg-muted">{label}</span>
  return (
    <div className="grid min-h-6 grid-cols-[76px_minmax(0,1fr)] items-center gap-2">
      {hint ? (
        <Tooltip content={hint} side="left">
          {text}
        </Tooltip>
      ) : (
        text
      )}
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

const sessionKeys = new WeakMap<object, string>()
let nextSessionKey = 0

/** The Replace dialog; opening it again (another target or file) starts a new session. */
export function ReplaceDialog({ props, close }: DialogComponentProps<ReplaceDialogProps>) {
  let key = sessionKeys.get(props)
  if (key === undefined) {
    key = `${pathKey(props.target)}#${nextSessionKey++}`
    sessionKeys.set(props, key)
  }
  return <ReplaceSheet key={key} props={props} close={close} />
}

function ReplaceSheet({ props, close }: DialogComponentProps<ReplaceDialogProps>) {
  const t = useT()
  const prefs = useCustomizePrefs()
  const [name] = useState(() => {
    const doc = getDoc()
    return doc ? nodeDisplayName(doc, props.target, t) : ''
  })
  const [session] = useState(() =>
    ReplaceSession.start(props.target, t.customize.history.replace(name)),
  )
  const [source, setSource] = useState<ReplaceSource | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<DialogError | null>(() =>
    session ? null : failure(t.customize.replace.errors.target),
  )
  const [warnings, setWarnings] = useState<ReplaceWarning[]>([])
  const [applied, setApplied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [settings, setSettings] = useState<ReplaceSettings>(() => ({
    ...DEFAULT_SETTINGS,
    fit: prefs.fit,
    style: prefs.style,
    color: prefs.color,
  }))
  const chooseRef = useRef<HTMLButtonElement>(null)
  const pending = useRef<{ source: ReplaceSource; settings: ReplaceSettings } | null>(null)
  const raf = useRef(0)

  const instances = useMemo(
    () => (session ? instancesOf(session.base, session.target).length : 1),
    [session],
  )
  const original = useMemo(() => {
    if (!session) return { fill: null, accent: null }
    const style = analyseOriginalStyle(session.base, session.target, session.frame)
    return {
      fill: paintHex(style.fill, session.frame),
      accent: paintHex(style.accent, session.frame),
    }
  }, [session])

  /** Shows the result for `next` settings (coalesced to one update per animation frame). */
  const preview = (nextSource: ReplaceSource, nextSettings: ReplaceSettings) => {
    pending.current = { source: nextSource, settings: nextSettings }
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      const job = pending.current
      pending.current = null
      if (!job || !session) return
      const result = session.update(contentOf(job.source), job.settings)
      if (result.ok) {
        setWarnings(result.warnings)
        setApplied(true)
        setError(null)
      } else {
        setError(describeError(result.error, t))
      }
    })
  }

  const readFile = (file: File) => {
    if (!isReplaceFile(file)) {
      setError(failure(t.customize.replace.errors.unsupported(file.name)))
      return
    }
    const doc = getDoc()
    setReading(true)
    setError(null)
    void readReplaceSource(file, { maxSide: doc ? maxImageSide(doc) : 2048 })
      .then((next) => {
        setSource(next)
        preview(next, settingsRef.current)
      })
      .catch((err: unknown) => setError(describeError(err, t)))
      .finally(() => setReading(false))
  }

  const change = (patch: Partial<ReplaceSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    if (source) preview(source, next)
  }
  const scrub = (key: 'scale' | 'offsetX' | 'offsetY') => (value: number, _g: ChangeGesture) =>
    change({ [key]: value })

  // Event listeners and async work call the latest versions.
  const readFileRef = useRef(readFile)
  const settingsRef = useRef(settings)
  useEffect(() => {
    readFileRef.current = readFile
    settingsRef.current = settings
  })

  // Opened with a dropped file: use it right away.
  const initialFile = props.file
  useEffect(() => {
    if (initialFile) readFileRef.current(initialFile)
  }, [initialFile, readFileRef])

  // A file was read: the button that picked it is gone (the source card replaces the drop zone),
  // so the keyboard continues from the one that picks another file.
  useEffect(() => {
    if (!source) return
    const active = document.activeElement
    // The focus trap parks the focus on the sheet itself when its focused button goes away.
    if (!active || active === document.body || active.getAttribute('role') === 'dialog')
      chooseRef.current?.focus()
  }, [source])

  // Closed, the sheet gives the focus back to what had it (the Replace… button of a row, say):
  // it is opened programmatically, so the dialog has no trigger to return to by itself.
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (returnFocus?.isConnected && (!active || active === document.body))
          returnFocus.focus({ preventScroll: true })
      })
    },
    [returnFocus],
  )

  // The page's thumbnails and suggestions wait while the document is a preview.
  useEffect(() => {
    useCustomizeUi.setState({ replacing: true })
    return () => useCustomizeUi.setState({ replacing: false })
  }, [])

  // Closed from outside (another file dropped, another dialog): take the preview back. The props
  // object identifies this dialog; development re-mounts (StrictMode) keep it and change nothing.
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      raf.current = 0
      if (useUi.getState().dialog?.props !== props) session?.cancel()
    },
    [props, session, raf],
  )

  // While the dialog is open, images dropped anywhere replace the element.
  useEffect(() => {
    let timer = 0
    const over = (e: DragEvent) => {
      if (!isImageDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setDragOver(false), DRAG_IDLE_MS)
    }
    const drop = (e: DragEvent) => {
      if (!isImageDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      window.clearTimeout(timer)
      setDragOver(false)
      const file = e.dataTransfer?.files[0]
      if (file) readFileRef.current(file)
    }
    window.addEventListener('dragenter', over, true)
    window.addEventListener('dragover', over, true)
    window.addEventListener('drop', drop, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('dragenter', over, true)
      window.removeEventListener('dragover', over, true)
      window.removeEventListener('drop', drop, true)
    }
  }, [readFileRef])
  const cancel = () => {
    session?.cancel()
    close()
  }
  const apply = () => {
    if (!session || !applied) return
    session.apply()
    setCustomizePrefs({ fit: settings.fit, style: settings.style, color: settings.color })
    close()
  }

  const isSvg = source?.kind === 'svg'
  const svgWarnings = source?.kind === 'svg' ? svgWarningLines(source.svg.warnings, t) : []
  const shownWarnings = warnings.filter((w) => !(w === 'shared-precomp' && settings.everywhere))
  const noSource = !source
  const color = hexToRgba(settings.color) ?? { r: 1, g: 1, b: 1, a: 1 }
  const styleOptions = (['keep', 'original', 'color'] as const).map((value) => ({
    value,
    label: t.customize.replace.styles[value],
  }))
  const fitOptions = (['contain', 'cover', 'stretch'] as const).map((value) => ({
    value,
    label: t.customize.replace.fits[value],
  }))

  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && cancel()}>
      <RadixDialog.Portal>
        <RadixDialog.Content
          data-modal-dialog=""
          data-testid="replace-dialog"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            chooseRef.current?.focus()
          }}
          // The preview stays visible and must not close the dialog by accident.
          onPointerDownOutside={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              apply()
            }
          }}
          className="fixed top-10 right-0 bottom-0 z-50 flex w-[360px] max-w-full animate-fade-in flex-col border-l border-line bg-surface-1 text-fg shadow-dialog outline-none"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
            <RadixDialog.Title className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
              {t.customize.replace.title(name)}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton icon={X} label={t.common.close} tooltip={false} />
            </RadixDialog.Close>
          </div>
          <RadixDialog.Description className="sr-only">
            {t.customize.replace.description}
          </RadixDialog.Description>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-2.5 p-4">
              {source ? (
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-lg bg-surface-2 p-2 shadow-[inset_0_0_0_1px_var(--le-line)] transition-shadow duration-100',
                    dragOver && 'shadow-[inset_0_0_0_1px_var(--le-accent)]',
                  )}
                  data-testid="replace-source"
                >
                  <Thumb
                    src={source.kind === 'svg' ? source.previewUrl : source.dataUri}
                    icon={ImageUp}
                    size={44}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-fg">{source.fileName}</span>
                    <span className="truncate text-xs text-fg-subtle tabular-nums">
                      {dragOver
                        ? t.customize.replace.dropActive
                        : source.kind === 'svg'
                          ? t.customize.replace.svgInfo
                          : t.customize.replace.imageInfo(source.natural.w, source.natural.h)}
                    </span>
                  </div>
                  <Button
                    ref={chooseRef}
                    size="sm"
                    onClick={() => pickFile(readFile)}
                    disabled={reading}
                    data-testid="replace-change"
                  >
                    {reading ? <Spinner size={12} /> : t.customize.replace.change}
                  </Button>
                </div>
              ) : (
                <div
                  className={cn(
                    'relative flex flex-col items-center rounded-lg border border-dashed px-4 pt-6 pb-5 text-center transition-colors duration-150',
                    dragOver
                      ? 'border-accent bg-accent/5'
                      : 'border-line-strong has-[>button:hover]:border-fg-faint',
                  )}
                  data-testid="replace-drop"
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    onClick={() => pickFile(readFile)}
                    className="absolute inset-0 rounded-lg"
                  />
                  <FileUp
                    size={18}
                    className={cn(
                      'pointer-events-none relative',
                      dragOver ? 'text-accent-text' : 'text-fg-faint',
                    )}
                  />
                  <div className="pointer-events-none relative mt-2 text-sm font-medium text-fg">
                    {dragOver ? t.customize.replace.dropActive : t.customize.replace.drop}
                  </div>
                  <div className="pointer-events-none relative mt-0.5 text-xs text-fg-subtle">
                    {t.customize.replace.dropHint}
                  </div>
                  <Button
                    ref={chooseRef}
                    size="sm"
                    variant="secondary"
                    onClick={() => pickFile(readFile)}
                    disabled={reading}
                    className="relative mt-3"
                    data-testid="replace-choose"
                  >
                    {reading ? t.customize.replace.reading : t.customize.replace.choose}
                  </Button>
                </div>
              )}
              {source?.kind === 'image' && source.natural.w > source.w && (
                <p className="text-xs text-fg-subtle">
                  {t.customize.replace.resized(source.w, source.h)}
                </p>
              )}
              {error && (
                <div role="alert" className="flex items-start gap-1.5" data-testid="replace-error">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0 text-danger" />
                  <div className="flex min-w-0 flex-col gap-0.5 text-xs">
                    <span className="text-danger">{error.message}</span>
                    {error.reasons.map((reason) => (
                      <span key={reason} className="text-fg-muted">
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(svgWarnings.length > 0 || shownWarnings.length > 0) && (
                <ul className="flex flex-col gap-1" data-testid="replace-warnings">
                  {svgWarnings.map((line) => (
                    <li key={line} className="flex items-start gap-1.5 text-xs text-fg-muted">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" />
                      <span className="min-w-0">{line}</span>
                    </li>
                  ))}
                  {shownWarnings.map((w) => (
                    <li key={w} className="flex items-start gap-1.5 text-xs text-fg-muted">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" />
                      <span className="min-w-0">{t.customize.replace.warnings[w]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Group label={t.customize.replace.fit} disabled={noSource}>
              <SegmentedControl<FitMode>
                value={settings.fit}
                onValueChange={(fit) => change({ fit })}
                options={fitOptions}
                fill
                className="w-full"
                aria-label={t.customize.replace.fit}
              />
              <p className="-mt-0.5 text-xs text-fg-subtle">
                {t.customize.replace.fitHints[settings.fit]}
              </p>
              <Row label={t.customize.replace.scale}>
                <Slider
                  value={Math.min(300, Math.max(10, settings.scale))}
                  min={10}
                  max={300}
                  step={1}
                  onChange={scrub('scale')}
                  aria-label={t.customize.replace.scale}
                  className="min-w-0 flex-1"
                />
                <NumberField
                  value={settings.scale}
                  min={1}
                  max={1000}
                  step={1}
                  precision={0}
                  suffix="%"
                  onChange={scrub('scale')}
                  aria-label={t.customize.replace.scale}
                  className="w-[68px] shrink-0"
                />
              </Row>
              <Row label={t.customize.replace.offset}>
                <NumberField
                  value={settings.offsetX}
                  label="X"
                  labelTooltip={t.customize.replace.offsetX}
                  step={1}
                  precision={1}
                  suffix="%"
                  onChange={scrub('offsetX')}
                  className="min-w-0 flex-1"
                />
                <NumberField
                  value={settings.offsetY}
                  label="Y"
                  labelTooltip={t.customize.replace.offsetY}
                  step={1}
                  precision={1}
                  suffix="%"
                  onChange={scrub('offsetY')}
                  className="min-w-0 flex-1"
                />
                <IconButton
                  icon={RotateCcw}
                  label={t.customize.replace.resetPlacement}
                  disabled={
                    settings.scale === 100 && settings.offsetX === 0 && settings.offsetY === 0
                  }
                  onClick={() => change({ scale: 100, offsetX: 0, offsetY: 0 })}
                />
              </Row>
            </Group>

            {(isSvg || noSource) && (
              <Group label={t.customize.replace.colors} disabled={noSource}>
                <SegmentedControl<StyleChoice>
                  value={settings.style}
                  onValueChange={(style) => change({ style })}
                  options={styleOptions}
                  fill
                  className="w-full"
                  aria-label={t.customize.replace.colors}
                />
                <p className="-mt-0.5 text-xs text-fg-subtle">
                  {t.customize.replace.styleHints[settings.style]}
                </p>
                {settings.style === 'original' && (original.fill || original.accent) && (
                  <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                    {[original.fill, original.accent]
                      .filter((hex): hex is string => hex !== null)
                      .map((hex) => (
                        <span
                          key={hex}
                          title={hex.toUpperCase()}
                          className="size-3.5 rounded-xs shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)]"
                          style={{ background: hex }}
                        />
                      ))}
                    <span className="truncate">{t.customize.replace.matchSample}</span>
                  </div>
                )}
                {settings.style === 'color' && (
                  <div>
                    <ColorField
                      value={color}
                      alpha={false}
                      onChange={(c) => change({ color: rgbaToHex(c) })}
                      className="w-[140px]"
                    />
                  </div>
                )}
              </Group>
            )}

            {instances > 1 && (
              <Group disabled={noSource}>
                <Tooltip content={t.customize.replace.everywhereHint} side="left">
                  <label className="flex items-center gap-2 text-sm text-fg">
                    <Checkbox
                      checked={settings.everywhere}
                      onCheckedChange={(everywhere) => change({ everywhere })}
                    />
                    {t.customize.replace.everywhere(instances)}
                  </label>
                </Tooltip>
              </Group>
            )}

            <Group label={t.customize.replace.motion}>
              <div className="flex items-center gap-1">
                <PlayButton size="sm" />
                <Scrubber className="flex-1" />
              </div>
            </Group>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
            <span className="flex-1" />
            <Tooltip content={t.customize.replace.cancelHint}>
              <Button variant="ghost" onClick={cancel} data-testid="replace-cancel">
                {t.common.cancel}
              </Button>
            </Tooltip>
            <Tooltip content={t.customize.replace.applyHint} shortcut="mod+enter">
              <Button
                variant="primary"
                onClick={apply}
                disabled={!applied}
                data-testid="replace-apply"
              >
                {t.customize.replace.apply}
              </Button>
            </Tooltip>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
