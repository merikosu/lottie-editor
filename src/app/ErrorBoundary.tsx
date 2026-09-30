import { TriangleAlert } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { getT } from '@/i18n'
import { useDocument } from '@/store/document'
import { isChunkLoadError } from './chunk-error'

interface Props {
  /** Name used in logs. */
  name: string
  children: ReactNode
  /** Render something smaller than the default panel fallback. */
  compact?: boolean
}

interface State {
  error: Error | null
}

/** Contains rendering errors to one panel so the rest of the editor keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  /** Stops watching the document (set while the fallback shows). */
  private unsubscribe: (() => void) | null = null

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] crashed`, error, info.componentStack)
    // A panel that failed on one state usually renders the next one (another layer selected, the
    // edit undone): try again on the next change instead of waiting for "Try again".
    this.unsubscribe?.()
    this.unsubscribe = useDocument.subscribe((s, prev) => {
      if (s.doc !== prev.doc || s.selection !== prev.selection) this.reset()
    })
  }

  override componentWillUnmount() {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private reset = () => {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.setState({ error: null })
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    const t = getT()
    if (isChunkLoadError(error)) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <TriangleAlert size={20} className="text-warning" />
          <div className="text-sm font-medium text-fg">{t.app.errorBoundary.loadFailedTitle}</div>
          <div className="max-w-72 text-xs text-fg-muted">
            {t.app.errorBoundary.loadFailedDescription}
          </div>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-2 h-7 rounded-md bg-surface-2 px-3 text-sm font-medium text-fg shadow-[inset_0_0_0_1px_var(--le-line-strong)] hover:bg-surface-3"
          >
            {t.app.errorBoundary.reload}
          </button>
        </div>
      )
    }
    if (this.props.compact) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-danger">
          <TriangleAlert size={14} />
          <span className="truncate">{t.common.panelCrashed}</span>
          <button type="button" className="ml-auto underline" onClick={this.reset}>
            {t.common.retry}
          </button>
        </div>
      )
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <TriangleAlert size={20} className="text-danger" />
        <div className="text-sm font-medium text-fg">{t.app.errorBoundary.title}</div>
        <div className="max-w-64 text-xs text-fg-muted">{t.app.errorBoundary.description}</div>
        <details className="mt-1 max-w-80 text-left text-xs text-fg-subtle">
          <summary className="cursor-default">{t.app.errorBoundary.details}</summary>
          <pre className="selectable mt-1 max-h-40 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-2xs whitespace-pre-wrap">
            {error.message}
          </pre>
        </details>
        <button
          type="button"
          onClick={this.reset}
          className="mt-2 h-7 rounded-md bg-surface-2 px-3 text-sm font-medium text-fg shadow-[inset_0_0_0_1px_var(--le-line-strong)] hover:bg-surface-3"
        >
          {t.common.retry}
        </button>
      </div>
    )
  }
}
