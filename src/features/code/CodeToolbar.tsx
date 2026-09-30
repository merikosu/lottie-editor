import { Braces, CircleAlert, LocateFixed, Search } from 'lucide-react'
import { Button, IconButton, Tooltip } from '@/components/ui'
import { useLanguage, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import {
  canApply,
  canFormat,
  getCodeController,
  toggleFollowSelection,
  useCodePrefs,
  useCodeStatus,
} from './store'

function Divider() {
  return <div className="mx-1 h-4 w-px shrink-0 bg-line-strong" aria-hidden />
}

/** Pending-edit state: "Not applied", or the first error (click to jump to it). */
function EditState() {
  const t = useT()
  const dirty = useCodeStatus((s) => s.dirty)
  const error = useCodeStatus((s) => s.error)
  if (!dirty) return null
  if (error) {
    const message =
      error.kind === 'json'
        ? t.code.jsonErrors[error.code](error.found)
        : t.code.shapeErrors[error.code]
    return (
      <Tooltip content={`${message} — ${t.code.errorJump}`}>
        <button
          type="button"
          data-testid="code-error"
          onClick={() => getCodeController()?.jumpTo(error.pos)}
          className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-danger transition-colors hover:bg-danger-subtle"
        >
          <CircleAlert size={14} className="shrink-0" />
          <span className="shrink-0 font-medium tabular-nums">
            {t.code.errorAt(error.line, error.col)}
          </span>
          <span className="min-w-0 truncate text-danger/85">{message}</span>
        </button>
      </Tooltip>
    )
  }
  return (
    <Tooltip content={t.code.notAppliedHint}>
      <span
        data-testid="code-dirty"
        className="flex h-6 shrink-0 items-center gap-1.5 px-1 text-xs text-fg-muted"
      >
        <span className="size-1.5 rounded-full bg-fg-muted" aria-hidden />
        {t.code.notApplied}
      </span>
    </Tooltip>
  )
}

function Stats() {
  const t = useT()
  const language = useLanguage()
  const lines = useCodeStatus((s) => s.lines)
  const bytes = useCodeStatus((s) => s.bytes)
  if (!lines) return null
  const count = t.code.lines(lines).replace(/^\d+/, lines.toLocaleString(language))
  return (
    <span className="shrink-0 truncate px-1 text-xs whitespace-nowrap text-fg-subtle tabular-nums">
      {count} · {formatBytes(bytes)}
    </span>
  )
}

/**
 * Actions of the JSON view (shown in the center header, or above the editor in split view):
 * edit state, Revert / Apply, size, Format, Follow selection and Find.
 */
export function CodeToolbar({ className }: { className?: string }) {
  const t = useT()
  const ready = useCodeStatus((s) => s.ready)
  const dirty = useCodeStatus((s) => s.dirty)
  const applicable = useCodeStatus(canApply)
  const formattable = useCodeStatus(canFormat)
  const follow = useCodePrefs((s) => s.followSelection)
  const hasError = useCodeStatus((s) => s.error !== null)

  return (
    <div
      className={cn('flex min-w-0 items-center justify-end gap-0.5', className)}
      data-testid="code-toolbar"
    >
      <div className="flex min-w-0 items-center gap-1">
        <EditState />
        {dirty && (
          <>
            <Tooltip content={t.code.revertHint}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => getCodeController()?.revert()}
                data-testid="code-revert"
              >
                {t.code.revert}
              </Button>
            </Tooltip>
            <Tooltip
              content={applicable ? t.code.applyHint : t.code.applyBlocked}
              shortcut={applicable ? 'mod+enter' : undefined}
            >
              {/* The span keeps the tooltip working while the button is disabled. */}
              <span className="inline-flex">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!applicable}
                  onClick={() => getCodeController()?.apply()}
                  data-testid="code-apply"
                >
                  {t.code.apply}
                </Button>
              </span>
            </Tooltip>
          </>
        )}
      </div>
      {dirty && <Divider />}
      <Stats />
      <IconButton
        icon={Braces}
        label={
          formattable ? t.code.formatHint : hasError ? t.code.formatBlocked : t.code.formatHint
        }
        shortcut="shift+alt+f"
        disabled={!formattable}
        onClick={() => getCodeController()?.format()}
      />
      <IconButton
        icon={LocateFixed}
        label={follow ? t.code.followSelectionOn : t.code.followSelectionOff}
        active={follow}
        onClick={toggleFollowSelection}
        data-testid="code-follow"
      />
      <IconButton
        icon={Search}
        label={t.code.find}
        shortcut="mod+f"
        disabled={!ready}
        onClick={() => getCodeController()?.openSearch()}
      />
    </div>
  )
}
