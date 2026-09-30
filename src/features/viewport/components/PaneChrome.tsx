/**
 * Small UI floating over a viewport pane: compare labels, the preview error banner, the
 * "expressions are disabled" notice and the delayed loading indicator.
 */
import { ShieldAlert, SquareFunction, TriangleAlert, X } from 'lucide-react'
import { useMemo } from 'react'
import { layout } from '@/app/layout'
import { getCommand, runCommand } from '@/commands/registry'
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Switch,
  Tooltip,
} from '@/components/ui'
import { ThemePreviewBadge } from '@/features/themes'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { setPrefs, usePrefs } from '@/store/prefs'
import { documentHasExpressions } from '../lib/expressions'
import { dismissExpressionsNotice, useViewport } from '../store'

/** Shared look of the chips floating over the canvas (11px, translucent panel, hairline). */
export const chipClass =
  'inline-flex h-6 items-center gap-1.5 rounded-md bg-surface-1/80 px-2 text-xs text-fg-muted tabular-nums shadow-[inset_0_0_0_1px_var(--le-line)]'

/** "Original" / "Edited" label of each half in compare mode. */
export function CompareLabel({ kind }: { kind: 'original' | 'edited' }) {
  const t = useT()
  const unchanged = useDocument((s) => s.doc === s.original)
  return (
    <div
      className={cn(chipClass, 'shrink-0 text-fg')}
      data-testid={`compare-label-${kind}`}
      data-pane-chrome=""
    >
      <span className="font-medium">
        {kind === 'original' ? t.viewport.original : t.viewport.edited}
      </span>
      {kind === 'edited' && unchanged && (
        <span className="text-fg-subtle">· {t.viewport.noChanges}</span>
      )}
    </div>
  )
}

function showIssues() {
  if (getCommand('anim.issues')) {
    runCommand('anim.issues')
    return
  }
  setPrefs({ rightTab: 'issues' })
  if (layout().isRightCollapsed()) layout().toggleRight()
}

/** Compact banner when the preview fails; the canvas keeps the last good frame. */
export function PreviewErrorBanner({ onRetry }: { onRetry: () => void }) {
  const t = useT()
  const error = useViewport((s) => s.error)
  if (!error) return null
  const tooltip = (
    <span className="block break-words">
      {error.message}
      {error.detail && <span className="mt-0.5 block font-mono text-fg-muted">{error.detail}</span>}
    </span>
  )
  return (
    <div
      role="alert"
      key={error.id}
      data-testid="preview-error"
      data-pane-chrome=""
      className="pointer-events-auto flex max-w-[640px] min-w-0 animate-pop-in flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-surface-3 py-1 pr-1 pl-2.5 text-sm shadow-popover"
    >
      <div className="flex h-6 min-w-0 flex-[1_1_160px] items-center gap-2">
        <TriangleAlert size={14} className="shrink-0 text-danger" />
        <Tooltip content={tooltip}>
          <span className="min-w-0 truncate">
            <span className="font-medium text-fg">{t.viewport.previewFailed}:</span>{' '}
            <span className="text-fg-muted">{error.message}</span>
          </span>
        </Tooltip>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={showIssues}>
          {t.viewport.showIssues}
        </Button>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t.viewport.tryAgain}
        </Button>
      </div>
    </div>
  )
}

/**
 * The document contains expressions. They run code from the file, so they are opt-in: the chip
 * says whether they are evaluated and its popover explains the risk and switches them. It stays
 * visible in both states (the way back) and can be dismissed per document.
 */
export function ExpressionsNotice() {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const docId = useDocument((s) => s.meta?.id ?? null)
  const running = usePrefs((s) => s.runExpressions)
  const dismissed = useViewport((s) => s.expressionsNoticeDismissed)
  // Cached per layer object: after an edit only the changed layers are re-scanned.
  const hasExpressions = useMemo(() => documentHasExpressions(doc), [doc])
  if (!hasExpressions || !docId || dismissed === docId) return null
  // Split chip: the label opens the popover, × dismisses. Focus rings stay inside each part.
  const part = 'flex h-full items-center transition-colors focus-visible:outline-offset-[-2px]'
  return (
    <Popover>
      <PopoverAnchor asChild>
        <div
          className={cn(chipClass, 'pointer-events-auto shrink-0 gap-0 p-0')}
          data-testid="expressions-notice"
          data-state={running ? 'on' : 'off'}
          data-pane-chrome=""
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                part,
                'gap-1.5 rounded-l-md pr-1.5 pl-2 text-fg-muted hover:text-fg data-[state=open]:text-fg',
              )}
            >
              <SquareFunction size={14} className={running ? 'text-fg-subtle' : 'text-warning'} />
              {running ? t.viewport.expressionsOn : t.viewport.expressionsOff}
            </button>
          </PopoverTrigger>
          <Tooltip content={t.viewport.dismiss}>
            <button
              type="button"
              aria-label={t.viewport.dismiss}
              onClick={() => dismissExpressionsNotice(docId)}
              className={cn(part, 'w-6 justify-center rounded-r-md text-fg-subtle hover:text-fg')}
            >
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      </PopoverAnchor>
      <PopoverContent side="bottom" align="end" className="w-72 p-0">
        <div className="flex gap-2.5 p-3">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-fg">{t.viewport.expressionsTitle}</div>
            <p className="mt-1 text-xs text-fg-muted">{t.viewport.expressionsBody}</p>
          </div>
        </div>
        <label className="flex h-10 cursor-default items-center justify-between gap-3 border-t border-line px-3 text-sm text-fg">
          {t.viewport.expressionsEnable}
          <Switch
            checked={running}
            onCheckedChange={(runExpressions) => setPrefs({ runExpressions })}
            aria-label={t.viewport.expressionsEnable}
          />
        </label>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Top edge of a pane: compare label (left), error banner (center) and expressions notice
 * (right) in one wrapping row, so narrow panes stack them instead of overlapping.
 */
export function PaneTopBar({
  kind,
  compare,
  onRetry,
}: {
  kind: 'original' | 'edited'
  compare: boolean
  onRetry: () => void
}) {
  const edited = kind === 'edited'
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-wrap items-start gap-2">
      {compare && <CompareLabel kind={kind} />}
      {/* A themed canvas must never pass for the document's own colors. */}
      {edited && (
        <div className="flex shrink-0 empty:hidden" data-pane-chrome="">
          <ThemePreviewBadge />
        </div>
      )}
      {edited && (
        <div className="flex min-w-0 flex-[1_1_320px] justify-center empty:hidden">
          <PreviewErrorBanner onRetry={onRetry} />
        </div>
      )}
      {edited && (
        <div className="ml-auto flex shrink-0 empty:hidden">
          <ExpressionsNotice />
        </div>
      )}
    </div>
  )
}

/** Spinner for slow first loads; fades in after 300 ms so fast loads never flash it. */
export function LoadingIndicator() {
  const t = useT()
  // A failed first load is over too: the error banner explains it.
  const done = useViewport((s) => s.ready || s.error !== null)
  if (done) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div
        className={cn(chipClass, '[animation:le-fade-in_150ms_ease-out_300ms_forwards] opacity-0')}
      >
        <Spinner size={12} />
        {t.viewport.loading}
      </div>
    </div>
  )
}
