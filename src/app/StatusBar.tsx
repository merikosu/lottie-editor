import type { ReactNode } from 'react'
import { runCommand, useCommand } from '@/commands/registry'
import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { formatSeconds } from '@/lib/format'
import { durationSeconds, frameCount } from '@/lottie/time'
import { useDocument } from '@/store/document'
import { IssuesIndicator, SizeIndicator } from '@/features/insights'
import { ErrorBoundary } from './ErrorBoundary'
import { useRoute } from './router'

function Sep() {
  return <span className="h-3 w-px bg-line-strong" aria-hidden />
}

/**
 * A fact about the document that opens the dialog to change it (like the size and issues on
 * the right); plain text when that command is not registered.
 */
function StatusItem({ command, children }: { command: string; children: ReactNode }) {
  const t = useT()
  const cmd = useCommand(command)
  if (!cmd) return <span>{children}</span>
  return (
    <Tooltip content={cmd.title(t)} side="top" align="start">
      <button
        type="button"
        onClick={() => runCommand(command)}
        className="-mx-1.5 flex h-5 items-center rounded-sm px-1.5 text-fg-subtle tabular-nums transition-colors hover:bg-hover hover:text-fg-muted"
      >
        {children}
      </button>
    </Tooltip>
  )
}

/** 24px status bar: document summary, size and issues. */
export function StatusBar() {
  const t = useT()
  const doc = useDocument((s) => s.doc)
  const route = useRoute()
  if (!doc || route !== 'edit') return null
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-3 text-xs text-fg-subtle tabular-nums">
      <StatusItem command="anim.resize">
        {doc.w} × {doc.h}
      </StatusItem>
      <Sep />
      <StatusItem command="anim.timing">
        {doc.fr} {t.common.fps}
      </StatusItem>
      <Sep />
      <StatusItem command="anim.timing">
        {frameCount(doc)} {t.common.framesShort} · {formatSeconds(durationSeconds(doc))}
      </StatusItem>
      <div className="flex-1" />
      <ErrorBoundary name="status-size" compact>
        <SizeIndicator />
      </ErrorBoundary>
      <ErrorBoundary name="status-issues" compact>
        <IssuesIndicator />
      </ErrorBoundary>
    </footer>
  )
}
