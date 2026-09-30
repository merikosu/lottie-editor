import { useEffect } from 'react'
import { installKeyboardShortcuts } from '@/commands/keyboard'
import { installPasteHandler } from '@/commands/paste'
import { Toaster, TooltipProvider, toast } from '@/components/ui'
import { FileDropOverlay } from '@/features/io'
import { CommandPalette } from '@/features/workspace'
import { getT } from '@/i18n'
import { AppShell } from './AppShell'
import { registerCoreCommands } from './coreCommands'
import { DialogHost } from './DialogHost'
import { ErrorBoundary } from './ErrorBoundary'
import { registerFeatures } from './features'
import { installAppInstallCommand, installLaunchQueue, installServiceWorker } from './pwa'
import { useRouterSync } from './router'
import { LinkHttpError, loadStartupDocument, startupLinkFailure } from './startup'
import { useThemeEffect } from './theme'
import { useTabTitle } from './title'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'

/** Says why the file of a `?url=` link did not open (the start page shows instead). */
function notifyLinkFailure(): void {
  const failure = startupLinkFailure()
  if (!failure) return
  const t = getT().app.openLink
  const { url, error } = failure
  // fetch() rejects with a TypeError when the server is unreachable or refuses other sites.
  const reason =
    error instanceof LinkHttpError
      ? t.http(error.status)
      : error instanceof TypeError
        ? t.network
        : t.invalid
  toast.error(t.failed, { id: 'startup-link', description: `${reason} ${url}`, duration: 12_000 })
}

export function App() {
  useThemeEffect()
  useRouterSync()
  useTabTitle()

  useEffect(() => {
    const disposers = [
      registerCoreCommands(),
      registerFeatures(),
      installKeyboardShortcuts(),
      installPasteHandler(),
      installServiceWorker(),
      installAppInstallCommand(),
    ]
    // After the file handlers are registered: files the installed app was opened with.
    installLaunchQueue()
    return () => disposers.forEach((d) => d())
  }, [])

  useEffect(() => {
    void loadStartupDocument().then(notifyLinkFailure)
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-surface-0 text-fg">
        <TopBar />
        <AppShell />
        <StatusBar />
      </div>
      <DialogHost />
      <ErrorBoundary name="command-palette" compact>
        <CommandPalette />
      </ErrorBoundary>
      <FileDropOverlay />
      <Toaster />
    </TooltipProvider>
  )
}
