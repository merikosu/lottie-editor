/**
 * Commands recently run from the palette (persisted), newest first. Shown on top when the
 * palette opens and slightly preferred when searching.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** More ids than shown are kept, so unavailable ones can be skipped without leaving gaps. */
export const RECENT_STORED = 12

interface RecentState {
  ids: string[]
}

export const usePaletteRecent = create<RecentState>()(
  persist((): RecentState => ({ ids: [] }), {
    name: 'lottie-editor:palette',
    version: 1,
    merge: (persisted, current) => {
      const ids = (persisted as Partial<RecentState> | undefined)?.ids
      return {
        ...current,
        ids: Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [],
      }
    },
  }),
)

/** Moves `id` to the front of the list. */
export function pushRecent(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_STORED)
}

export function recordCommandUse(id: string): void {
  usePaletteRecent.setState((s) => ({ ids: pushRecent(s.ids, id) }))
}
