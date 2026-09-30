import { lazy, Suspense, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui'
import { useT } from '@/i18n'
import { usePrefs } from '@/store/prefs'
import { CodeToolbar } from './CodeToolbar'

// CodeMirror and its language support live in their own chunk (~300 KB) loaded on first use.
const JsonEditor = lazy(() => import('./editor/JsonEditor'))

/** Shows a spinner only if loading takes long enough to notice (no flash on fast loads). */
function LoadingEditor() {
  const t = useT()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 300)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-fg-subtle"
      aria-busy
    >
      {visible && (
        <>
          <Spinner />
          {t.code.loading}
        </>
      )}
    </div>
  )
}

/** The center "JSON" view: a CodeMirror editor over the document's JSON. */
export function CodeView() {
  const split = usePrefs((s) => s.centerView === 'split')
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-1" data-testid="code-view">
      {/* In split view the app header shows the canvas toolbar, so the editor brings its own. */}
      {split && (
        <div className="flex h-8 shrink-0 items-center border-b border-line pr-1.5 pl-2">
          <CodeToolbar className="flex-1" />
        </div>
      )}
      <Suspense fallback={<LoadingEditor />}>
        <JsonEditor />
      </Suspense>
    </div>
  )
}
