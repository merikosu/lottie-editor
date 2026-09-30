/**
 * Inspector-local UI state.
 *  - persisted preferences (linked scale, text edit scope)
 *  - transient requests coming from other features (focus the text field of a layer)
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { pathKey, type NodePath } from '@/lottie/path'

interface InspectorPrefs {
  /** Scale X/Y edit together, keeping the ratio (like After Effects' constrain proportions). */
  scaleLinked: boolean
  /** Canvas size W/H edits keep the ratio (solids, precomps). */
  sizeLinked: boolean
}

const defaults: InspectorPrefs = { scaleLinked: true, sizeLinked: false }

export const useInspectorPrefs = create<InspectorPrefs>()(
  persist(() => defaults, {
    name: 'lottie-editor:inspector',
    version: 1,
  }),
)

export function setInspectorPrefs(patch: Partial<InspectorPrefs>): void {
  useInspectorPrefs.setState(patch)
}

export interface EffectRevealRequest {
  layer: string
  index: number
  token: number
  /** Request time (ms): an Effects section mounting later ignores old requests. */
  at: number
}

interface InspectorRequests {
  /** Path key of a text layer whose content field should take focus when it renders. */
  focusText: string | null
  /** Bumped to ask the header to start renaming the primary node. */
  renameToken: number
  /** Effect to open and scroll to (a newly added one); `layer` is the layer's path key. */
  revealEffect: EffectRevealRequest | null
}

export const useInspectorRequests = create<InspectorRequests>()(() => ({
  focusText: null,
  renameToken: 0,
  revealEffect: null,
}))

export function requestTextFocus(key: string | null): void {
  useInspectorRequests.setState({ focusText: key })
}

export function requestRename(): void {
  useInspectorRequests.setState((s) => ({ renameToken: s.renameToken + 1 }))
}

/** Asks the Effects section of a layer to open the effect at `index` and scroll to it. */
export function requestEffectReveal(layerPath: NodePath, index: number): void {
  useInspectorRequests.setState((s) => ({
    revealEffect: {
      layer: pathKey(layerPath),
      index,
      token: (s.revealEffect?.token ?? 0) + 1,
      at: Date.now(),
    },
  }))
}
