/**
 * Tiny typed event bus for cross-feature UI requests that are not state
 * (e.g. "scroll the JSON view to this node").
 */
import type { NodePath } from '@/lottie/path'

export interface EditorEvents {
  /** Show a node in the JSON view (switches the center view if needed). */
  'reveal-code': { path: NodePath }
  /** Scroll the layer tree / timeline so the node is visible. */
  'reveal-node': { path: NodePath }
  /** Start inline rename of a node in the layer tree. */
  'rename-node': { path: NodePath }
  /** Frame the given node in the viewport (zoom to its bounds). */
  'zoom-to-node': { path: NodePath }
  /** Focus the text content field of a text layer in the inspector. */
  'edit-text': { path: NodePath }
}

type Listener<K extends keyof EditorEvents> = (payload: EditorEvents[K]) => void

const listeners = new Map<keyof EditorEvents, Set<Listener<never>>>()

export function on<K extends keyof EditorEvents>(type: K, listener: Listener<K>): () => void {
  let set = listeners.get(type)
  if (!set) {
    set = new Set()
    listeners.set(type, set)
  }
  set.add(listener as Listener<never>)
  return () => set.delete(listener as Listener<never>)
}

export function emit<K extends keyof EditorEvents>(type: K, payload: EditorEvents[K]): void {
  listeners.get(type)?.forEach((l) => (l as Listener<K>)(payload))
}
