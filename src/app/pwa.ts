/**
 * Offline use and installation as an app (production builds only).
 *
 * - The service worker (`src/pwa/service-worker.js`, written to `sw.js` by the build) keeps the
 *   app's files, so it opens and works without a connection after the first visit.
 * - A new version installs in the background; the user decides when to reload into it.
 * - The browser's install prompt is offered as a command while it is available.
 * - Installed, the app opens Lottie files from the operating system (`file_handlers` in the web
 *   app manifest): they arrive through the launch queue and open like dropped files.
 */
import { MonitorDown } from 'lucide-react'
import { dispatchFiles } from '@/commands/files'
import { registerCommands } from '@/commands/registry'
import { toast } from '@/components/ui'
import { getT } from '@/i18n'

const HOUR = 60 * 60 * 1000

/** Registers the service worker once the page has loaded. Returns the cleanup. */
export function installServiceWorker(): () => void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return noop
  let timer = 0
  const register = () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registration) => {
        watchForUpdates(registration)
        // Long sessions: check for a new version now and then.
        timer = window.setInterval(() => void registration.update().catch(noop), HOUR)
      })
      .catch((err: unknown) => console.warn('Offline support is unavailable', err))
  }
  // The worker downloads the whole app once; it must not compete with the first load.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
  return () => {
    window.removeEventListener('load', register)
    window.clearInterval(timer)
  }
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  // Installed during an earlier visit and still waiting for this page to let it take over.
  if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    worker?.addEventListener('statechange', () => {
      // Without a controller this is the first install: there is nothing to update from.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker)
    })
  })
}

let reloading = false

function offerUpdate(worker: ServiceWorker): void {
  const t = getT().app.update
  toast(t.ready, {
    id: 'app-update',
    description: t.description,
    duration: Infinity,
    cancel: { label: t.later, onClick: noop },
    action: {
      label: t.reload,
      onClick: () => {
        // Reload only once the new worker is in control, so the page loads the new version.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloading) return
          reloading = true
          window.location.reload()
        })
        // A worker's postMessage has no target origin (the rule is about window.postMessage).
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        worker.postMessage({ type: 'skip-waiting' })
      },
    },
  })
}

/* -------------------------------------------------------------------------- */
/*                                 Installation                               */
/* -------------------------------------------------------------------------- */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let installPrompt: BeforeInstallPromptEvent | null = null
let onInstallPromptChange: (() => void) | null = null

// Listen from the start: on repeat visits the browser offers installation before the app renders.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the prompt for the command instead of the browser's own banner.
    event.preventDefault()
    installPrompt = event as BeforeInstallPromptEvent
    onInstallPromptChange?.()
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    onInstallPromptChange?.()
  })
}

/**
 * Offers "Install as app" while the browser allows installing. The command only exists then,
 * so menus and the command palette never show an action that cannot work.
 */
export function installAppInstallCommand(): () => void {
  let unregister: (() => void) | null = null
  const sync = () => {
    unregister?.()
    unregister = null
    const prompt = installPrompt
    if (!prompt) return
    unregister = registerCommands([
      {
        id: 'app.install',
        title: (t) => t.commands.installApp,
        category: 'help',
        icon: MonitorDown,
        keywords: ['install', 'pwa', 'offline', 'app', 'установить', 'приложение', 'офлайн'],
        run: async () => {
          // A prompt can be shown once; the browser fires a new event if it may be shown again.
          installPrompt = null
          sync()
          await prompt.prompt().catch(noop)
        },
      },
    ])
  }
  onInstallPromptChange = sync
  sync()
  return () => {
    onInstallPromptChange = null
    unregister?.()
  }
}

/* -------------------------------------------------------------------------- */
/*                              Files from the system                         */
/* -------------------------------------------------------------------------- */

interface LaunchParams {
  readonly files: readonly FileSystemHandle[]
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void
}

/** Opens the files the installed app was launched with ("Open with Lottie Editor"). */
export function installLaunchQueue(): void {
  const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue
  queue?.setConsumer((params) => {
    const handles = params.files.filter(
      (handle): handle is FileSystemFileHandle => handle.kind === 'file',
    )
    if (handles.length === 0) return
    void Promise.all(handles.map((handle) => handle.getFile()))
      .then((files) => dispatchFiles(files))
      .catch((err: unknown) => {
        console.error('Could not open the launched files', err)
        toast.error(getT().common.somethingWentWrong)
      })
  })
}

function noop(): void {}
