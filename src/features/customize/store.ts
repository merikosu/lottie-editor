/**
 * State of the Customize service:
 *  - preferences kept per browser: the brand colors (they belong to the user, not to a file)
 *    and the last options of the Replace dialog;
 *  - transient UI state: the expanded palette and the replacement in progress.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FitMode } from '@/lottie/replace'
import type { StyleChoice } from './replace/compute'

export interface CustomizePrefs {
  /** Brand colors (#rrggbb), in order of importance; at most three. */
  brand: string[]
  /** Options the Replace dialog starts with. */
  fit: FitMode
  style: StyleChoice
  /** Color of the "one color" style. */
  color: string
}

export const useCustomizePrefs = create<CustomizePrefs>()(
  persist(
    (): CustomizePrefs => ({
      brand: [],
      fit: 'contain',
      style: 'keep',
      color: '#ffffff',
    }),
    { name: 'lottie-editor:customize', version: 1 },
  ),
)

export function setCustomizePrefs(patch: Partial<CustomizePrefs>): void {
  useCustomizePrefs.setState(patch)
}

interface CustomizeUi {
  /** The palette shows every color (otherwise the most used ones). */
  allColors: boolean
  /** A Replace dialog is open (thumbnails and suggestions wait until it closes). */
  replacing: boolean
}

export const useCustomizeUi = create<CustomizeUi>()(() => ({
  allColors: false,
  replacing: false,
}))
