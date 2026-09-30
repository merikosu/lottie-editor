import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { useDocument } from '@/store/document'
import { WelcomeScreen } from '@/features/io'
import { ErrorBoundary } from './ErrorBoundary'
import { useRoute } from './router'

const loadWorkspace = () => import('./Workspace')
// The editor's panels are the bulk of the code: load them on demand (and prefetch when idle).
const Workspace = lazy(() => loadWorkspace().then((m) => ({ default: m.Workspace })))

// Service pages load on first visit, keeping the editor's initial bundle smaller.
const HomePage = lazy(() => import('@/features/home').then((m) => ({ default: m.HomePage })))
const CustomizePage = lazy(() =>
  import('@/features/customize').then((m) => ({ default: m.CustomizePage })),
)
const OptimizerPage = lazy(() =>
  import('@/features/optimizer').then((m) => ({ default: m.OptimizerPage })),
)

function Page({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-canvas" data-page={name}>
      <ErrorBoundary name={name}>
        <Suspense fallback={null}>{children}</Suspense>
      </ErrorBoundary>
    </div>
  )
}

/** Main area: the current service (home, editor, customize, optimizer). */
export function AppShell() {
  const route = useRoute()
  const hasDoc = useDocument((s) => s.doc !== null)

  // Prefetch the editor while the user looks at another page, so opening a file is instant.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    idle(() => void loadWorkspace())
  }, [])
  switch (route) {
    case 'home':
      return (
        <Page name="home">
          <HomePage />
        </Page>
      )
    case 'customize':
      return (
        <Page name="customize">
          <CustomizePage />
        </Page>
      )
    case 'optimize':
      return (
        <Page name="optimize">
          <OptimizerPage />
        </Page>
      )
    default:
      return hasDoc ? (
        // The editor loads on demand: if that fails, say so here instead of blanking the app.
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          <ErrorBoundary name="workspace">
            <Suspense fallback={<div className="min-h-0 flex-1 bg-canvas" />}>
              <Workspace />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : (
        <Page name="welcome">
          <WelcomeScreen />
        </Page>
      )
  }
}
