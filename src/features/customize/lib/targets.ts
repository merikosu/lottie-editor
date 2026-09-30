/**
 * Elements the Customize page can replace: which one a click on the preview means, and the
 * other places that show the same image or composition.
 */
import { getAt, isLayerPath, pathKey, type NodePath } from '@/lottie/path'
import { replaceTargetKind } from '@/lottie/replace'
import { forEachLayer } from '@/lottie/traverse'
import type { Animation, Layer } from '@/lottie/types'

/**
 * The element a click on the preview picks, from the tagged nodes under the pointer (innermost
 * first):
 *  - `deep` (⌘/Ctrl-click): the innermost replaceable node (usually a shape group);
 *  - otherwise the innermost suggested element (a logo precomp covers everything inside it),
 *    else the innermost replaceable layer — the layer that draws what was clicked.
 */
export function resolvePick(
  anim: Animation,
  stack: readonly NodePath[],
  suggested: readonly { path: NodePath }[],
  deep = false,
): NodePath | null {
  const replaceable = (p: NodePath) => replaceTargetKind(anim, p) !== null
  if (deep) return stack.find(replaceable) ?? null
  const keys = new Set(suggested.map((c) => pathKey(c.path)))
  return (
    stack.find((p) => keys.has(pathKey(p))) ??
    stack.find((p) => isLayerPath(p) && replaceable(p)) ??
    stack.find(replaceable) ??
    null
  )
}

/**
 * `next` in the order the same items had in `previous` (by `key`), new items after them in their
 * own order. A list the user is working through must not reshuffle after each edit, even when
 * the ranking behind it changes (a replaced logo scores differently).
 */
export function keepOrder<T extends { key: string }>(
  next: readonly T[],
  previous: readonly T[],
): T[] {
  const rank = new Map(previous.map((item, i) => [item.key, i]))
  const known = next.filter((item) => rank.has(item.key))
  known.sort((a, b) => rank.get(a.key)! - rank.get(b.key)!)
  return [...known, ...next.filter((item) => !rank.has(item.key))]
}

/** Asset shown by an image or precomp layer target (null for other targets). */
export function sharedAssetOf(anim: Animation, target: NodePath): string | null {
  const kind = replaceTargetKind(anim, target)
  if (kind !== 'image-layer' && kind !== 'precomp-layer') return null
  const ref = getAt<{ refId?: unknown }>(anim, target)?.refId
  return typeof ref === 'string' ? ref : null
}

/**
 * Layers showing the same image or composition as `target`, the target first (just the target
 * when nothing is shared).
 */
export function instancesOf(anim: Animation, target: NodePath): NodePath[] {
  const assetId = sharedAssetOf(anim, target)
  if (!assetId) return [target]
  const ty = getAt<Layer>(anim, target)?.ty
  const key = pathKey(target)
  const others: NodePath[] = []
  forEachLayer(anim, (layer, path) => {
    if (layer.ty === ty && (layer as { refId?: string }).refId === assetId && pathKey(path) !== key)
      others.push(path)
  })
  return [target, ...others]
}
