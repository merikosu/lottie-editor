/**
 * Timeline-local state.
 *  - `useTimelinePrefs`: per-user preferences that survive reloads (ruler units, names column
 *    width, snapping).
 *  - `useTimelineView`: transient view state of the current document (expanded rows, zoom,
 *    drag feedback). Reset when another document is opened.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useDocument } from '@/store/document'

export type TimeUnits = 'frames' | 'seconds'

/** Graph editor: value graph (each dimension over time) or speed graph (rate of change). */
export type GraphMode = 'value' | 'speed'

export const NAMES_WIDTH = { min: 180, max: 520, initial: 248 } as const

export interface TimelinePrefs {
  units: TimeUnits
  namesWidth: number
  snapping: boolean
  /** The tracks area shows the graph editor instead of the keyframe tracks. */
  graph: boolean
  graphMode: GraphMode
  /** Each curve is scaled to the same height (compare curves of different units). */
  graphNormalize: boolean
}

export const useTimelinePrefs = create<TimelinePrefs>()(
  persist(
    (): TimelinePrefs => ({
      units: 'frames',
      namesWidth: NAMES_WIDTH.initial,
      snapping: true,
      graph: false,
      graphMode: 'value',
      graphNormalize: false,
    }),
    {
      name: 'lottie-editor:timeline',
      version: 1,
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<TimelinePrefs>) }),
    },
  ),
)

export function setTimelinePrefs(patch: Partial<TimelinePrefs>): void {
  useTimelinePrefs.setState(patch)
}

/** Floating label shown next to the pointer while dragging (viewport coordinates). */
export interface DragFeedback {
  x: number
  y: number
  text: string
}

/** Marquee rectangle in client coordinates. */
export interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

export interface TimelineView {
  /** Expanded rows by row key. */
  expanded: Record<string, boolean>
  /** Horizontal zoom in pixels per frame. */
  ppf: number
  /** Keep the whole animation in view when the panel resizes. */
  fit: boolean
  /** Frame used by the value readouts (throttled during playback). */
  valueFrame: number
  /** Row key of the layer being renamed inline. */
  renaming: string | null
  /** Index of the marker being renamed inline. */
  renamingMarker: number | null
  feedback: DragFeedback | null
  /** Root frame of the snap guide while dragging. */
  snapFrame: number | null
  marquee: MarqueeRect | null
  /** The timeline (or something inside it) has keyboard focus. */
  focused: boolean
  /** The playhead is being dragged in the ruler (shows the frame on its head). */
  scrubbing: boolean
  /** Graph editor: the value axis follows the curves (off once the user zooms or pans it). */
  graphFit: boolean
  /** Graph editor: value-axis range [min, max] chosen by the user (when not fitting). */
  graphRange: [number, number] | null
}

const initialView = (): TimelineView => ({
  expanded: {},
  ppf: 4,
  fit: true,
  valueFrame: 0,
  renaming: null,
  renamingMarker: null,
  feedback: null,
  snapFrame: null,
  marquee: null,
  focused: false,
  scrubbing: false,
  graphFit: true,
  graphRange: null,
})

export const useTimelineView = create<TimelineView>()(initialView)

export function setTimelineView(
  patch: Partial<TimelineView> | ((s: TimelineView) => Partial<TimelineView>),
): void {
  useTimelineView.setState(patch)
}

/** Expands or collapses rows by key. */
export function setExpanded(keys: readonly string[], expanded: boolean): void {
  if (keys.length === 0) return
  useTimelineView.setState((s) => {
    const next = { ...s.expanded }
    for (const key of keys) {
      if (expanded) next[key] = true
      else delete next[key]
    }
    return { expanded: next }
  })
}

export function toggleExpanded(key: string): void {
  useTimelineView.setState((s) => {
    const next = { ...s.expanded }
    if (next[key]) delete next[key]
    else next[key] = true
    return { expanded: next }
  })
}

// A different document starts with a fresh view (rows collapsed, zoomed to fit).
useDocument.subscribe(
  (s) => s.meta?.id,
  () => {
    const { focused } = useTimelineView.getState()
    useTimelineView.setState({ ...initialView(), focused })
  },
)
