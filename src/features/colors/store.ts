/**
 * State of the colors feature: persisted panel preferences and transient UI state
 * (expanded rows, focus requests, short confirmations). Nothing here is part of the document.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ColorSort } from '@/lottie/colors'

export type ColorScope = 'document' | 'selection'
export type PickerFormat = 'hex' | 'rgb' | 'hsl'
export type ListSection = 'colors' | 'gradients'

export interface ColorsPrefs {
  /** Requested scope; "selection" falls back to the document while nothing is selected. */
  scope: ColorScope
  sortBy: ColorSort
  mergeSimilar: boolean
  /** CIEDE2000 distance under which colors are shown as one swatch. */
  tolerance: number
  pickerFormat: PickerFormat
  /** Last tint color of the Adjust section (hex). */
  tintColor: string
  collapsed: Partial<Record<ListSection, boolean>>
}

export const TOLERANCE_MIN = 0.5
export const TOLERANCE_MAX = 20
export const TOLERANCE_DEFAULT = 3

const defaults: ColorsPrefs = {
  scope: 'document',
  sortBy: 'usage',
  mergeSimilar: false,
  tolerance: TOLERANCE_DEFAULT,
  pickerFormat: 'hex',
  tintColor: '#ffffff',
  collapsed: {},
}

export const useColorsPrefs = create<ColorsPrefs>()(
  persist(() => defaults, {
    name: 'lottie-editor:colors',
    version: 1,
    merge: (persisted, current) => ({ ...current, ...(persisted as Partial<ColorsPrefs>) }),
  }),
)

export function setColorsPrefs(patch: Partial<ColorsPrefs>): void {
  useColorsPrefs.setState(patch)
}

export function toggleListSection(section: ListSection): void {
  useColorsPrefs.setState((s) => ({
    collapsed: { ...s.collapsed, [section]: !s.collapsed[section] },
  }))
}

interface ColorsUi {
  /** Expanded rows by key: color groups show usages, gradients show stops (`usages:<key>` their usages). */
  expanded: Record<string, boolean>
  /** Set by the `colors.adjust` command; the Adjust section focuses its first control and clears it. */
  focusAdjust: boolean
  /** Short confirmation shown at the bottom of the colors UI (e.g. after copying). */
  flash: { id: number; text: string } | null
}

export const useColorsUi = create<ColorsUi>()(() => ({
  expanded: {},
  focusAdjust: false,
  flash: null,
}))

export function setExpanded(key: string, expanded: boolean): void {
  useColorsUi.setState((s) => ({ expanded: { ...s.expanded, [key]: expanded } }))
}

export function toggleExpanded(key: string): void {
  useColorsUi.setState((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } }))
}

let flashId = 0
let flashTimer: ReturnType<typeof setTimeout> | null = null

/** Shows a short confirmation that disappears by itself. */
export function flash(text: string, ms = 1600): void {
  const id = ++flashId
  useColorsUi.setState({ flash: { id, text } })
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    if (useColorsUi.getState().flash?.id === id) useColorsUi.setState({ flash: null })
  }, ms)
}
