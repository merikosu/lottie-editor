/**
 * Locked nodes cannot be picked on the canvas. Lock state is editor-only and owned by the
 * layers feature (a node inside a locked layer or group counts as locked too).
 */
import { isLocked } from '@/features/layers'
import type { NodePath } from '@/lottie/path'

/** True when the node is locked in the layer panel (clicks pass through it). */
export function isLockedOnCanvas(path: NodePath): boolean {
  try {
    return isLocked(path)
  } catch {
    return false
  }
}
