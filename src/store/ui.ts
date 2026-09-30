/**
 * Transient UI state (not persisted, not part of undo history).
 */
import { create } from 'zustand'
import type { NodePath } from '@/lottie/path'

export interface DialogState {
  id: string
  props?: unknown
}

export interface UiState {
  /** Node hovered in the layer tree / canvas, highlighted everywhere. */
  hoverNode: NodePath | null
  /** Extra nodes to highlight in the viewport (e.g. layers using a hovered color). */
  highlightNodes: NodePath[]
  /** Preview-only solo: when non-empty, other layers of the same compositions are hidden. */
  soloNodes: NodePath[]
  /** Currently open dialog (see dialogs registry). */
  dialog: DialogState | null
  commandPaletteOpen: boolean
  /** Viewport zoom (1 = 100%), published by the viewport (its camera lives in the viewport store). */
  zoom: number
  /** Full-window drag-and-drop overlay visible. */
  dropActive: boolean
}

export const useUi = create<UiState>()(() => ({
  hoverNode: null,
  highlightNodes: [],
  soloNodes: [],
  dialog: null,
  commandPaletteOpen: false,
  zoom: 1,
  dropActive: false,
}))

export function setHoverNode(path: NodePath | null): void {
  useUi.setState({ hoverNode: path })
}

export function setHighlightNodes(paths: NodePath[]): void {
  useUi.setState({ highlightNodes: paths })
}

export function setSoloNodes(paths: NodePath[]): void {
  useUi.setState({ soloNodes: paths })
}

export function openDialog(id: string, props?: unknown): void {
  useUi.setState({ dialog: { id, props }, commandPaletteOpen: false })
}

export function closeDialog(): void {
  useUi.setState({ dialog: null })
}

export function setCommandPaletteOpen(open: boolean): void {
  useUi.setState({ commandPaletteOpen: open })
}
