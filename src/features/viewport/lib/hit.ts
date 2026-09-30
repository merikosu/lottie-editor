/**
 * Choosing what a click on the canvas selects (pure).
 *
 * The SVG renderer tags layer and shape-group elements with their JSON path. A hit gives the
 * tagged paths of the element under the pointer and its ancestors; ordered outermost first
 * this is the "hit stack", e.g.
 *
 *   ['layers', 6]                                  precomp layer in the root composition
 *   ['assets', 0, 'layers', 0]                     layer inside the precomp
 *   ['assets', 0, 'layers', 0, 'shapes', 1]        group inside that layer
 */
import { pathEquals, pathKey, type NodePath } from '@/lottie/path'

/** 'root' selects the root-composition layer (click); 'deep' the innermost node (⌘/Ctrl-click). */
export type HitMode = 'root' | 'deep'

/** Outermost-first stack from tagged paths ordered innermost first (nodePathsFromElement). */
export function hitStack(innermostFirst: readonly NodePath[]): NodePath[] {
  const seen = new Set<string>()
  const out: NodePath[] = []
  for (let i = innermostFirst.length - 1; i >= 0; i--) {
    const p = innermostFirst[i]
    const key = pathKey(p)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/** True for a layer of the root composition: ['layers', n]. */
export function isRootLayerPath(path: NodePath): boolean {
  return path.length === 2 && path[0] === 'layers' && typeof path[1] === 'number'
}

/**
 * The node a click selects, or null when nothing selectable was hit.
 * `blocked` (e.g. locked layers) makes a node and everything inside it unselectable.
 */
export function pickFromStack(
  stack: readonly NodePath[],
  mode: HitMode,
  blocked: (path: NodePath) => boolean = () => false,
): NodePath | null {
  if (stack.length === 0) return null
  for (const p of stack) if (blocked(p)) return null
  if (mode === 'deep') return stack[stack.length - 1]
  return stack.find(isRootLayerPath) ?? stack[0]
}

/**
 * Double-click drill-down: the node one level deeper than the deepest selected node in the
 * stack. When nothing in the stack is selected, the root-level node is returned. Returns null
 * when the selected node is already the innermost one.
 */
export function drillDown(
  stack: readonly NodePath[],
  selected: readonly NodePath[],
): NodePath | null {
  if (stack.length === 0) return null
  let index = -1
  for (let i = stack.length - 1; i >= 0; i--) {
    if (selected.some((s) => pathEquals(s, stack[i]))) {
      index = i
      break
    }
  }
  if (index === -1) return pickFromStack(stack, 'root')
  return stack[index + 1] ?? null
}
