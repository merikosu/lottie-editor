import { CloudAlert, CloudCheck } from 'lucide-react'
import { Spinner, Tooltip } from '@/components/ui'
import { useLanguage, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { downloadCurrent } from './download'
import { formatClockTime } from './format'
import { useIo } from './store'

/** One of the two labels sharing the grid cell; the hidden one fades out. */
const labelClass = (visible: boolean) =>
  cn('transition-opacity duration-150 ease-out [grid-area:1/1]', !visible && 'opacity-0')

/**
 * Autosave state shown next to the file name in the top bar ("Saved on this device").
 * Both labels share one grid cell and cross-fade, so switching between them never moves the
 * file name.
 */
export function SaveStatus() {
  const t = useT()
  const language = useLanguage()
  const autosave = usePrefs((s) => s.autosave)
  const hasDoc = useDocument((s) => s.doc !== null)
  const save = useIo((s) => s.save)
  if (!autosave || !hasDoc) return null

  if (save.kind === 'error') {
    const label = save.reason === 'quota' ? t.io.save.notSavedQuota : t.io.save.notSavedUnavailable
    return (
      <div
        className="flex shrink-0 items-center gap-1.5 text-xs"
        role="alert"
        data-testid="save-status"
      >
        {/* Narrow windows: an icon (the file name keeps its room); the tooltip has the words. */}
        <Tooltip
          content={
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-danger xl:hidden">{label}</span>
              <span>{t.io.save.errorTooltip}</span>
            </span>
          }
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap text-danger">
            <CloudAlert size={14} className="shrink-0 xl:hidden" aria-hidden />
            <span className="sr-only xl:not-sr-only">{label}</span>
          </span>
        </Tooltip>
        <button
          type="button"
          onClick={() => downloadCurrent()}
          className="h-5 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap text-fg shadow-[inset_0_0_0_1px_var(--le-line-strong)] hover:bg-hover"
        >
          {t.io.save.downloadCopy}
        </button>
      </div>
    )
  }

  const saving = save.kind === 'pending' || save.kind === 'saving'
  const saved = save.kind === 'saved'
  const tooltip = saved
    ? t.io.save.savedTooltip(formatClockTime(save.at, language))
    : t.io.save.savingTooltip
  return (
    <Tooltip content={tooltip}>
      <output
        className="flex shrink-0 items-center text-xs whitespace-nowrap text-fg-subtle"
        data-testid="save-status"
      >
        {/* Compact (narrow windows): an icon; the tooltip carries the words. */}
        <span className="flex size-4 items-center justify-center xl:hidden" aria-hidden>
          {saving ? <Spinner size={11} /> : <CloudCheck size={14} className="text-fg-faint" />}
        </span>
        <span className="hidden xl:grid">
          <span className={labelClass(saved)} aria-hidden={!saved}>
            {t.io.save.saved}
          </span>
          <span className={labelClass(saving)} aria-hidden={!saving}>
            {t.io.save.saving}
          </span>
        </span>
      </output>
    </Tooltip>
  )
}
