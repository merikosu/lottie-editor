/**
 * Settings (⌘,): appearance, preview defaults, browser storage and reset. Every change applies
 * immediately (they are the same preferences the menus and toolbars change).
 */
import { Check, Monitor, Moon, Pipette, Sun, TriangleAlert } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { useEffect, useId, useState, type CSSProperties } from 'react'
import type { DialogComponentProps } from '@/commands/dialogs'
import {
  Button,
  ColorField,
  Dialog,
  SegmentedControl,
  Select,
  Switch,
  Tooltip,
  toast,
} from '@/components/ui'
import { LANGUAGES, setLanguage, useLanguage, useT, type Language } from '@/i18n'
import { cn } from '@/lib/cn'
import { contrastingFg, hexToRgba, normalizeHex, rgbaToHex } from '@/lib/color'
import {
  setPrefs,
  usePrefs,
  type CanvasBackground,
  type RendererType,
  type ThemePref,
} from '@/store/prefs'
import { ConfirmButton, SettingRow, SettingsSection } from './parts'
import {
  clearStoredFiles,
  formatStorageSize,
  readStorageInfo,
  requestPersistence,
  resetPreferences,
  type StorageInfo,
} from './storage'
import { useReturnFocus } from '../useReturnFocus'

/* -------------------------------------------------------------------------- */
/*                                 Appearance                                 */
/* -------------------------------------------------------------------------- */

function ThemeControl() {
  const t = useT()
  const theme = usePrefs((s) => s.theme)
  return (
    <SegmentedControl<ThemePref>
      value={theme}
      onValueChange={(value) => setPrefs({ theme: value })}
      aria-label={t.workspace.settings.theme}
      options={[
        { value: 'dark', icon: Moon, label: t.app.theme.dark },
        { value: 'light', icon: Sun, label: t.app.theme.light },
        { value: 'system', icon: Monitor, label: t.app.theme.system },
      ]}
    />
  )
}

function LanguageControl() {
  const t = useT()
  const language = usePrefs((s) => s.language)
  return (
    <div className="w-36">
      <Select<Language>
        value={language}
        onValueChange={setLanguage}
        aria-label={t.workspace.settings.language}
        options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Preview                                  */
/* -------------------------------------------------------------------------- */

/** Fixed preview colors of the viewport (viewport/backgrounds.ts), independent of the UI theme. */
const PREVIEW_DARK = '#1b1c1f'
const PREVIEW_LIGHT = '#ffffff'
const BACKGROUNDS: readonly CanvasBackground[] = ['checker', 'dark', 'light', 'custom']

function swatchStyle(mode: CanvasBackground, custom: string): CSSProperties {
  if (mode === 'dark') return { backgroundColor: PREVIEW_DARK }
  if (mode === 'light') return { backgroundColor: PREVIEW_LIGHT }
  if (mode === 'custom') return { backgroundColor: normalizeHex(custom) ?? PREVIEW_LIGHT }
  const b = 'var(--le-checker-b)'
  return {
    backgroundColor: 'var(--le-checker-a)',
    backgroundImage: `linear-gradient(45deg, ${b} 25%, transparent 25%), linear-gradient(-45deg, ${b} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${b} 75%), linear-gradient(-45deg, transparent 75%, ${b} 75%)`,
    backgroundSize: '8px 8px',
    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
  }
}

function BackgroundControl() {
  const t = useT()
  const s = t.workspace.settings
  const mode = usePrefs((p) => p.canvasBackground)
  const custom = usePrefs((p) => p.canvasColor)
  const customRgba = hexToRgba(custom) ?? { r: 1, g: 1, b: 1, a: 1 }
  const pipetteColor =
    contrastingFg(customRgba) === '#000000' ? 'rgb(0 0 0 / 0.55)' : 'rgb(255 255 255 / 0.8)'
  return (
    <RadioGroup.Root
      value={mode}
      onValueChange={(v) => setPrefs({ canvasBackground: v as CanvasBackground })}
      aria-label={s.background}
      orientation="horizontal"
      className="flex items-center gap-1.5"
    >
      {BACKGROUNDS.map((bg) => (
        <Tooltip key={bg} content={s.backgrounds[bg]}>
          <RadioGroup.Item
            value={bg}
            aria-label={s.backgrounds[bg]}
            data-testid={`settings-bg-${bg}`}
            className={cn(
              'relative size-6 shrink-0 rounded-md outline-offset-2 transition-shadow duration-100',
              'hover:shadow-[0_0_0_2px_var(--le-surface-1),0_0_0_3px_var(--le-line-strong)]',
              // aria-checked, not data-state: the tooltip trigger overwrites data-state.
              'aria-checked:shadow-[0_0_0_2px_var(--le-surface-1),0_0_0_3.5px_var(--le-accent)]',
            )}
            style={swatchStyle(bg, custom)}
          >
            {/* Hairline so white and dark swatches stay visible on either theme. */}
            <span
              aria-hidden
              className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.16)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]"
            />
            {bg === 'custom' && (
              <Pipette
                size={12}
                aria-hidden
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ color: pipetteColor }}
              />
            )}
          </RadioGroup.Item>
        </Tooltip>
      ))}
    </RadioGroup.Root>
  )
}

function CustomColorControl() {
  const custom = usePrefs((p) => p.canvasColor)
  const value = hexToRgba(custom) ?? { r: 1, g: 1, b: 1, a: 1 }
  return (
    <ColorField
      className="w-32"
      value={value}
      alpha={false}
      onChange={(c) => setPrefs({ canvasColor: rgbaToHex({ ...c, a: 1 }) })}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Storage                                  */
/* -------------------------------------------------------------------------- */

function useStorageInfo(): [StorageInfo | null, () => void] {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  useEffect(() => {
    let alive = true
    void readStorageInfo().then((next) => {
      if (alive) setInfo(next)
    })
    return () => {
      alive = false
    }
  }, [])
  return [info, () => void readStorageInfo().then(setInfo)]
}

function StatusNote({ children }: { children: string }) {
  return (
    <span className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
      <Check size={12} className="shrink-0 text-success" aria-hidden />
      {children}
    </span>
  )
}

function StorageRows() {
  const t = useT()
  const s = t.workspace.settings
  const language = useLanguage()
  const autosave = usePrefs((p) => p.autosave)
  const autosaveId = useId()
  const [info, refresh] = useStorageInfo()
  const [cleared, setCleared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)

  const clear = async () => {
    setBusy(true)
    try {
      await clearStoredFiles()
      setCleared(true)
    } catch (err) {
      console.error('Could not clear stored files', err)
      toast.error(s.clearFailed, { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const persist = async () => {
    const granted = await requestPersistence()
    setDenied(!granted)
    refresh()
  }

  return (
    <>
      <SettingRow
        label={s.autosave}
        htmlFor={autosaveId}
        hint={s.autosaveHint}
        control={
          <Switch
            id={autosaveId}
            checked={autosave}
            onCheckedChange={(on) => setPrefs({ autosave: on })}
          />
        }
      />
      <SettingRow
        label={s.stored}
        testId="settings-stored"
        hint={
          <>
            {s.storedHint}
            {cleared ? (
              <StatusNote>{s.cleared}</StatusNote>
            ) : (
              info?.usage != null && (
                <span className="mt-0.5 block tabular-nums">
                  {s.usage(formatStorageSize(info.usage, language, t.common.byteUnits))}
                </span>
              )
            )}
          </>
        }
        control={
          <ConfirmButton
            label={s.clear}
            title={s.clearTitle}
            description={s.clearDescription}
            confirmLabel={s.clearConfirm}
            disabled={busy}
            onConfirm={() => void clear()}
            testId="settings-clear"
          />
        }
      />
      {info?.canPersist && (
        <SettingRow
          label={s.persist}
          hint={denied && !info.persisted ? s.persistDenied : s.persistHint}
          testId="settings-persist"
          control={
            info.persisted ? (
              <span className="flex h-6 items-center gap-1 text-xs text-fg-muted">
                <Check size={14} className="text-success" aria-hidden />
                {s.persisted}
              </span>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void persist()}>
                {s.persistAction}
              </Button>
            )
          }
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Dialog                                   */
/* -------------------------------------------------------------------------- */

export function SettingsDialog({ close }: DialogComponentProps) {
  const t = useT()
  useReturnFocus()
  const s = t.workspace.settings
  const renderer = usePrefs((p) => p.renderer)
  const background = usePrefs((p) => p.canvasBackground)
  const showBounds = usePrefs((p) => p.showBounds)
  const runExpressions = usePrefs((p) => p.runExpressions)
  const boundsId = useId()
  const expressionsId = useId()

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      size="md"
      title={s.title}
      description={s.description}
      footerStart={
        <ConfirmButton
          label={s.resetAction}
          title={s.resetTitle}
          description={s.resetDescription}
          confirmLabel={s.resetConfirm}
          onConfirm={resetPreferences}
          variant="ghost"
          size="md"
          align="start"
          testId="settings-reset"
        />
      }
      footer={
        <Button variant="secondary" autoFocus onClick={close} data-testid="settings-done">
          {t.common.done}
        </Button>
      }
      bodyClassName="px-0 pb-1"
    >
      <div data-testid="settings-dialog">
        <SettingsSection title={s.appearance}>
          <SettingRow label={s.theme} control={<ThemeControl />} />
          <SettingRow label={s.language} control={<LanguageControl />} />
        </SettingsSection>

        <SettingsSection title={s.preview}>
          <SettingRow
            label={s.renderer}
            hint={s.rendererHint}
            control={
              <SegmentedControl<RendererType>
                value={renderer}
                onValueChange={(value) => setPrefs({ renderer: value })}
                aria-label={s.renderer}
                options={[
                  { value: 'svg', label: s.rendererSvg },
                  { value: 'canvas', label: s.rendererCanvas },
                ]}
              />
            }
          />
          <SettingRow label={s.background} control={<BackgroundControl />} />
          {background === 'custom' && (
            <SettingRow label={s.backgroundColor} control={<CustomColorControl />} />
          )}
          <SettingRow
            label={s.bounds}
            htmlFor={boundsId}
            hint={s.boundsHint}
            control={
              <Switch
                id={boundsId}
                checked={showBounds}
                onCheckedChange={(on) => setPrefs({ showBounds: on })}
              />
            }
          />
          <SettingRow
            label={s.expressions}
            htmlFor={expressionsId}
            hint={
              <span className="flex items-start gap-1.5">
                <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <span>{s.expressionsWarning}</span>
              </span>
            }
            control={
              <Switch
                id={expressionsId}
                checked={runExpressions}
                onCheckedChange={(on) => setPrefs({ runExpressions: on })}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title={s.storage}>
          <StorageRows />
        </SettingsSection>
      </div>
    </Dialog>
  )
}
