/**
 * The "Open from URL" download as a small external store, so it can be started from the dialog
 * or from a pasted link, and the dialog only renders its progress.
 */
import { create } from 'zustand'
import { currentRoute } from '@/app/router'
import { dispatchFiles } from '@/commands/files'
import { getT } from '@/i18n'
import { closeDialog, openDialog, useUi } from '@/store/ui'
import { DIALOG, type OpenUrlProps } from './dialog-ids'
import { fetchFile, normalizeUrl } from './fetchUrl'
import { describeOpenError, type Message } from './messages'
import { presentResult, readForOpen } from './open'

export type UrlDownloadState =
  | { kind: 'idle' }
  | {
      kind: 'loading'
      phase: 'connecting' | 'downloading' | 'reading'
      loaded: number
      total: number | null
    }
  | { kind: 'error'; message: Message }

export const useUrlDownload = create<{ state: UrlDownloadState }>()(() => ({
  state: { kind: 'idle' },
}))

const set = (state: UrlDownloadState) => useUrlDownload.setState({ state })

let controller: AbortController | null = null

/** Forgets any previous result (called when the dialog opens). */
export function resetUrlDownload(): void {
  controller?.abort()
  controller = null
  set({ kind: 'idle' })
}

/** Stops the current download (the dialog was closed). */
export function cancelUrlDownload(): void {
  resetUrlDownload()
}

/** Downloads `input`, then opens it (closing the dialog). Errors stay in the dialog. */
export function startUrlDownload(input: string): void {
  const t = getT()
  const target = normalizeUrl(input)
  if (!target) {
    set({ kind: 'error', message: { title: t.io.openUrl.invalid, lines: [] } })
    return
  }
  controller?.abort()
  const current = new AbortController()
  controller = current
  set({ kind: 'loading', phase: 'connecting', loaded: 0, total: null })
  const finish = () => {
    set({ kind: 'idle' })
    controller = null
    if (useUi.getState().dialog?.id === DIALOG.openUrl) closeDialog()
  }
  void (async () => {
    try {
      const file = await fetchFile(target.url, {
        signal: current.signal,
        onProgress: ({ loaded, total }) => {
          if (!current.signal.aborted) set({ kind: 'loading', phase: 'downloading', loaded, total })
        },
      })
      if (current.signal.aborted) return
      // The optimizer page takes files (its file handler turns them into jobs): hand it this one.
      if (currentRoute() === 'optimize') {
        finish()
        await dispatchFiles([file])
        return
      }
      set({ kind: 'loading', phase: 'reading', loaded: file.size, total: file.size })
      const result = await readForOpen(file)
      if (current.signal.aborted) return
      finish()
      await presentResult(result, { source: 'url' })
    } catch (err) {
      if (current.signal.aborted) return
      let name: string | null = null
      try {
        name = decodeURIComponent(new URL(target.url).pathname.split('/').pop() ?? '') || null
      } catch {
        name = null
      }
      set({ kind: 'error', message: describeOpenError(err, name, t) })
    }
  })()
}

/** Opens the "Open from URL" dialog, optionally prefilled and already downloading (a pasted link). */
export function showOpenUrl(url?: string, start = false): void {
  resetUrlDownload()
  openDialog(DIALOG.openUrl, { url } satisfies OpenUrlProps)
  if (url && start) startUrlDownload(url)
}
