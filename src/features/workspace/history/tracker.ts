/**
 * Watches the document history from startup so the History panel knows whether its first row
 * is still the opened file (see `trackBase`). It must observe every change, including those
 * made while the panel is not mounted.
 */
import { create } from 'zustand'
import { useDocument } from '@/store/document'
import { INITIAL_TRACKER, trackBase, type BaseTracker } from './model'

export const useHistoryBase = create<BaseTracker>()(() => INITIAL_TRACKER)

function docKeyOf(meta: { id: string; loadedAt: number } | null): string | null {
  return meta ? `${meta.id}:${meta.loadedAt}` : null
}

function update(): void {
  const s = useDocument.getState()
  const next = trackBase(useHistoryBase.getState(), docKeyOf(s.meta), s.past)
  if (next !== useHistoryBase.getState()) useHistoryBase.setState(next, true)
}

export function installHistoryTracker(): () => void {
  update()
  return useDocument.subscribe((s) => [s.meta, s.past] as const, update, {
    equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1],
  })
}
