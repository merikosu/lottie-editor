/**
 * React contexts of the timeline: the controller (stable) and the metrics (change on zoom and
 * resize, re-rendering the rows that depend on pixel positions).
 */
import { createContext, useContext } from 'react'
import { useDocument } from '@/store/document'
import type { Metrics, TimelineController } from './controller'
import { indexSelection, type SelectionIndex } from './selection'

export const ControllerContext = createContext<TimelineController | null>(null)

export function useController(): TimelineController {
  const ctl = useContext(ControllerContext)
  if (!ctl) throw new Error('useController outside <Timeline>')
  return ctl
}

export const MetricsContext = createContext<Metrics>({
  ip: 0,
  op: 1,
  fps: 30,
  ppf: 4,
  namesWidth: 248,
  viewWidth: 0,
  contentWidth: 0,
  units: 'frames',
  scrollbar: 0,
})

export function useMetrics(): Metrics {
  return useContext(MetricsContext)
}

/** Selection lookup (cached per selection object). */
export function useSelectionIndex(): SelectionIndex {
  return indexSelection(useDocument((s) => s.selection))
}
