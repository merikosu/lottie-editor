/**
 * Development-only handle for driving the app from the console, e2e tests and screenshot
 * scripts: `window.__le.selectNodes([['layers', 0]])`, `__le.setFrame(30)`, …
 * Not included in production builds.
 */
import { getCommand, runCommand, useCommandRegistry } from '@/commands/registry'
import * as documentStore from '@/store/document'
import * as playbackStore from '@/store/playback'
import * as prefsStore from '@/store/prefs'
import * as uiStore from '@/store/ui'
import { emit } from '@/lib/events'

export function installDevtools(): void {
  const api = {
    ...documentStore,
    ...playbackStore,
    ...prefsStore,
    ...uiStore,
    emit,
    getCommand,
    runCommand,
    commands: () => [...useCommandRegistry.getState().commands.keys()],
    doc: () => documentStore.useDocument.getState().doc,
  }
  // oxlint-disable-next-line no-underscore-dangle -- deliberate dev-only global
  ;(window as unknown as { __le: typeof api }).__le = api
}
