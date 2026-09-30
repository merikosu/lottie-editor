/**
 * Removing an element from the animation (a watermark, a logo the new version does without):
 * layers go the way the editor deletes them (mattes and children taken care of), shape groups
 * leave their layer, and the image or composition nothing shows any more leaves the file with
 * them (compositions nested in it stay: they may be shown elsewhere).
 */
import { deleteLayers, deleteShapes } from '@/lottie/layer-ops'
import { isLayerPath, isShapePath, type NodePath } from '@/lottie/path'
import { replaceTargetKind } from '@/lottie/replace'
import { forEachLayer } from '@/lottie/traverse'
import type { Animation } from '@/lottie/types'
import { sharedAssetOf } from './targets'

function isReferenced(anim: Animation, assetId: string): boolean {
  let used = false
  forEachLayer(anim, (layer) => {
    if ((layer as { refId?: string }).refId === assetId) {
      used = true
      return false
    }
  })
  return used
}

/**
 * Removes the element at `path` (a replaceable layer or shape group). Mutates `anim` (use inside
 * `updateDoc`); returns false when there is nothing removable there.
 */
export function removeElement(anim: Animation, path: NodePath): boolean {
  if (!replaceTargetKind(anim, path)) return false
  const assetId = sharedAssetOf(anim, path)
  if (isLayerPath(path)) {
    if (deleteLayers(anim, [path]).length === 0) return false
  } else if (isShapePath(path)) {
    if (deleteShapes(anim, [path]).length === 0) return false
  } else return false
  // A picture or composition nothing shows any more would stay hidden in the file.
  if (assetId && Array.isArray(anim.assets) && !isReferenced(anim, assetId)) {
    const index = anim.assets.findIndex((a) => a.id === assetId)
    if (index >= 0) anim.assets.splice(index, 1)
  }
  return true
}
