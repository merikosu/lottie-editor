/**
 * Transient state of the io feature: autosave status, the recent files list, the startup
 * restore and files being opened. Not persisted (IndexedDB holds the real data).
 */
import { create } from 'zustand'
import type { RecentEntry } from './storage'

export type SaveState =
  /** Nothing to report (no document, or nothing written yet). */
  | { kind: 'idle' }
  /** Changes are waiting for the autosave debounce. */
  | { kind: 'pending' }
  /** Writing to IndexedDB. */
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; reason: 'quota' | 'unavailable' }

/**
 * What dropping the files dragged over the window would do:
 *  - `open`: open them (Lottie files, folders, or types the browser does not reveal yet)
 *  - `images`: add the images to the open animation
 *  - `images-no-doc`: nothing (images, but no animation to add them to)
 *  - `optimize`: add them to the optimizer queue (on the optimizer page)
 *  - `optimize-images`: nothing (images on the optimizer page)
 */
export type DropKind =
  'open' | 'images' | 'images-no-doc' | 'customize-images' | 'optimize' | 'optimize-images'

export interface IoState {
  save: SaveState
  /** Recent files, newest first; null until loaded from IndexedDB. */
  recents: RecentEntry[] | null
  /** 'pending' while the last session is being restored on startup (the welcome screen waits). */
  startup: 'pending' | 'done'
  /** File currently being read (shown on the welcome screen). */
  opening: string | null
  /** Files are being dragged over the window (the home page turns its cards into drop zones). */
  drag: DropKind | null
}

export const useIo = create<IoState>()(() => ({
  save: { kind: 'idle' },
  recents: null,
  startup: 'pending',
  opening: null,
  drag: null,
}))

/** Autosave status shown in the top bar. */
export function setSaveState(save: SaveState): void {
  useIo.setState({ save })
}

/** Replaces the recent files list (after every storage change). */
export function setRecents(recents: RecentEntry[]): void {
  useIo.setState({ recents })
}

/** Name of the file being read, or null. */
export function setOpening(opening: string | null): void {
  useIo.setState({ opening })
}

/** The startup restore is over: the welcome screen may show. */
export function finishStartup(): void {
  useIo.setState({ startup: 'done' })
}
